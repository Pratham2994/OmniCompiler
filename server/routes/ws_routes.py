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
    breakpoints = list(sess.get("breakpoints") or [])
    workdir = sess.get("workdir")
    proc = sess.get("proc")

    if not proc or not workdir:
        await ws.send_json({"type": "err", "data": "debug session missing process/workdir"})
        return await ws.close()
    if proc.returncode is not None:
        await ws.send_json({"type": "err", "data": "debug session already ended"})
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    exit_event = asyncio.Event()
    cmd_lock = asyncio.Lock()

    async def send_cmd(payload: dict):
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("debugger stdin closed")
        data = json.dumps(payload) + "\n"
        async with cmd_lock:
            proc.stdin.write(data.encode())
            await proc.stdin.drain()

    async def sync_breakpoints():
        await send_cmd({"type": "set_breakpoints", "breakpoints": breakpoints})

    async def pump_stdout():
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                line = raw.decode(errors="ignore").rstrip("\n")
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except Exception:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
                    continue

                event = evt.get("event")
                body = evt.get("body", {}) or {}
                if event == "stopped":
                    stack = body.get("stack") or []
                    payload = {
                        "file": body.get("file"),
                        "line": body.get("line"),
                        "function": body.get("function"),
                        "stack": stack,
                        "locals": body.get("locals") or {},
                    }
                    try:
                        await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
                    except Exception:
                        pass
                elif event == "exception":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "exception", "payload": body})
                    except Exception:
                        pass
                elif event == "evaluate_result":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": body})
                    except Exception:
                        pass
                elif event == "terminated":
                    try:
                        await ws.send_json({"type": "status", "data": "exited"})
                    except Exception:
                        pass
                    exit_event.set()
                    break
                elif event == "breakpoints_set":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"synced": True}})
                    except Exception:
                        pass
                elif event == "await_input":
                    try:
                        await ws.send_json({"type": "awaiting_input", "value": True, "prompt": body.get("prompt", "")})
                    except Exception:
                        pass
                elif event == "output":
                    stream = body.get("stream", "stdout")
                    data = body.get("data", "")
                    try:
                        await ws.send_json({"type": "out" if stream == "stdout" else "err", "data": data})
                        if stream == "stdout" and data and not str(data).endswith("\n"):
                            await ws.send_json({"type": "awaiting_input", "value": True})
                    except Exception:
                        pass
                else:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
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

    try:
        if breakpoints:
            await sync_breakpoints()
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to sync breakpoints: {e}"})
        except Exception:
            pass

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
                        await send_cmd({"type": "continue"})
                    elif cmd == "next":
                        await send_cmd({"type": "step_over"})
                    elif cmd == "step_in":
                        await send_cmd({"type": "step_in"})
                    elif cmd == "step_out":
                        await send_cmd({"type": "step_out"})
                    elif cmd == "add_breakpoint":
                        bp = {"file": msg.get("file"), "line": msg.get("line")}
                        if bp not in breakpoints:
                            breakpoints.append(bp)
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [bp]}})
                    elif cmd == "remove_breakpoint":
                        target = {"file": msg.get("file"), "line": msg.get("line")}
                        breakpoints[:] = [b for b in breakpoints if not (b.get("file") == target["file"] and b.get("line") == target["line"])]
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [target]}})
                    elif cmd == "evaluate":
                        expr = msg.get("expr", "")
                        await send_cmd({"type": "evaluate", "expr": expr})
                    elif cmd == "stop":
                        await send_cmd({"type": "stop"})
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type":"err","data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type":"err","data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                data = msg.get("data", "")
                try:
                    await send_cmd({"type": "stdin", "data": data})
                    await ws.send_json({"type": "awaiting_input", "value": False})
                except Exception:
                    pass
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

async def _handle_python_debug(ws: WebSocket, sess: dict):
    lang = sess.get("lang")
    entry = sess.get("entry")
    breakpoints = list(sess.get("breakpoints") or [])
    workdir = sess.get("workdir")
    proc = sess.get("proc")

    if not proc or not workdir:
        await ws.send_json({"type": "err", "data": "debug session missing process/workdir"})
        return await ws.close()
    if proc.returncode is not None:
        await ws.send_json({"type": "err", "data": "debug session already ended"})
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    exit_event = asyncio.Event()
    cmd_lock = asyncio.Lock()

    async def send_cmd(payload: dict):
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("debugger stdin closed")
        data = json.dumps(payload) + "\n"
        async with cmd_lock:
            proc.stdin.write(data.encode())
            await proc.stdin.drain()

    async def sync_breakpoints():
        await send_cmd({"type": "set_breakpoints", "breakpoints": breakpoints})

    async def pump_stdout():
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                line = raw.decode(errors="ignore").rstrip("\n")
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except Exception:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
                    continue

                event = evt.get("event")
                body = evt.get("body", {}) or {}
                if event == "stopped":
                    stack = body.get("stack") or []
                    top_func = stack[0].get("func") if stack else None
                    payload = {
                        "file": body.get("file"),
                        "line": body.get("line"),
                        "function": top_func,
                        "stack": stack,
                        "locals": body.get("locals") or {},
                    }
                    try:
                        await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
                    except Exception:
                        pass
                elif event == "exception":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "exception", "payload": body})
                    except Exception:
                        pass
                elif event == "evaluate_result":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": body})
                    except Exception:
                        pass
                elif event == "terminated":
                    try:
                        await ws.send_json({"type": "status", "data": "exited"})
                    except Exception:
                        pass
                    exit_event.set()
                    break
                elif event == "breakpoints_set":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"synced": True}})
                    except Exception:
                        pass
                else:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
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

    # send initial breakpoints to debugger
    try:
        if breakpoints:
            await sync_breakpoints()
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to sync breakpoints: {e}"})
        except Exception:
            pass

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
                        await send_cmd({"type": "continue"})
                    elif cmd == "next":
                        await send_cmd({"type": "step_over"})
                    elif cmd == "step_in":
                        await send_cmd({"type": "step_in"})
                    elif cmd == "step_out":
                        await send_cmd({"type": "step_out"})
                    elif cmd == "add_breakpoint":
                        bp = {"file": msg.get("file"), "line": msg.get("line")}
                        if bp not in breakpoints:
                            breakpoints.append(bp)
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [bp]}})
                    elif cmd == "remove_breakpoint":
                        target = {"file": msg.get("file"), "line": msg.get("line")}
                        breakpoints[:] = [b for b in breakpoints if not (b.get("file") == target["file"] and b.get("line") == target["line"])]
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [target]}})
                    elif cmd == "evaluate":
                        expr = msg.get("expr", "")
                        await send_cmd({"type": "evaluate", "expr": expr})
                    elif cmd == "stop":
                        await send_cmd({"type": "stop"})
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type":"err","data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type":"err","data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                data = msg.get("data", "")
                try:
                    await send_cmd({"type": "stdin", "data": data})
                    try:
                        await ws.send_json({"type": "awaiting_input", "value": False})
                    except Exception:
                        pass
                except Exception as e:
                    await ws.send_json({"type":"err","data": f"stdin failed: {e}"})
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

async def _handle_js_debug(ws: WebSocket, sess: dict):
    lang = sess.get("lang")
    entry = sess.get("entry")
    breakpoints = list(sess.get("breakpoints") or [])
    workdir = sess.get("workdir")
    proc = sess.get("proc")

    if not proc or not workdir:
        await ws.send_json({"type": "err", "data": "debug session missing process/workdir"})
        return await ws.close()
    if proc.returncode is not None:
        out, err = b"", b""
        try:
            out, err = proc.communicate(timeout=1)
        except Exception:
            pass
        msg = "debug session already ended"
        detail_parts = []
        if proc.returncode is not None:
            detail_parts.append(f"rc={proc.returncode}")
        if out:
            detail_parts.append(f"stdout={out.decode(errors='ignore').strip()}")
        if err:
            detail_parts.append(f"stderr={err.decode(errors='ignore').strip()}")
        if detail_parts:
            msg = f"{msg} ({'; '.join(detail_parts)})"
        await ws.send_json({"type": "err", "data": msg})
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    exit_event = asyncio.Event()
    cmd_lock = asyncio.Lock()

    async def send_cmd(payload: dict):
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("debugger stdin closed")
        data = json.dumps(payload) + "\n"
        async with cmd_lock:
            proc.stdin.write(data.encode())
            await proc.stdin.drain()

    async def sync_breakpoints():
        await send_cmd({"type": "set_breakpoints", "breakpoints": breakpoints})

    async def pump_stdout():
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                line = raw.decode(errors="ignore").rstrip("\n")
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except Exception:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
                    continue

                event = evt.get("event")
                body = evt.get("body", {}) or {}
                if event == "stopped":
                    stack = body.get("stack") or []
                    payload = {
                        "file": body.get("file"),
                        "line": body.get("line"),
                        "function": body.get("function"),
                        "stack": stack,
                        "locals": body.get("locals") or {},
                    }
                    try:
                        await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
                    except Exception:
                        pass
                elif event == "exception":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "exception", "payload": body})
                    except Exception:
                        pass
                elif event == "evaluate_result":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": body})
                    except Exception:
                        pass
                elif event == "terminated":
                    try:
                        await ws.send_json({"type": "status", "data": "exited"})
                    except Exception:
                        pass
                    exit_event.set()
                    break
                elif event == "breakpoints_set":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"synced": True}})
                    except Exception:
                        pass
                elif event == "await_input":
                    try:
                        await ws.send_json({"type": "awaiting_input", "value": True, "prompt": body.get("prompt", "")})
                    except Exception:
                        pass
                elif event == "output":
                    stream = body.get("stream", "stdout")
                    data = body.get("text", body.get("data", ""))
                    try:
                        await ws.send_json({"type": "out" if stream == "stdout" else "err", "data": data})
                        if stream == "stdout" and data and not str(data).endswith("\n"):
                            await ws.send_json({"type": "awaiting_input", "value": True})
                    except Exception:
                        pass
                else:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
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

    try:
        if breakpoints:
            await sync_breakpoints()
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to sync breakpoints: {e}"})
        except Exception:
            pass

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
                        await send_cmd({"type": "continue"})
                    elif cmd == "next":
                        await send_cmd({"type": "step_over"})
                    elif cmd == "step_in":
                        await send_cmd({"type": "step_in"})
                    elif cmd == "step_out":
                        await send_cmd({"type": "step_out"})
                    elif cmd == "add_breakpoint":
                        bp = {"file": msg.get("file"), "line": msg.get("line")}
                        if bp not in breakpoints:
                            breakpoints.append(bp)
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [bp]}})
                    elif cmd == "remove_breakpoint":
                        target = {"file": msg.get("file"), "line": msg.get("line")}
                        breakpoints[:] = [b for b in breakpoints if not (b.get("file") == target["file"] and b.get("line") == target["line"])]
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [target]}})
                    elif cmd == "evaluate":
                        expr = msg.get("expr", "")
                        await send_cmd({"type": "evaluate", "expr": expr})
                    elif cmd == "stop":
                        await send_cmd({"type": "stop"})
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type":"err","data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type":"err","data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                data = msg.get("data", "")
                try:
                    await send_cmd({"type": "stdin", "data": data})
                    await ws.send_json({"type": "awaiting_input", "value": False})
                except Exception:
                    pass
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

async def _handle_java_debug(ws: WebSocket, sess: dict):
    lang = sess.get("lang")
    entry = sess.get("entry")
    breakpoints = list(sess.get("breakpoints") or [])
    workdir = sess.get("workdir")
    proc = sess.get("proc")

    if not proc or not workdir:
        await ws.send_json({"type": "err", "data": "debug session missing process/workdir"})
        return await ws.close()
    if proc.returncode is not None:
        out, err = b"", b""
        try:
            out, err = proc.communicate(timeout=1)
        except Exception:
            pass
        msg = "debug session already ended"
        detail_parts = []
        if proc.returncode is not None:
            detail_parts.append(f"rc={proc.returncode}")
        if out:
            detail_parts.append(f"stdout={out.decode(errors='ignore').strip()}")
        if err:
            detail_parts.append(f"stderr={err.decode(errors='ignore').strip()}")
        if detail_parts:
            msg = f"{msg} ({'; '.join(detail_parts)})"
        await ws.send_json({"type": "err", "data": msg})
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    exit_event = asyncio.Event()
    cmd_lock = asyncio.Lock()

    async def send_cmd(payload: dict):
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("debugger stdin closed")
        data = json.dumps(payload) + "\n"
        async with cmd_lock:
            proc.stdin.write(data.encode())
            await proc.stdin.drain()

    async def sync_breakpoints():
        await send_cmd({"type": "set_breakpoints", "breakpoints": breakpoints})

    async def pump_stdout():
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                line = raw.decode(errors="ignore").rstrip("\n")
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except Exception:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
                    continue

                event = evt.get("event")
                body = evt.get("body", {}) or {}
                if event == "stopped":
                    stack = body.get("stack") or []
                    payload = {
                        "file": body.get("file"),
                        "line": body.get("line"),
                        "function": body.get("function"),
                        "stack": stack,
                        "locals": body.get("locals") or {},
                    }
                    try:
                        await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
                    except Exception:
                        pass
                elif event == "exception":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "exception", "payload": body})
                    except Exception:
                        pass
                elif event == "evaluate_result":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": body})
                    except Exception:
                        pass
                elif event == "terminated":
                    try:
                        await ws.send_json({"type": "status", "data": "exited"})
                    except Exception:
                        pass
                    exit_event.set()
                    break
                elif event == "breakpoints_set":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"synced": True}})
                    except Exception:
                        pass
                elif event == "await_input":
                    try:
                        await ws.send_json({"type": "awaiting_input", "value": True, "prompt": body.get("prompt", "")})
                    except Exception:
                        pass
                elif event == "output":
                    stream = body.get("stream", "stdout")
                    data = body.get("text", body.get("data", ""))
                    try:
                        await ws.send_json({"type": "out" if stream == "stdout" else "err", "data": data})
                        if stream == "stdout" and data and not str(data).endswith("\n"):
                            await ws.send_json({"type": "awaiting_input", "value": True})
                    except Exception:
                        pass
                else:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
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

    try:
        if breakpoints:
            await sync_breakpoints()
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to sync breakpoints: {e}"})
        except Exception:
            pass

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
                        await send_cmd({"type": "continue"})
                    elif cmd == "next":
                        await send_cmd({"type": "step_over"})
                    elif cmd == "step_in":
                        await send_cmd({"type": "step_in"})
                    elif cmd == "step_out":
                        await send_cmd({"type": "step_out"})
                    elif cmd == "add_breakpoint":
                        bp = {"file": msg.get("file"), "line": msg.get("line")}
                        if bp not in breakpoints:
                            breakpoints.append(bp)
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [bp]}})
                    elif cmd == "remove_breakpoint":
                        target = {"file": msg.get("file"), "line": msg.get("line")}
                        breakpoints[:] = [b for b in breakpoints if not (b.get("file") == target["file"] and b.get("line") == target["line"])]
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [target]}})
                    elif cmd == "evaluate":
                        expr = msg.get("expr", "")
                        await send_cmd({"type": "evaluate", "expr": expr})
                    elif cmd == "stop":
                        await send_cmd({"type": "stop"})
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type":"err","data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type":"err","data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                data = msg.get("data", "")
                try:
                    await send_cmd({"type": "stdin", "data": data})
                    await ws.send_json({"type": "awaiting_input", "value": False})
                except Exception:
                    pass
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

async def _handle_go_debug(ws: WebSocket, sess: dict):
    lang = sess.get("lang")
    entry = sess.get("entry")
    breakpoints = list(sess.get("breakpoints") or [])
    workdir = sess.get("workdir")
    proc = sess.get("proc")

    if not proc or not workdir:
        await ws.send_json({"type": "err", "data": "debug session missing process/workdir"})
        return await ws.close()
    if proc.returncode is not None:
        out, err = b"", b""
        try:
            out, err = proc.communicate(timeout=1)
        except Exception:
            pass
        msg = "debug session already ended"
        detail_parts = []
        if proc.returncode is not None:
            detail_parts.append(f"rc={proc.returncode}")
        if out:
            detail_parts.append(f"stdout={out.decode(errors='ignore').strip()}")
        if err:
            detail_parts.append(f"stderr={err.decode(errors='ignore').strip()}")
        if detail_parts:
            msg = f"{msg} ({'; '.join(detail_parts)})"
        await ws.send_json({"type": "err", "data": msg})
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    exit_event = asyncio.Event()
    cmd_lock = asyncio.Lock()
    paused = asyncio.Event()
    command_future: asyncio.Future | None = None
    command_buffer: list[str] = []

    async def send_cmd(cmd: str):
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("dlv stdin closed")
        async with cmd_lock:
            proc.stdin.write((cmd + "\n").encode())
            await proc.stdin.drain()

    async def send_query(cmd: str, timeout: float = 3.0) -> list[str]:
        nonlocal command_future, command_buffer
        if command_future is not None:
            raise RuntimeError("command already in flight")
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        command_future = fut
        command_buffer = []
        await send_cmd(cmd)
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except Exception:
            if not fut.done():
                fut.cancel()
            return list(command_buffer)
        finally:
            if command_future is fut:
                command_future = None
                command_buffer = []

    async def add_bp(bp):
        file = bp.get("file")
        line = bp.get("line")
        if not file or not line:
            return
        await send_cmd(f"break {file}:{line}")

    async def remove_bp(bp):
        file = bp.get("file")
        line = bp.get("line")
        if not file or not line:
            return
        await send_cmd(f"clear {file}:{line}")

    async def sync_breakpoints():
        for bp in breakpoints:
            try:
                await add_bp(bp)
            except Exception:
                pass
        try:
            await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"synced": True}})
        except Exception:
            pass

    async def handle_paused(file: str | None, line: int | None):
        # Collect stack and locals from delve
        stack = []
        locals_map: dict[str, str] = {}

        try:
            stack_lines = await send_query("stack")
            for ln in stack_lines:
                # Example: 0  0x10565c0 in main.main /work/main.go:7
                m = re.match(r'\s*\d+\s+\S+\s+in\s+([^\s]+)\s+([^\s]+):(\d+)', ln)
                if not m:
                    continue
                func = m.group(1)
                f = m.group(2)
                try:
                    lno = int(m.group(3))
                except Exception:
                    lno = None
                stack.append({"file": f, "line": lno, "function": func})
            if stack and (file is None or line is None):
                file = file or stack[0].get("file")
                line = line or stack[0].get("line")
        except Exception:
            pass

        try:
            loc_lines = await send_query("locals")
            for ln in loc_lines:
                if "=" not in ln:
                    continue
                name, val = ln.split("=", 1)
                locals_map[name.strip()] = val.strip()
        except Exception:
            pass

        payload = {
            "file": file,
            "line": line,
            "function": stack[0].get("function") if stack else None,
            "stack": stack,
            "locals": locals_map,
        }
        try:
            await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
        except Exception:
            pass
        paused.set()

    async def pump_stdout():
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                text = raw.decode(errors="ignore").rstrip("\n")
                if not text:
                    continue

                stripped = text.strip()

                # Capture responses for in-flight queries until prompt "(dlv)"
                if command_future is not None:
                    if stripped.endswith("(dlv)"):
                        if not command_future.done():
                            command_future.set_result(command_buffer)
                        command_future = None
                        command_buffer = []
                        continue
                    command_buffer.append(text)
                    continue

                # Detect prompt
                if stripped.endswith("(dlv)"):
                    continue

                # Detect pause line e.g., "> main.main() /work/main.go:5 (hits goroutine ...)"
                m = re.match(r'>\s+[^\s]+\s+\(([^:]+):(\d+)\)', text)
                if m:
                    file = m.group(1)
                    try:
                        line = int(m.group(2))
                    except Exception:
                        line = None
                    await handle_paused(file, line)
                    continue

                try:
                    await ws.send_json({"type": "out", "data": text + "\n"})
                except Exception:
                    pass
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

    try:
        if breakpoints:
            await sync_breakpoints()
        await send_cmd("continue")
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to start dlv: {e}"})
        except Exception:
            pass

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
                await ws.send_json({"type": "err", "data": f"invalid msg: {raw}"})
                continue

            if msg.get("type") == "debug_cmd":
                cmd = msg.get("command")
                try:
                    if cmd == "continue":
                        paused.clear()
                        await send_cmd("continue")
                    elif cmd == "next":
                        paused.clear()
                        await send_cmd("next")
                    elif cmd == "step_in":
                        paused.clear()
                        await send_cmd("step")
                    elif cmd == "step_out":
                        paused.clear()
                        await send_cmd("stepout")
                    elif cmd == "add_breakpoint":
                        bp = {"file": msg.get("file"), "line": msg.get("line")}
                        if bp not in breakpoints:
                            breakpoints.append(bp)
                        await add_bp(bp)
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [bp]}})
                    elif cmd == "remove_breakpoint":
                        target = {"file": msg.get("file"), "line": msg.get("line")}
                        breakpoints[:] = [b for b in breakpoints if not (b.get("file") == target["file"] and b.get("line") == target["line"])]
                        await remove_bp(target)
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [target]}})
                    elif cmd == "evaluate":
                        expr = msg.get("expr", "")
                        try:
                            res_lines = await send_query(f"print {expr}")
                            res = "\n".join(res_lines).strip()
                        except Exception as e:
                            res = f"error: {e}"
                        await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": {"expr": expr, "value": res}})
                    elif cmd == "stop":
                        await send_cmd("quit")
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type": "err", "data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type": "err", "data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                continue
            else:
                await ws.send_json({"type": "err", "data": f"unknown msg: {msg}"})
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
            from starlette.websockets import WebSocketState  # type: ignore
            state = getattr(ws, "application_state", None)
            if state is None or state != WebSocketState.DISCONNECTED:
                try:
                    await ws.send_json({"type": "exit", "code": rc})
                except Exception:
                    pass
                try:
                    await ws.close()
                except Exception:
                    pass
        except Exception:
            try:
                await ws.close()
            except Exception:
                pass
        sess["proc"] = None
        sess["state"] = "closed"
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    exit_event = asyncio.Event()
    cmd_lock = asyncio.Lock()
    paused = asyncio.Event()
    command_future: asyncio.Future | None = None
    command_buffer: list[str] = []

    async def send_raw(cmd: str):
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("jdb stdin closed")
        async with cmd_lock:
            proc.stdin.write((cmd + "\n").encode())
            await proc.stdin.drain()

    async def send_query(cmd: str, timeout: float = 3.0) -> list[str]:
        nonlocal command_future, command_buffer
        if command_future is not None:
            raise RuntimeError("command already in flight")
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        command_future = fut
        command_buffer = []
        await send_raw(cmd)
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except Exception:
            # On timeout/error, return whatever we buffered so far
            if not fut.done():
                fut.cancel()
            return list(command_buffer)
        finally:
            if command_future is fut:
                command_future = None
                command_buffer = []

    async def add_bp(bp):
        file = bp.get("file")
        line = bp.get("line")
        if not file or not line:
            return
        cls = os.path.splitext(os.path.basename(file))[0]
        await send_raw(f"stop at {cls}:{line}")

    async def remove_bp(bp):
        file = bp.get("file")
        line = bp.get("line")
        if not file or not line:
            return
        cls = os.path.splitext(os.path.basename(file))[0]
        await send_raw(f"clear {cls}:{line}")

    async def sync_breakpoints():
        # jdb has no bulk set; apply individually
        for bp in breakpoints:
            try:
                await add_bp(bp)
            except Exception:
                pass
        try:
            await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"synced": True}})
        except Exception:
            pass

    async def handle_paused(file: str | None, line: int | None, reason: str | None = None):
        """
        Collect stack and locals when paused and emit a single paused event.
        """
        if file is None:
            file = entry_file or None

        stack = []
        locals_map: dict[str, str] = {}

        # Grab stack frames
        where_lines = await send_query("where")
        for ln in where_lines:
            m = re.search(r'\[\d+\]\s+([^\s]+)\s+\(([^:]+):(\d+)\)', ln)
            if not m:
                continue
            func = m.group(1)
            f = m.group(2)
            try:
                lno = int(m.group(3))
            except Exception:
                lno = None
            stack.append({"file": f, "line": lno, "function": func})
        if stack and (line is None or file is None):
            file = file or stack[0].get("file")
            line = line or stack[0].get("line")

        # Grab locals
        loc_lines = await send_query("locals")
        for ln in loc_lines:
            if "=" not in ln:
                continue
            name, val = ln.split("=", 1)
            locals_map[name.strip()] = val.strip()

        payload = {
            "file": file,
            "line": line,
            "function": stack[0].get("function") if stack else None,
            "stack": stack,
            "locals": locals_map,
        }
        try:
            await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
        except Exception:
            pass
        paused.set()

    async def pump_stdout():
        nonlocal command_future, command_buffer
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                text = raw.decode(errors="ignore").rstrip("\n")
                if not text:
                    continue

                # Capture responses for in-flight queries (where/locals/eval)
                if command_future is not None:
                    # Collect lines for the active query until we see a prompt ending with ">"
                    if text.strip().endswith(">"):
                        if not command_future.done():
                            command_future.set_result(command_buffer)
                        command_future = None
                        command_buffer = []
                        continue
                    command_buffer.append(text)
                    continue

                # Suppress noisy jdb automatic prints we will replace with structured data
                if text.startswith("Local variables:") or text.startswith("Method arguments:"):
                    continue
                if re.match(r'^\s*(args|h|x)\s*=', text):
                    continue

                # Detect stop/step
                if "Breakpoint hit:" in text or "Step completed:" in text:
                    m = re.search(r'\(([^:]+\.java):(\d+)\)', text)
                    file = m.group(1) if m else None
                    try:
                        line = int(m.group(2)) if m else None
                    except Exception:
                        line = None
                    await handle_paused(file, line, "breakpoint")
                    continue

                # Frame echo line (e.g., "main[1] [1] Main.main (Main.java:5)")
                m_frame = re.match(r'.*\[\d+\]\s+([^\s]+)\s+\(([^:]+):(\d+)\)', text)
                if m_frame:
                    func = m_frame.group(1)
                    file = m_frame.group(2)
                    try:
                        line_no = int(m_frame.group(3))
                    except Exception:
                        line_no = None
                    await handle_paused(file, line_no, "step")
                    continue

                # Source echo lines (e.g., "3 Helper h = new Helper();", "main[1] 3 Helper h = new Helper();")
                m_src = re.match(r'\s*(?:\w+\[\d+\]\s+)?(\d+)\s+.+', text)
                if m_src and not paused.is_set():
                    try:
                        line_no = int(m_src.group(1))
                    except Exception:
                        line_no = None
                    await handle_paused(entry_file, line_no, "step")
                    continue

                if "Exception occurred:" in text:
                    m = re.search(r'\(([^:]+\.java):(\d+)\)', text)
                    file = m.group(1) if m else None
                    try:
                        line = int(m.group(2)) if m else None
                    except Exception:
                        line = None
                    try:
                        await ws.send_json({"type": "debug_event", "event": "exception", "payload": {"file": file, "line": line, "message": text}})
                    except Exception:
                        pass
                    paused.set()
                    continue

                # Prompts are typically ">" or "<class>[1]"
                if text.strip().endswith(">"):
                    continue

                # Forward as output
                try:
                    await ws.send_json({"type": "out", "data": text + "\n"})
                except Exception:
                    pass
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

    # Apply breakpoints then run
    try:
        if breakpoints:
            await sync_breakpoints()
        await send_raw("run")
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to start jdb: {e}"})
        except Exception:
            pass

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
                await ws.send_json({"type": "err", "data": f"invalid msg: {raw}"})
                continue

            if msg.get("type") == "debug_cmd":
                cmd = msg.get("command")
                try:
                    if cmd == "continue":
                        paused.clear()
                        await send_raw("cont")
                    elif cmd == "next":
                        paused.clear()
                        await send_raw("next")
                    elif cmd == "step_in":
                        paused.clear()
                        await send_raw("step")
                    elif cmd == "step_out":
                        paused.clear()
                        await send_raw("step up")
                    elif cmd == "add_breakpoint":
                        bp = {"file": msg.get("file"), "line": msg.get("line")}
                        if bp not in breakpoints:
                            breakpoints.append(bp)
                        await add_bp(bp)
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [bp]}})
                    elif cmd == "remove_breakpoint":
                        target = {"file": msg.get("file"), "line": msg.get("line")}
                        breakpoints[:] = [b for b in breakpoints if not (b.get("file") == target["file"] and b.get("line") == target["line"])]
                        await remove_bp(target)
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [target]}})
                    elif cmd == "evaluate":
                        if not paused.is_set():
                            await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": {"expr": msg.get("expr", ""), "error": "not paused"}})
                            continue
                        expr = msg.get("expr", "")
                        try:
                            res_lines = await send_query(f"print {expr}")
                            res = "\n".join(res_lines).strip()
                        except Exception as e:
                            res = f"error: {e}"
                        await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": {"expr": expr, "value": res}})
                    elif cmd == "stop":
                        await send_raw("quit")
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type": "err", "data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type": "err", "data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                continue
            else:
                await ws.send_json({"type": "err", "data": f"unknown msg: {msg}"})
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
            from starlette.websockets import WebSocketState  # type: ignore
            state = getattr(ws, "application_state", None)
            if state is None or state != WebSocketState.DISCONNECTED:
                try:
                    await ws.send_json({"type": "exit", "code": rc})
                except Exception:
                    pass
                try:
                    await ws.close()
                except Exception:
                    pass
        except Exception:
            # fall back silently if starlette isn't available
            try:
                await ws.close()
            except Exception:
                pass
        sess["proc"] = None
        sess["state"] = "closed"
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)

    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry, "mode": "debug"})
    except Exception:
        pass

    exit_event = asyncio.Event()
    cmd_lock = asyncio.Lock()

    async def send_cmd(payload: dict):
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("debugger stdin closed")
        data = json.dumps(payload) + "\n"
        async with cmd_lock:
            proc.stdin.write(data.encode())
            await proc.stdin.drain()

    async def sync_breakpoints():
        await send_cmd({"type": "set_breakpoints", "breakpoints": breakpoints})

    async def pump_stdout():
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                line = raw.decode(errors="ignore").rstrip("\n")
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except Exception:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
                    continue

                event = evt.get("event")
                body = evt.get("body", {}) or {}
                if event == "stopped":
                    stack = body.get("stack") or []
                    payload = {
                        "file": body.get("file"),
                        "line": body.get("line"),
                        "function": body.get("function"),
                        "stack": stack,
                        "locals": body.get("locals") or {},
                    }
                    try:
                        await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
                    except Exception:
                        pass
                elif event == "exception":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "exception", "payload": body})
                    except Exception:
                        pass
                elif event == "evaluate_result":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "evaluate_result", "payload": body})
                    except Exception:
                        pass
                elif event == "terminated":
                    try:
                        await ws.send_json({"type": "status", "data": "exited"})
                    except Exception:
                        pass
                    exit_event.set()
                    break
                elif event == "breakpoints_set":
                    try:
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"synced": True}})
                    except Exception:
                        pass
                elif event == "await_input":
                    try:
                        await ws.send_json({"type": "awaiting_input", "value": True, "prompt": body.get("prompt", "")})
                    except Exception:
                        pass
                else:
                    try:
                        await ws.send_json({"type": "out", "data": line + "\n"})
                    except Exception:
                        pass
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

    try:
        if breakpoints:
            await sync_breakpoints()
    except Exception as e:
        try:
            await ws.send_json({"type": "err", "data": f"failed to sync breakpoints: {e}"})
        except Exception:
            pass

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
                await ws.send_json({"type": "err", "data": f"invalid msg: {raw}"})
                continue

            if msg.get("type") == "debug_cmd":
                cmd = msg.get("command")
                try:
                    if cmd == "continue":
                        await send_cmd({"type": "continue"})
                    elif cmd == "next":
                        await send_cmd({"type": "step_over"})
                    elif cmd == "step_in":
                        await send_cmd({"type": "step_in"})
                    elif cmd == "step_out":
                        await send_cmd({"type": "step_out"})
                    elif cmd == "add_breakpoint":
                        bp = {"file": msg.get("file"), "line": msg.get("line")}
                        if bp not in breakpoints:
                            breakpoints.append(bp)
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"added": [bp]}})
                    elif cmd == "remove_breakpoint":
                        target = {"file": msg.get("file"), "line": msg.get("line")}
                        breakpoints[:] = [b for b in breakpoints if not (b.get("file") == target["file"] and b.get("line") == target["line"])]
                        await sync_breakpoints()
                        await ws.send_json({"type": "debug_event", "event": "breakpoints", "payload": {"removed": [target]}})
                    elif cmd == "evaluate":
                        expr = msg.get("expr", "")
                        await send_cmd({"type": "evaluate", "expr": expr})
                    elif cmd == "stop":
                        await send_cmd({"type": "stop"})
                        exit_event.set()
                        break
                    else:
                        await ws.send_json({"type": "err", "data": f"unknown debug cmd: {cmd}"})
                except Exception as e:
                    await ws.send_json({"type": "err", "data": f"debug command failed: {e}"})
            elif msg.get("type") == "stdin":
                continue
            else:
                await ws.send_json({"type": "err", "data": f"unknown msg: {msg}"})
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
            await ws.send_json({"type": "exit", "code": rc})
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
        elif lang == "python":
            return await _handle_python_debug(ws, sess)
        elif lang == "javascript":
            return await _handle_js_debug(ws, sess)
        elif lang == "java":
            return await _handle_java_debug(ws, sess)
        elif lang == "go":
            return await _handle_go_debug(ws, sess)
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
