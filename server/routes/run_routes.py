from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid, re, time, asyncio, tempfile, textwrap, shutil, os, json, shlex

router = APIRouter()

# In-memory sessions for now (you can import this in ws_routes later)
SESSIONS: dict[str, dict] = {}

# ---------- Models ----------
class FileSpec(BaseModel):
    name: str
    content: str

class BreakpointSpec(BaseModel):
    file: str
    line: int

class RunReq(BaseModel):
    lang: str                                      # e.g., "python" | "javascript"
    entry: str                                     # e.g., "main.py"
    args: Optional[List[str]] = Field(default_factory=list)
    files: List[FileSpec]
    mode: Optional[str] = Field(default="run")     # "run" | "debug"
    breakpoints: Optional[List[BreakpointSpec]] = Field(default_factory=list)

class RunResp(BaseModel):
    session_id: str
    ws_url: str

# ---------- Validation helpers ----------
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,128}$")  # no slashes/paths, no spaces
ALLOWED_LANGS = {"python", "javascript", "java", "cpp", "go"}  # explicitly supported; plaintext is not allowed
ALLOWED_MODES = {"run", "debug"}

def _is_safe_name(name: str) -> bool:
    return bool(SAFE_NAME.match(name))

def _validate_request(req: RunReq) -> None:
    # mode must be supported
    mode = (req.mode or "run").strip().lower()
    if mode not in ALLOWED_MODES:
        allowed_modes = ", ".join(sorted(ALLOWED_MODES))
        raise HTTPException(status_code=400, detail=f"unsupported mode: {req.mode!r}. Choose one of: {allowed_modes}")

    # 0) language must be allowed and not plaintext
    lang = (req.lang or "").strip().lower()
    if lang not in ALLOWED_LANGS:
        allowed = ", ".join(sorted(ALLOWED_LANGS))
        raise HTTPException(
            status_code=400,
            detail=f"unsupported language: {req.lang!r}. Choose one of: {allowed}"
        )

    # 1) filenames must be safe
    for f in req.files:
        if not _is_safe_name(f.name):
            raise HTTPException(status_code=400, detail=f"invalid filename: {f.name}")
    if not _is_safe_name(req.entry):
        raise HTTPException(status_code=400, detail=f"invalid entry: {req.entry}")

    # 2) entry must exist among files
    names = {f.name for f in req.files}
    if req.entry not in names:
        raise HTTPException(status_code=400, detail=f"entry file not found: {req.entry}")

    # 3) (optional) simple limits
    MAX_FILES = 50
    MAX_BYTES_PER_FILE = 200_000  # 200 KB/file (tweak as you need)
    if len(req.files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"too many files (>{MAX_FILES})")
    for f in req.files:
        if len(f.content.encode("utf-8", "ignore")) > MAX_BYTES_PER_FILE:
            raise HTTPException(status_code=400, detail=f"file too large: {f.name}")

    # 4) validate breakpoints (if any)
    for bp in req.breakpoints or []:
        if not _is_safe_name(bp.file):
            raise HTTPException(status_code=400, detail=f"invalid breakpoint file: {bp.file}")
        if bp.line <= 0:
            raise HTTPException(status_code=400, detail=f"invalid breakpoint line: {bp.line}")

def _build_ws_url(request: Request, sid: str) -> str:
    # Derive host from the incoming HTTP request; swap scheme http->ws, https->wss
    scheme = "wss" if request.url.scheme == "https" else "ws"
    host = request.headers.get("host") or request.url.netloc
    return f"{scheme}://{host}/ws/run/{sid}"

USE_DOCKER = os.getenv("OC_USE_DOCKER", "1") not in ("0", "false", "False", "no", "No")
DOCKER_IMAGES = {
    "cpp": "omni-runner:cpp",
    "python": "omni-runner:python",
    "javascript": "omni-runner:node",
    "java": "omni-runner:java",
    "go": "omni-runner:go",
}

def _should_use_docker() -> bool:
    return USE_DOCKER and shutil.which("docker") is not None

def _write_files(files: List[FileSpec], workdir: str) -> None:
    for f in files:
        path = os.path.join(workdir, f.name)
        with open(path, "w", encoding="utf-8") as fp:
            fp.write(textwrap.dedent(f.content))

async def _run_cmd(cmd: list[str], workdir: str):
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=workdir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode(errors="ignore"), err.decode(errors="ignore")

async def _prepare_cpp_debug_session(files: List[FileSpec]):
    """
    For C++ debug mode:
      - write files to a temp dir
      - compile with debug symbols
      - start gdb in MI mode
    Returns (workdir, proc)
    """
    if not _should_use_docker():
        raise HTTPException(
            status_code=500,
            detail="Docker is required for execution but was not detected on PATH (OC_USE_DOCKER=1).",
        )

    workdir = tempfile.mkdtemp(prefix="oc-cppdbg-")
    try:
        _write_files(files, workdir)

        cpp_files = [f.name for f in files if f.name.endswith(".cpp")]
        if not cpp_files:
            raise HTTPException(status_code=400, detail="no C++ source files provided (.cpp)")

        mount = f"{os.path.abspath(workdir)}:/work:rw"
        compile_cmd = [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            "512m",
            "--pids-limit",
            "256",
            "-v",
            mount,
            "-w",
            "/work",
            DOCKER_IMAGES["cpp"],
            "g++",
            "-g",
            "-O0",
            *cpp_files,
            "-o",
            "main",
        ]

        rc, out, err = await _run_cmd(compile_cmd, workdir)
        if rc != 0:
            msg = err or out or "compilation failed"
            raise HTTPException(status_code=400, detail=f"g++ failed: {msg}")

        gdb_cmd = [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            "512m",
            "--pids-limit",
            "256",
            "--cap-add=SYS_PTRACE",
            "--security-opt",
            "seccomp=unconfined",
            "-v",
            mount,
            "-w",
            "/work",
            DOCKER_IMAGES["cpp"],
            "gdb",
            "--interpreter=mi",
            "--quiet",
            "./main",
        ]

        gdb_proc = await asyncio.create_subprocess_exec(
            *gdb_cmd,
            cwd=workdir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return workdir, gdb_proc
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise

async def _prepare_python_debug_session(files: List[FileSpec], entry: str, breakpoints: list[dict]):
    """
    For Python debug mode:
      - write files to a temp dir
      - copy oc_py_debugger.py into the workdir
      - start the debugger runner inside python image
    Returns (workdir, proc)
    """
    if not _should_use_docker():
        raise HTTPException(
            status_code=500,
            detail="Docker is required for execution but was not detected on PATH (OC_USE_DOCKER=1).",
        )

    workdir = tempfile.mkdtemp(prefix="oc-pydbg-")
    try:
        _write_files(files, workdir)

        # copy debugger shim
        dbg_src = os.path.join(os.path.dirname(__file__), "..", "oc_docker", "oc_py_debugger.py")
        dbg_src = os.path.abspath(dbg_src)
        dbg_dst = os.path.join(workdir, "oc_py_debugger.py")
        shutil.copy2(dbg_src, dbg_dst)

        mount = f"{os.path.abspath(workdir)}:/work:rw"
        init_bp_env = json.dumps(
            [{"file": bp.get("file"), "line": bp.get("line")} for bp in (breakpoints or [])],
            separators=(",", ":"),
        )
        init_bp_path = os.path.join(workdir, "_oc_init_bps.json")
        try:
            with open(init_bp_path, "w", encoding="utf-8") as f:
                f.write(init_bp_env)
        except Exception:
            init_bp_path = ""

        cmd = [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            "512m",
            "--pids-limit",
            "256",
            "-v",
            mount,
            "-w",
            "/work",
            "-e",
            f"OC_INIT_BPS={init_bp_env}",
        ]
        if init_bp_path:
            cmd.extend(["-e", f"OC_INIT_BPS_PATH={init_bp_path}"])
        cmd.extend([
            DOCKER_IMAGES["python"],
            "python",
            "-u",
            "oc_py_debugger.py",
            entry,
        ])

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workdir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return workdir, proc
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise

async def _prepare_js_debug_session(files: List[FileSpec], entry: str, breakpoints: list[dict]):
    """
    For JavaScript debug mode:
      - write files to a temp dir
      - copy oc_js_debugger.js into the workdir
      - start the inspector-based debugger runner inside node image
    Returns (workdir, proc)
    """
    if not _should_use_docker():
        raise HTTPException(
            status_code=500,
            detail="Docker is required for execution but was not detected on PATH (OC_USE_DOCKER=1).",
        )

    workdir = tempfile.mkdtemp(prefix="oc-jsdbg-")
    try:
        _write_files(files, workdir)

        dbg_src = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "oc_docker", "oc_js_debugger.js"))
        dbg_dst = os.path.join(workdir, "oc_js_debugger.js")
        shutil.copy2(dbg_src, dbg_dst)

        init_bp_env = json.dumps(
            [{"file": bp.get("file"), "line": bp.get("line")} for bp in (breakpoints or [])],
            separators=(",", ":"),
        )

        mount = f"{os.path.abspath(workdir)}:/work:rw"
        cmd = [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            "512m",
            "--pids-limit",
            "256",
            "-v",
            mount,
            "-w",
            "/work",
            "-e",
            f"OC_INIT_BPS={init_bp_env}",
            DOCKER_IMAGES["javascript"],
            "node",
            "oc_js_debugger.js",
            entry,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workdir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Ensure debugger actually started; if it exited immediately (e.g., missing image), surface error now.
        try:
            rc = await asyncio.wait_for(proc.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            rc = None
        if rc is not None:
            out, err = await proc.communicate()
            msg = (err or out or f"node debugger exited with code {rc}").decode(errors="ignore")
            raise HTTPException(status_code=500, detail=msg)

        return workdir, proc
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise

async def _prepare_java_debug_session(files: List[FileSpec], entry: str, breakpoints: list[dict]):
    """
    Java debug mode (default package only):
      - write files to a temp dir
      - reject package declarations (not supported in current run path)
      - compile with javac
      - start jdb on the entry class
    Returns (workdir, proc, entry_class)
    """
    if not _should_use_docker():
        raise HTTPException(
            status_code=500,
            detail="Docker is required for execution but was not detected on PATH (OC_USE_DOCKER=1).",
        )

    workdir = tempfile.mkdtemp(prefix="oc-javadbg-")
    try:
        _write_files(files, workdir)

        entry_path = os.path.join(workdir, entry)
        if not os.path.exists(entry_path):
            raise HTTPException(status_code=400, detail="entry file not found after write")

        # Reject packages (current run mode assumes default package)
        try:
            with open(entry_path, "r", encoding="utf-8") as f:
                head = f.read(2048)
            if re.search(r"^\s*package\s+", head, flags=re.MULTILINE):
                raise HTTPException(status_code=400, detail="Java packages not supported in debug mode")
        except HTTPException:
            raise
        except Exception:
            pass

        entry_class = os.path.splitext(os.path.basename(entry))[0]

        mount = f"{os.path.abspath(workdir)}:/work:rw"
        java_sources = [f.name for f in files if f.name.endswith(".java")]
        if not java_sources:
            raise HTTPException(status_code=400, detail="no Java source files provided (.java)")

        compile_cmd = [
            "docker", "run", "--rm", "-i",
            "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
            "-v", mount, "-w", "/work",
            DOCKER_IMAGES["java"],
            "javac", "-g", *java_sources,
        ]
        rc, out, err = await _run_cmd(compile_cmd, workdir)
        if rc != 0:
            msg = err or out or "javac failed"
            raise HTTPException(status_code=400, detail=msg)

        jdb_cmd = [
            "docker", "run", "--rm", "-i",
            "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
            "-v", mount, "-w", "/work",
            DOCKER_IMAGES["java"],
            "jdb",
            "-sourcepath", "/work",
            "-classpath", "/work",
            entry_class,
        ]

        proc = await asyncio.create_subprocess_exec(
            *jdb_cmd,
            cwd=workdir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return workdir, proc, entry_class
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise

async def _prepare_go_debug_session(files: List[FileSpec], entry: str, breakpoints: list[dict]):
    """
    Go debug mode:
      - write files to a temp dir
      - compile with -N -l for debugging
      - start delve CLI on the built binary (CLI mode via stdin/stdout)
    Returns (workdir, proc, binary_path)
    """
    if not _should_use_docker():
        raise HTTPException(
            status_code=500,
            detail="Docker is required for execution but was not detected on PATH (OC_USE_DOCKER=1).",
        )

    workdir = tempfile.mkdtemp(prefix="oc-godbg-")
    try:
        _write_files(files, workdir)

        go_files = [f.name for f in files if f.name.endswith(".go")]
        if not go_files:
            raise HTTPException(status_code=400, detail="no Go source files provided (.go)")

        mount = f"{os.path.abspath(workdir)}:/work:rw"
        binary_path = "/work/app"
        compile_cmd = [
            "docker", "run", "--rm", "-i",
            "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
            "-v", mount, "-w", "/work",
            DOCKER_IMAGES["go"],
            "sh", "-c",
            f"go build -gcflags \"all=-N -l\" -o {binary_path} {shlex.quote(entry)}",
        ]
        rc, out, err = await _run_cmd(compile_cmd, workdir)
        if rc != 0:
            msg = err or out or "go build failed"
            raise HTTPException(status_code=400, detail=msg)

        dlv_cmd = [
            "docker", "run", "--rm", "-i",
            "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
            "--cap-add=SYS_PTRACE", "--security-opt", "seccomp=unconfined",
            "-v", mount, "-w", "/work",
            DOCKER_IMAGES["go"],
            "dlv", "exec", "./app", "--log",
        ]

        # Start dlv; if it dies immediately, surface its output now.
        proc = await asyncio.create_subprocess_exec(
            *dlv_cmd,
            cwd=workdir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            rc = await asyncio.wait_for(proc.wait(), timeout=0.5)
        except asyncio.TimeoutError:
            rc = None
        if rc is not None:
            out, err = await proc.communicate()
            msg = (err or out or f"dlv exited with code {rc}").decode(errors="ignore")
            raise HTTPException(status_code=500, detail=msg)
        return workdir, proc, binary_path
    except Exception:
        shutil.rmtree(workdir, ignore_errors=True)
        raise

# ---------- Route ----------
@router.post("/run", response_model=RunResp)
async def create_run(request: Request, body: RunReq) -> RunResp:
    _validate_request(body)

    lang = (body.lang or "").strip().lower()
    mode = (body.mode or "run").strip().lower() or "run"
    breakpoints = [{"file": bp.file, "line": bp.line} for bp in (body.breakpoints or [])]
    sid = uuid.uuid4().hex
    session = {
        "id": sid,
        "lang": lang,
        "entry": body.entry,
        "args": body.args or [],
        "files": [{"name": f.name, "content": f.content} for f in body.files],
        "state": "new",
        "created_at": time.time(),
        "mode": mode,
        "breakpoints": breakpoints,
    }

    if mode == "debug":
        if lang == "cpp":
            try:
                workdir, proc = await _prepare_cpp_debug_session(body.files)

                # Ensure gdb actually started; if it exited immediately, surface the error now.
                try:
                    rc = await asyncio.wait_for(proc.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    rc = None
                if rc is not None:
                    out, err = await proc.communicate()
                    msg = (err or out or f"gdb exited with code {rc}").decode(errors="ignore")
                    raise HTTPException(status_code=500, detail=f"gdb failed to start: {msg}")
            except HTTPException:
                raise
            except Exception as e:
                msg = str(e) or repr(e)
                raise HTTPException(status_code=500, detail=msg)

            session["workdir"] = workdir
            session["proc"] = proc
            session["state"] = "debug-ready"
        elif lang == "python":
            try:
                workdir, proc = await _prepare_python_debug_session(body.files, body.entry, breakpoints)
            except HTTPException:
                raise
            except Exception as e:
                msg = str(e) or repr(e)
                raise HTTPException(status_code=500, detail=msg)

            session["workdir"] = workdir
            session["proc"] = proc
            session["state"] = "debug-ready"
        elif lang == "javascript":
            try:
                workdir, proc = await _prepare_js_debug_session(body.files, body.entry, breakpoints)
            except HTTPException:
                raise
            except Exception as e:
                msg = str(e) or repr(e)
                raise HTTPException(status_code=500, detail=msg)

            session["workdir"] = workdir
            session["proc"] = proc
            session["state"] = "debug-ready"
        elif lang == "java":
            try:
                workdir, proc, entry_class = await _prepare_java_debug_session(body.files, body.entry, breakpoints)
            except HTTPException:
                raise
            except Exception as e:
                msg = str(e) or repr(e)
                raise HTTPException(status_code=500, detail=msg)

            session["workdir"] = workdir
            session["proc"] = proc
            session["entry_class"] = entry_class
            session["state"] = "debug-ready"
        elif lang == "go":
            try:
                workdir, proc, binary_path = await _prepare_go_debug_session(body.files, body.entry, breakpoints)
            except HTTPException:
                raise
            except Exception as e:
                msg = str(e) or repr(e)
                raise HTTPException(status_code=500, detail=msg)

            session["workdir"] = workdir
            session["proc"] = proc
            session["binary_path"] = binary_path
            session["state"] = "debug-ready"

    SESSIONS[sid] = session
    return RunResp(session_id=sid, ws_url=_build_ws_url(request, sid))
