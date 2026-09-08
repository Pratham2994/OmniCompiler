from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio, json, tempfile, os, textwrap, shutil, shlex, subprocess, re

SENTINEL = "<<<OC_AWAIT>>>"


from .run_routes import SESSIONS, name_container, remove_container

router = APIRouter()


SENTINEL = "<<<OC_AWAIT>>>"

@router.websocket("/ws/echo")
async def ws_echo(ws: WebSocket):

    await ws.accept()

    await ws.send_json({"type": "welcome", "msg": "WS connected. Send {'type':'in','data':'hello'}"})
    try:
        while True:
            raw = await ws.receive_json()
            if raw.get("type") == "in":

                await ws.send_json({"type": "out", "data": f"echo: {raw.get('data','')}"})
            else:
                await ws.send_json({"type": "err", "data": f"unknown message: {raw}"})
    except WebSocketDisconnect:

        pass





USE_DOCKER = os.getenv("OC_USE_DOCKER", "1") not in ("0", "false", "False", "no", "No")



DOCKER_IMAGES = {
    "python": "omni-runner:python",
    "cpp": "omni-runner:cpp",
    "javascript": "omni-runner:node",
    "go": "omni-runner:go",
    "java": "omni-runner:java",
}

def _should_use_docker():

    return USE_DOCKER and shutil.which("docker") is not None

def _write_files(files, workdir):
    for f in files:
        path = os.path.join(workdir, f["name"])
        with open(path, "w", encoding="utf-8") as fp:
            fp.write(f["content"])

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


        mount = f"{workdir}:/work:{'ro' if lang == 'python' else 'rw'}"

        if lang == "python":



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

        raise ValueError("Docker is required for execution but was not detected on PATH (OC_USE_DOCKER=1).")


    try:

        try:
            pol = type(asyncio.get_event_loop_policy()).__name__
            loop = asyncio.get_running_loop()
            loop_cls = type(loop).__name__
            print(f"[exec] asyncio policy={pol} loop={loop_cls} os={os.name}")
        except Exception:
            pass

        cmd, container = name_container(cmd)
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workdir,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        setattr(proc, "_oc_container", container)
        return proc, cmd_desc, using, "async"
    except NotImplementedError:

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
        # Signalling the docker client does not stop the container it started,
        # so remove it explicitly; otherwise it outlives the session.
        await remove_container(getattr(proc, "_oc_container", None))
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
                elif event == "await_input":
                    try:
                        await ws.send_json({"type": "awaiting_input", "value": True, "prompt": body.get("prompt", "")})
                    except Exception:
                        pass
                elif event == "output":
                    try:
                        stream = body.get("stream", "stdout")
                        data = body.get("data", "")
                        await ws.send_json({"type": "out" if stream == "stdout" else "err", "data": data})
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
        # Signalling the docker client does not stop the container it started,
        # so remove it explicitly; otherwise it outlives the session.
        await remove_container(getattr(proc, "_oc_container", None))
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
        # Signalling the docker client does not stop the container it started,
        # so remove it explicitly; otherwise it outlives the session.
        await remove_container(getattr(proc, "_oc_container", None))
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
        # Signalling the docker client does not stop the container it started,
        # so remove it explicitly; otherwise it outlives the session.
        await remove_container(getattr(proc, "_oc_container", None))
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

DLV_PROMPT = "(dlv) "

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")

# dlv announces a pause as, e.g.
#   > [Breakpoint 1] main.main() ./main.go:13 (hits goroutine(1):1 total:1)
#   > main.helper() ./main.go:6 (PC: 0x49b2a0)
_DLV_STOP_RE = re.compile(
    r"^>\s*(?:\[[^\]]*\]\s*)?(?P<func>[^\s(]+)\([^)]*\)\s+"
    r"(?P<file>[^\s:]+):(?P<line>\d+)"
)

# `stack` reports each frame over two lines:
#   0  0x000000000049b350 in main.main
#      at ./main.go:13
_DLV_FRAME_RE = re.compile(r"^\s*(?P<idx>\d+)\s+0x[0-9a-fA-F]+\s+in\s+(?P<func>\S+)")
_DLV_FRAME_AT_RE = re.compile(r"^\s*at\s+(?P<file>\S+):(?P<line>\d+)")

# Source context echoed after a pause, e.g. "=>  13:	total += helper(i)"
_DLV_SRC_RE = re.compile(r"^\s*=?>?\s*\d+:\s")

_DLV_EXIT_RE = re.compile(r"Process\s+\d+\s+has exited with status")

_DLV_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")

# dlv's own acknowledgements, which are not program output.
_DLV_NOISE_PREFIXES = ("Type 'help'", "Breakpoint ", "Command failed:")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _parse_dlv_stack(block_lines: list) -> list:
    """Pair dlv's two-line frame records into the shared frame representation."""
    frames = []
    pending = None
    for raw in block_lines:
        m = _DLV_FRAME_RE.match(raw)
        if m:
            pending = {"function": m.group("func"), "func": m.group("func")}
            continue
        m_at = _DLV_FRAME_AT_RE.match(raw)
        if m_at and pending is not None:
            pending["file"] = m_at.group("file")
            try:
                pending["line"] = int(m_at.group("line"))
            except Exception:
                pending["line"] = None
            frames.append(pending)
            pending = None
    return frames


def _parse_dlv_locals(block_lines: list) -> dict:
    values = {}
    for raw in block_lines:
        stripped = raw.strip()
        if not stripped or "=" not in stripped:
            continue
        name, val = stripped.split("=", 1)
        name = name.strip()
        if not _DLV_IDENT_RE.match(name):
            continue
        values[name] = val.strip()
    return values


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

    async def send_query(cmd: str, timeout: float = 5.0) -> list:
        """Run a dlv command and return the lines it printed before the prompt.

        dlv ends every response with "(dlv) " and no newline, so the reader
        below splits the console on that token rather than on newlines and a
        response arrives as one block.
        """
        nonlocal command_future
        if command_future is not None:
            raise RuntimeError("command already in flight")
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        command_future = fut
        await send_cmd(cmd)
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except Exception:
            if not fut.done():
                fut.cancel()
            return []
        finally:
            if command_future is fut:
                command_future = None

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

    async def handle_paused(file=None, line=None, func=None):
        stack = []
        locals_map = {}

        try:
            stack.extend(_parse_dlv_stack(await send_query("stack")))
        except Exception:
            pass
        try:
            locals_map.update(_parse_dlv_locals(await send_query("locals")))
        except Exception:
            pass

        if stack:
            file = file or stack[0].get("file")
            line = line or stack[0].get("line")
            func = func or stack[0].get("function")

        payload = {
            "file": file,
            "line": line,
            "function": func,
            "stack": stack,
            "locals": locals_map,
        }
        try:
            await ws.send_json({"type": "debug_event", "event": "paused", "payload": payload})
        except Exception:
            pass
        paused.set()

    async def handle_block(block: str):
        """Interpret one prompt-delimited chunk of dlv console output."""
        nonlocal command_future
        block_lines = [ln.rstrip("\r") for ln in block.split("\n")]

        if command_future is not None:
            if not command_future.done():
                command_future.set_result(block_lines)
            command_future = None
            return

        stop_match = None
        for ln in block_lines:
            m = _DLV_STOP_RE.match(ln.strip())
            if m:
                stop_match = m
                break

        if stop_match is not None:
            try:
                line_no = int(stop_match.group("line"))
            except Exception:
                line_no = None
            # Collecting the state issues further dlv commands whose replies
            # this same reader must deliver, so it cannot be awaited here.
            asyncio.create_task(handle_paused(stop_match.group("file"), line_no,
                                              stop_match.group("func")))
            return

        if any(_DLV_EXIT_RE.search(ln) for ln in block_lines):
            try:
                await ws.send_json({"type": "status", "data": "exited"})
            except Exception:
                pass
            exit_event.set()
            return

        # What remains is the debugged program's own output. The source context
        # dlv echoes after a pause, and its own acknowledgements, are dropped so
        # they are not shown to the user as program output.
        kept = [ln for ln in block_lines
                if ln.strip()
                and not _DLV_SRC_RE.match(ln)
                and not ln.strip().startswith(_DLV_NOISE_PREFIXES)]
        if kept:
            try:
                await ws.send_json({"type": "out", "data": "\n".join(kept) + "\n"})
            except Exception:
                pass

    async def pump_stdout():
        """Split dlv's console on its prompt rather than on newlines.

        The prompt carries no trailing newline, so readline() blocks on it and
        no response is ever completed.
        """
        buf = ""
        try:
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    exit_event.set()
                    break
                buf += _strip_ansi(chunk.decode(errors="ignore"))
                while DLV_PROMPT in buf:
                    block, buf = buf.split(DLV_PROMPT, 1)
                    if block.strip():
                        await handle_block(block)
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
        # Signalling the docker client does not stop the container it started,
        # so remove it explicitly; otherwise it outlives the session.
        await remove_container(getattr(proc, "_oc_container", None))
        rc = -1
        try:
            rc = await proc.wait()
        except Exception:
            pass
        for t in (out_task, err_task):
            t.cancel()
        try:
            from starlette.websockets import WebSocketState
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


                if command_future is not None:

                    if text.strip().endswith(">"):
                        if not command_future.done():
                            command_future.set_result(command_buffer)
                        command_future = None
                        command_buffer = []
                        continue
                    command_buffer.append(text)
                    continue


                if text.startswith("Local variables:") or text.startswith("Method arguments:"):
                    continue
                if re.match(r'^\s*(args|h|x)\s*=', text):
                    continue


                if "Breakpoint hit:" in text or "Step completed:" in text:
                    m = re.search(r'\(([^:]+\.java):(\d+)\)', text)
                    file = m.group(1) if m else None
                    try:
                        line = int(m.group(2)) if m else None
                    except Exception:
                        line = None
                    await handle_paused(file, line, "breakpoint")
                    continue


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


                if text.strip().endswith(">"):
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
        # Signalling the docker client does not stop the container it started,
        # so remove it explicitly; otherwise it outlives the session.
        await remove_container(getattr(proc, "_oc_container", None))
        rc = -1
        try:
            rc = await proc.wait()
        except Exception:
            pass
        for t in (out_task, err_task):
            t.cancel()
        try:
            from starlette.websockets import WebSocketState
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
                    try:
                        stream = body.get("stream", "stdout")
                        data = body.get("data", "")
                        await ws.send_json({"type": "out" if stream == "stdout" else "err", "data": data})
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
        # Signalling the docker client does not stop the container it started,
        # so remove it explicitly; otherwise it outlives the session.
        await remove_container(getattr(proc, "_oc_container", None))
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


    try:
        await ws.send_json({"type": "status", "phase": "starting", "lang": lang, "entry": entry})
    except Exception:
        pass


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


    try:

        if cmd_desc:
            try:
                print(f"[status:exec] using={using} mode={mode} cmd={cmd_desc}")
            except Exception:
                pass
        await ws.send_json({"type": "status", "phase": "exec", "using": using, "mode": mode, "cmd": cmd_desc})
    except Exception:
        pass

    await ws.send_json({"type":"status","phase":"running"})



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


                if kind != "out":
                    if text:
                        await ws.send_json({"type": kind, "data": text})
                    continue

                s = SENTINEL
                i = 0
                while True:
                    j = text.find(s, i)
                    if j == -1:


                        tail_len = 0
                        max_tail = min(len(s) - 1, len(text) - i)
                        for k in range(max_tail, 0, -1):
                            if text.endswith(s[:k]):
                                tail_len = k
                                break
                        emit_part = text[i: len(text) - tail_len] if tail_len > 0 else text[i:]
                        if emit_part:
                            await ws.send_json({"type": kind, "data": emit_part})

                            if kind == "out" and not emit_part.endswith("\n"):
                                await ws.send_json({"type": "awaiting_input", "value": True})
                        carry = text[-tail_len:] if tail_len > 0 else ""
                        break


                    if j > i:
                        part = text[i:j]
                        await ws.send_json({"type": kind, "data": part})

                        if part and not part.endswith("\n"):
                            await ws.send_json({"type": "awaiting_input", "value": True})

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

        proc_wait = asyncio.create_task(proc.wait())

        while True:
            recv_task = asyncio.create_task(ws.receive_text())
            done, pending = await asyncio.wait({recv_task, proc_wait}, return_when=asyncio.FIRST_COMPLETED)

            if proc_wait in done:

                for t in pending:
                    t.cancel()
                break


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

                    try:
                        await ws.send_json({"type": "awaiting_input", "value": False})
                    except Exception:
                        pass
                except Exception:

                    pass
            elif msg.get("type") in ("close", "stop"):

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
        # The killed process was the docker client; remove the container too.
        await remove_container(getattr(proc, "_oc_container", None))
        for t in (t_out, t_err, t_wd):
            t.cancel()
        try:
            await ws.send_json({"type":"exit","code": rc})
        except Exception:
            pass
        await ws.close()
        shutil.rmtree(workdir, ignore_errors=True)
