from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio, json, tempfile, os, textwrap, shutil, shlex, subprocess, re

SENTINEL = "<<<OC_AWAIT>>>"


from .run_routes import SESSIONS

router = APIRouter()

# Sentinel emitted before each blocking input() by the Python shim
SENTINEL = "<<<OC_AWAIT>>>"

@router.websocket("/ws/echo")
async def ws_echo(ws: WebSocket):
    # accept the socket
    await ws.accept()
    # greet client
    await ws.send_json({"type": "welcome", "msg": "WS connected. Send {'type':'in','data':'hello'}"})
    try:
        while True:
            raw = await ws.receive_json()   # expects JSON
            if raw.get("type") == "in":
                # echo back the data
                await ws.send_json({"type": "out", "data": f"echo: {raw.get('data','')}"})
            else:
                await ws.send_json({"type": "err", "data": f"unknown message: {raw}"})
    except WebSocketDisconnect:
        # client closed the connection
        pass




# Allow toggling Docker via env; default ON for prod
USE_DOCKER = os.getenv("OC_USE_DOCKER", "1") not in ("0", "false", "False", "no", "No")



DOCKER_IMAGES = {
    "python": "omni-runner:python",
    "cpp": "omni-runner:cpp",
    "javascript": "omni-runner:node",
    "go": "omni-runner:go",
    "java": "omni-runner:java",
}

def _should_use_docker():
    # Use Docker only if enabled and docker CLI is available
    return USE_DOCKER and shutil.which("docker") is not None

def _write_files(files, workdir):
    for f in files:
        path = os.path.join(workdir, f["name"])
        with open(path, "w", encoding="utf-8") as fp:
            fp.write(textwrap.dedent(f["content"]))

async def _start_process(lang, entry, args, workdir):
    """
    Start either a local process (dev mode) or a dockerized one (prod mode).
    Auto-fallback to local if Docker is unavailable.
    Handles Windows Selector loop by falling back to blocking Popen with to_thread pumps.

    Returns:
        (proc, cmd_desc, using, mode) where:
          - proc: asyncio.subprocess.Process | subprocess.Popen
          - cmd_desc: human-friendly command string for diagnostics
          - using: "docker" | "local"
          - mode: "async" (asyncio subprocess) | "popen" (blocking Popen)
    """
    use_docker = _should_use_docker()
    cmd = []
    cmd_desc = ""
    using = "docker" if use_docker else "local"

    if use_docker:
        image = DOCKER_IMAGES.get(lang)
        if not image:
            raise ValueError(f"Unsupported lang for docker: {lang}")

        # Use read-only mount for interpreted langs; rw when we need to compile (e.g., C++).
        mount = f"{workdir}:/work:{'ro' if lang == 'python' else 'rw'}"

        if lang == "python":
            # Multiline -c shim with explicit newlines. Forces write-through and emits a sentinel
            # before each input() so the client can enable the input box immediately.
            # Avoids parent TTY requirements and works reliably on Windows hosts.
                bootstrap = textwrap.dedent(f"""
                    import sys, runpy, builtins, os

                    # unbuffered stdout/stderr even when piped
                    try:
                        sys.stdout.reconfigure(write_through=True)
                        sys.stderr.reconfigure(write_through=True)
                    except Exception:
                        pass

                    _orig_input = builtins.input
                    def _oc_input(prompt=''):
                        sys.stdout.write(str(prompt))
                        sys.stdout.flush()
                        sys.stdout.write('{SENTINEL}')
                        sys.stdout.flush()
                        return _orig_input()

                    builtins.input = _oc_input

                    # supply argv as if the user ran: python {entry} *args
                    sys.argv = [{repr(entry)}] + {repr(list(args))}

                    # run the user's script as __main__
                    runpy.run_path({repr(entry)}, run_name='__main__')
                """).lstrip()

                bootstrap_path = os.path.join(workdir, "_oc_bootstrap.py")
                with open(bootstrap_path, "w", encoding="utf-8") as f:
                    f.write(bootstrap)

                # 2) build the docker run command (Python unbuffered; no TTY needed)
                mount = f"{os.path.abspath(workdir)}:/work:ro"
                cmd = ["docker", "run", "--rm", "-i",
                       "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
                       "-v", mount, "-w", "/work",
                       "-e", "PYTHONUNBUFFERED=1", "-e", "PYTHONIOENCODING=UTF-8",
                       DOCKER_IMAGES["python"],
                       "python", "-u", "_oc_bootstrap.py"]
                try:
                    cmd_desc = " ".join(shlex.quote(c) for c in cmd)
                except Exception:
                    cmd_desc = f"docker run ... {DOCKER_IMAGES['python']} python -u _oc_bootstrap.py"
        elif lang == "cpp":
            # Compile, then execute under a PTY if available; otherwise try stdbuf for line-buffering as a fallback.
            args_q = " ".join(shlex.quote(a) for a in args)
            shell_line = (
                f"g++ -O2 {shlex.quote(entry)} -o app && "
                f"( if command -v script >/dev/null 2>&1; then "
                f"script -qefc 'stty -echo; ./app {args_q}; stty echo' /dev/null; "
                f"elif command -v stdbuf >/dev/null 2>&1; then "
                f"stdbuf -oL -eL ./app {args_q}; "
                f"else ./app {args_q}; fi )"
            )
            cmd = [
                "docker", "run", "--rm", "-i",
                "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
                "-v", mount, "-w", "/work",
                image,
                "/bin/sh", "-lc", shell_line
            ]
            try:
                cmd_desc = " ".join(shlex.quote(c) for c in cmd)
            except Exception:
                cmd_desc = f"docker run ... {image} /bin/sh -lc {shell_line}"
        elif lang == "javascript":
            # Execute Node.js with line-buffering/PTY fallback similar to C++
            args_q = " ".join(shlex.quote(a) for a in args)
            shell_line = (
                f"( if command -v script >/dev/null 2>&1; then "
                f"script -qefc 'stty -echo; node {shlex.quote(entry)} {args_q}; stty echo' /dev/null; "
                f"elif command -v stdbuf >/dev/null 2>&1; then "
                f"stdbuf -oL -eL node {shlex.quote(entry)} {args_q}; "
                f"else node {shlex.quote(entry)} {args_q}; fi )"
            )
            cmd = [
                "docker", "run", "--rm", "-i",
                "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
                "-v", mount, "-w", "/work",
                image,
                "/bin/sh", "-lc", shell_line
            ]
            try:
                cmd_desc = " ".join(shlex.quote(c) for c in cmd)
            except Exception:
                cmd_desc = f"docker run ... {image} /bin/sh -lc {shell_line}"
        elif lang == "go":
            # Build if possible; otherwise fallback to 'go run'. Use PTY/stdbuf when available for more prompt-friendly I/O.
            # For PTY runs, disable terminal echo to avoid duplicating user input in the frontend.
            args_q = " ".join(shlex.quote(a) for a in args)
            shell_line = (
                f"( if go build -o app {shlex.quote(entry)} >/dev/null 2>&1; then "
                f"  if command -v script >/dev/null 2>&1; then "
                f"    script -qefc 'stty -echo; ./app {args_q}; stty echo' /dev/null; "
                f"  elif command -v stdbuf >/dev/null 2>&1; then "
                f"    stdbuf -oL -eL ./app {args_q}; "
                f"  else ./app {args_q}; fi; "
                f"  else "
                f"    if command -v script >/dev/null 2>&1; then "
                f"      script -qefc 'stty -echo; go run {shlex.quote(entry)} {args_q}; stty echo' /dev/null; "
                f"    elif command -v stdbuf >/dev/null 2>&1; then "
                f"      stdbuf -oL -eL go run {shlex.quote(entry)} {args_q}; "
                f"    else go run {shlex.quote(entry)} {args_q}; fi; "
                f"  fi )"
            )
            cmd = [
                "docker", "run", "--rm", "-i",
                "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
                "-v", mount, "-w", "/work",
                image,
                "/bin/sh", "-lc", shell_line
            ]
            try:
                cmd_desc = " ".join(shlex.quote(c) for c in cmd)
            except Exception:
                cmd_desc = f"docker run ... {image} /bin/sh -lc {shell_line}"
        elif lang == "java":
            # Compile the entry and run the main class (assumes no package declaration).
            main_class = os.path.splitext(os.path.basename(entry))[0]
            args_q = " ".join(shlex.quote(a) for a in args)
            shell_line = (
                f"javac {shlex.quote(entry)} && "
                f"( if command -v script >/dev/null 2>&1; then "
                f"script -qefc 'stty -echo; java -Xrs {shlex.quote(main_class)} {args_q}; stty echo' /dev/null; "
                f"elif command -v stdbuf >/dev/null 2>&1; then "
                f"stdbuf -oL -eL java -Xrs {shlex.quote(main_class)} {args_q}; "
                f"else java -Xrs {shlex.quote(main_class)} {args_q}; fi )"
            )
            cmd = [
                "docker", "run", "--rm", "-i",
                "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
                "-v", mount, "-w", "/work",
                image,
                "/bin/sh", "-lc", shell_line
            ]
            try:
                cmd_desc = " ".join(shlex.quote(c) for c in cmd)
            except Exception:
                cmd_desc = f"docker run ... {image} /bin/sh -lc {shell_line}"
        else:
            raise ValueError(f"Unsupported lang for docker: {lang}")

    else:
        # Enforce Docker-only execution as requested; no local runner.
        raise ValueError("Docker is required for execution but was not detected on PATH (OC_USE_DOCKER=1).")

    # First try asyncio subprocess (preferred). If NotImplementedError (e.g. Selector loop), fall back to Popen.
    try:
        # Diagnostics: log the active asyncio policy and loop type
        try:
            pol = type(asyncio.get_event_loop_policy()).__name__
            loop = asyncio.get_running_loop()
            loop_cls = type(loop).__name__
            print(f"[exec] asyncio policy={pol} loop={loop_cls} os={os.name}")
        except Exception:
            pass

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workdir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return proc, cmd_desc, using, "async"
    except NotImplementedError:
        # Decluttered minimal fallback: require proper Windows event loop (Proactor) via launcher
        raise RuntimeError(
            "Async subprocess unsupported with current event loop. "
            "On Windows, start the server with: python run_server.py "
            "(this sets WindowsProactorEventLoopPolicy so asyncio subprocess works)."
        )

def _mi_unquote(data: str) -> str:
    data = data.strip()
    if data.startswith('"') and data.endswith('"'):
        data = data[1:-1]
    data = data.replace("\\\\", "\\")
    data = data.replace('\\"', '"')
    data = data.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
    return data

def _extract_field(segment: str, key: str) -> str | None:
    m = re.search(fr'{key}="([^"]+)"', segment)
    if not m:
        return None
    return _mi_unquote(f'"{m.group(1)}"')

def _parse_frame_from_stop(stop_line: str) -> dict:
    file_val = _extract_field(stop_line, "fullname") or _extract_field(stop_line, "file")
    line_val = _extract_field(stop_line, "line")
    func_val = _extract_field(stop_line, "func")
    try:
        line_num = int(line_val) if line_val is not None else None
    except ValueError:
        line_num = None
    return {"file": file_val, "line": line_num, "function": func_val}

def _parse_stack_frames(resp_line: str) -> list[dict]:
    frames: list[dict] = []
    if not resp_line:
        return frames
    for match in re.finditer(r'frame=\{([^}]*)\}', resp_line):
        block = match.group(1)
        file_val = _extract_field(block, "fullname") or _extract_field(block, "file")
        line_val = _extract_field(block, "line")
        func_val = _extract_field(block, "func")
        try:
            line_num = int(line_val) if line_val is not None else None
        except ValueError:
            line_num = None
        frames.append({"file": file_val, "line": line_num, "function": func_val})
    return frames

def _parse_locals_map(resp_line: str) -> dict:
    locals_map: dict[str, str] = {}
    if not resp_line:
        return locals_map
    for match in re.finditer(r'\{name="([^"]+)"([^}]*)\}', resp_line):
        name = _mi_unquote(f'"{match.group(1)}"')
        block = match.group(2)
        val_match = re.search(r'value="([^"]*)"', block)
        val = _mi_unquote(f'"{val_match.group(1)}"') if val_match else ""
        locals_map[name] = val
    return locals_map

def _parse_break_id(resp_line: str) -> str | None:
    """
    Extract the breakpoint number from a ^done response to -break-insert.
    Example: ^done,bkpt={number="1",...}
    """
    m = re.search(r'number="([^"]+)"', resp_line)
    return m.group(1) if m else None

async def _handle_cpp_debug(ws: WebSocket, sess: dict):
    lang = sess.get("lang")
    entry = sess.get("entry")
    breakpoints = sess.get("breakpoints") or []
    workdir = sess.get("workdir")
    proc = sess.get("proc")

    if not proc or not workdir:
        await ws.send_json({"type": "err", "data": "debug session missing process/workdir"})
        return await ws.close()
    if proc.returncode is not None:
        detail = "debug session already ended"
        try:
            out, err = await proc.communicate()
            msg = (err or out or b"").decode(errors="ignore").strip()
            if msg:
                detail = msg
            if proc.returncode is not None:
                detail = f"{detail} (rc={proc.returncode})"
        except Exception:
            pass
        await ws.send_json({"type": "err", "data": detail})
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    response_future: asyncio.Future | None = None
    cmd_lock = asyncio.Lock()
    exit_event = asyncio.Event()

    async def send_command(cmd: str, expect_response: bool = True):
        nonlocal response_future
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("gdb stdin is closed")
        fut = None
        async with cmd_lock:
            if expect_response:
                fut = asyncio.get_running_loop().create_future()
                response_future = fut
            proc.stdin.write((cmd + "\n").encode())
            await proc.stdin.drain()
        if not expect_response or fut is None:
            return None
        try:
            return await asyncio.wait_for(fut, timeout=5.0)
        finally:
            if response_future is fut:
                response_future = None

    async def handle_stop(stop_line: str):
        if "exited" in stop_line:
            try:
                await ws.send_json({"type": "status", "data": "exited"})
            except Exception:
                pass
            exit_event.set()
            return

        top_frame = _parse_frame_from_stop(stop_line)

        stack_resp = ""
        locals_resp = ""
        try:
            stack_resp = await send_command("-stack-list-frames")
        except Exception:
            stack_resp = ""
        try:
            locals_resp = await send_command("-stack-list-variables --all-values")
        except Exception:
            locals_resp = ""

        stack = _parse_stack_frames(stack_resp)
        locals_map = _parse_locals_map(locals_resp)

        if not top_frame.get("file") and stack:
            top_frame["file"] = stack[0].get("file")
        if top_frame.get("line") is None and stack:
            top_frame["line"] = stack[0].get("line")
        if not top_frame.get("function") and stack:
            top_frame["function"] = stack[0].get("function")

        payload = {
            "file": top_frame.get("file"),
            "line": top_frame.get("line"),
            "function": top_frame.get("function"),
            "stack": stack,
            "locals": locals_map,
        }
        try:
            await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
        except Exception:
            pass

    async def pump_stdout():
        nonlocal response_future
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    if response_future and not response_future.done():
                        response_future.set_exception(RuntimeError("gdb stdout closed"))
                    exit_event.set()
                    break
                line = raw.decode(errors="ignore").strip()
                if not line or line == "(gdb)":
                    continue

                if line.startswith(("^done", "^running", "^error")):
                    if response_future and not response_future.done():
                        response_future.set_result(line)
                    continue

                if line.startswith(("~", "@")):
                    text = _mi_unquote(line[1:])
                    try:
                        await ws.send_json({"type": "out", "data": text})
                    except Exception:
                        pass
                    continue

                if line.startswith("&"):
                    text = _mi_unquote(line[1:])
                    try:
                        await ws.send_json({"type": "err", "data": text})
                    except Exception:
                        pass
                    continue

                if line.startswith("*stopped"):
                    asyncio.create_task(handle_stop(line))
                    continue

                if line.startswith("*running"):
                    try:
                        await ws.send_json({"type": "status", "data": "running"})
                    except Exception:
                        pass
                    continue

                if "exited-normally" in line or "exited" in line:
                    try:
                        await ws.send_json({"type": "status", "data": "exited"})
                    except Exception:
                        pass
                    exit_event.set()
                    break
        except Exception:
            exit_event.set()

    async def pump_stderr():
        try:
            while True:
                raw = await proc.stderr.readline()
                if not raw:
                    break
                text = raw.decode(errors="ignore")
                if text:
                    try:
                        await ws.send_json({"type": "err", "data": text})
                    except Exception:
                        pass
        except Exception:
            pass

    out_task = asyncio.create_task(pump_stdout())
    err_task = asyncio.create_task(pump_stderr())

    bp_registry: dict[tuple[str, int], str] = {}

    async def add_breakpoint(bp: dict, notify: bool = True):
        file = bp.get("file")
        line = bp.get("line")
        if not file or not line:
            raise ValueError("breakpoint requires file and line")
        resp = await send_command(f"-break-insert {file}:{line}")
        bkpt_id = _parse_break_id(resp or "")
        if bkpt_id:
            bp_registry[(file, int(line))] = bkpt_id
        if notify:
            await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [{"file": file, "line": line, "id": bkpt_id}]}})

    async def remove_breakpoint(bp: dict):
        file = bp.get("file")
        line = bp.get("line")
        bkpt_id = bp.get("id")
        if not bkpt_id and file and line:
            bkpt_id = bp_registry.get((file, int(line)))
        if not bkpt_id:
            raise ValueError("breakpoint id not found")
        await send_command(f"-break-delete {bkpt_id}")
        # remove all matching entries with this id
        for k, v in list(bp_registry.items()):
            if v == bkpt_id:
                bp_registry.pop(k, None)
        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [{"file": file, "line": line, "id": bkpt_id}]}})

    for bp in breakpoints:
        try:
            await add_breakpoint(bp, notify=False)
        except Exception as e:
            try:
                await ws.send_json({"type": "err", "data": f"failed to set breakpoint {bp}: {e}"})
            except Exception:
                pass

    try:
        await send_command("-exec-run")
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to start debug target: {e}"})
        except Exception:
            pass
        exit_event.set()

    try:
        await ws.send_json({"type": "status", "phase": "running", "mode": "debug"})
    except Exception:
        pass

    try:
        while True:
            recv_task = asyncio.create_task(ws.receive_text())
            exit_task = asyncio.create_task(exit_event.wait())
            done, pending = await asyncio.wait({recv_task, exit_task}, return_when=asyncio.FIRST_COMPLETED)

            if exit_task in done:
                recv_task.cancel()
                break

            try:
                raw = await recv_task
            except WebSocketDisconnect:
                break

            try:
                msg = json.loads(raw)
            except Exception:
                await ws.send_json({"type":"err","data": f"invalid msg: {raw}"})
                continue

            if msg.get("type") == "debug_cmd":
                cmd = msg.get("command")
                try:
                    if cmd == "continue":
                        await send_command("-exec-continue")
                    elif cmd == "next":
                        await send_command("-exec-next")
                    elif cmd == "step_in":
                        await send_command("-exec-step")
                    elif cmd == "step_out":
                        await send_command("-exec-finish")
                    elif cmd == "add_breakpoint":
                        await add_breakpoint({"file": msg.get("file"), "line": msg.get("line")})
                    elif cmd == "remove_breakpoint":
                        await remove_breakpoint({"file": msg.get("file"), "line": msg.get("line"), "id": msg.get("id")})
                    elif cmd == "stop":
                        await send_command("-gdb-exit", expect_response=False)
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type":"err","data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type":"err","data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                # C++ debug mode does not forward stdin for v1.
                continue
            else:
                await ws.send_json({"type":"err","data": f"unknown msg: {msg}"})
    except WebSocketDisconnect:
        pass
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        rc = -1
        try:
            rc = await proc.wait()
        except Exception:
            pass
        for t in (out_task, err_task):
            t.cancel()
        try:
            await ws.send_json({"type":"exit","code": rc})
        except Exception:
            pass
        await ws.close()
        sess["proc"] = None
        sess["state"] = "closed"
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)

@router.websocket("/ws/run/{sid}")
async def ws_run(ws: WebSocket, sid: str):
    await ws.accept()

    sess = SESSIONS.get(sid)
    if not sess:
        await ws.send_json({"type":"err","data":"invalid session_id"})
        return await ws.close()

    mode = sess.get("mode", "run")
    lang = sess.get("lang")

    if mode == "debug":
        if lang == "cpp":
            return await _handle_cpp_debug(ws, sess)
        else:
            await ws.send_json({"type":"err","data": f"debug not implemented for lang={lang}"})
            return await ws.close()

    lang, entry, args, files = sess["lang"], sess["entry"], sess["args"], sess["files"]

    # announce start (useful for client-side diagnostics)
    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry})
    except Exception:
        pass

    # create a temp folder and write files into it
    workdir = tempfile.mkdtemp(prefix=f"oc-{lang}-")
    _write_files(files, workdir)

    if not os.path.exists(os.path.join(workdir, entry)):
        await ws.send_json({"type":"err","data":f"entry not found: {entry}"})
        shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        proc, cmd_desc, using, mode = await _start_process(lang, entry, args, workdir)
    except Exception as e:
        err_msg = str(e)
        if not err_msg:
            try:
                err_msg = repr(e)
            except Exception:
                err_msg = e.__class__.__name__
        try:
            await ws.send_json({"type":"err","data": err_msg})
        except Exception:
            pass
        shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    # Inform client of the exact command/run mode for diagnostics
    try:
        # Log the full docker command being executed for diagnostics
        if cmd_desc:
            try:
                print(f"[status:exec] using={using} mode={mode} cmd={cmd_desc}")
            except Exception:
                pass
        await ws.send_json({"type": "status", "phase": "exec", "using": using, "mode": mode, "cmd": cmd_desc})
    except Exception:
        pass

    await ws.send_json({"type":"status","phase":"running"})

    # For interactive programs, read in chunks (not lines) so prompts without newline are delivered.
    # Important: the sentinel may span chunk boundaries; we keep a rolling carry buffer per stream.
    async def pump_async(reader, kind):
        carry = ""
        try:
            while True:
                chunk = await reader.read(1024)
                if not chunk:
                    if carry:
                        await ws.send_json({"type": kind, "data": carry})
                    break

                text = carry + chunk.decode(errors="ignore")
                carry = ""

                # Only parse sentinel on stdout; forward stderr verbatim
                if kind != "out":
                    if text:
                        await ws.send_json({"type": kind, "data": text})
                    continue

                s = SENTINEL
                i = 0
                while True:
                    j = text.find(s, i)
                    if j == -1:
                        # No full sentinel found; retain any suffix that matches a prefix of the sentinel
                        # so we can complete it with the next chunk.
                        tail_len = 0
                        max_tail = min(len(s) - 1, len(text) - i)
                        for k in range(max_tail, 0, -1):
                            if text.endswith(s[:k]):
                                tail_len = k
                                break
                        emit_part = text[i: len(text) - tail_len] if tail_len > 0 else text[i:]
                        if emit_part:
                            await ws.send_json({"type": kind, "data": emit_part})
                            # Heuristic: if stdout doesn't end with newline, likely a prompt → enable input
                            if kind == "out" and not emit_part.endswith("\n"):
                                await ws.send_json({"type": "awaiting_input", "value": True})
                        carry = text[-tail_len:] if tail_len > 0 else ""
                        break

                    # Emit any stdout preceding the sentinel
                    if j > i:
                        part = text[i:j]
                        await ws.send_json({"type": kind, "data": part})
                        # Heuristic: if stdout doesn't end with newline, likely a prompt → enable input
                        if part and not part.endswith("\n"):
                            await ws.send_json({"type": "awaiting_input", "value": True})
                    # Notify client that program is awaiting input (explicit sentinel)
                    await ws.send_json({"type": "awaiting_input", "value": True})
                    i = j + len(s)
        except Exception:
            pass


    t_out = asyncio.create_task(pump_async(proc.stdout, "out"))
    t_err = asyncio.create_task(pump_async(proc.stderr, "err"))

    WALL = 60
    async def watchdog():
        await asyncio.sleep(WALL)
        if proc.returncode is None:
            proc.kill()
    t_wd = asyncio.create_task(watchdog())

    try:
        # Race the process exit with inbound WS messages so session ends promptly after program finishes.
        proc_wait = asyncio.create_task(proc.wait())

        while True:
            recv_task = asyncio.create_task(ws.receive_text())
            done, pending = await asyncio.wait({recv_task, proc_wait}, return_when=asyncio.FIRST_COMPLETED)

            if proc_wait in done:
                # Process exited; stop consuming messages
                for t in pending:
                    t.cancel()
                break

            # We have a WS message
            try:
                raw = await recv_task
            except WebSocketDisconnect:
                if proc.returncode is None:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                break

            try:
                msg = json.loads(raw)
            except Exception:
                await ws.send_json({"type":"err","data": f"invalid msg: {raw}"})
                continue

            if msg.get("type") == "in":
                data = msg.get("data", "")
                if not data:
                    continue
                try:
                    if proc.stdin and not proc.stdin.is_closing():
                        proc.stdin.write(data.encode())
                        await proc.stdin.drain()
                    # After forwarding a line to the program, assume it's no longer awaiting input
                    try:
                        await ws.send_json({"type": "awaiting_input", "value": False})
                    except Exception:
                        pass
                except Exception:
                    # ignore broken pipe on late input
                    pass
            elif msg.get("type") in ("close", "stop"):
                # Allow both 'close' (existing) and 'stop' (new alias) from client
                try:
                    await ws.send_json({"type": "status", "phase": "stopping"})
                except Exception:
                    pass
                try:
                    proc.terminate()
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            else:
                await ws.send_json({"type":"err","data": f"unknown msg: {msg}"})
    except WebSocketDisconnect:
        if proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass
    finally:
        rc = -1
        try:
            rc = await proc.wait()
        except Exception:
            pass
        for t in (t_out, t_err, t_wd):
            t.cancel()
        try:
            await ws.send_json({"type":"exit","code": rc})
        except Exception:
            pass
        await ws.close()
        shutil.rmtree(workdir, ignore_errors=True)
