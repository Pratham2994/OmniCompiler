#!/usr/bin/env python3
"""
Lightweight C++ debugger shim for Omni.

Responsibilities:
- Spawn gdb/MI with a dedicated PTY for the inferior, so program I/O is cleanly separated.
- Accept JSON commands on stdin (continue/step/breakpoints/evaluate/stdin/stop).
- Emit JSON events on stdout (stopped/exception/evaluate_result/terminated/breakpoints_set/await_input)
  and stream program output/stderr as events too.
"""

import asyncio
import json
import os
import pty
import queue
import re
import shlex
import sys
import threading


CMD_QUEUE: "queue.Queue[dict]" = queue.Queue()


def _read_commands():
    """Background thread: read JSON lines from stdin and enqueue them."""
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        CMD_QUEUE.put(obj)


def _emit(event: str, body: dict):
    sys.stdout.write(json.dumps({"event": event, "body": body}) + "\n")
    sys.stdout.flush()


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


async def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: oc_cpp_debugger.py <binary> [-- args...]\n")
        sys.exit(1)

    # Parse args: everything after the binary path (and optional --) goes to the inferior.
    binary = sys.argv[1]
    try:
        sep_index = sys.argv.index("--")
        prog_args = sys.argv[sep_index + 1 :]
    except ValueError:
        prog_args = sys.argv[2:]

    loop = asyncio.get_running_loop()

    # Start command reader thread.
    threading.Thread(target=_read_commands, daemon=True).start()

    # PTY for the inferior
    master_fd, slave_fd = pty.openpty()
    slave_name = os.ttyname(slave_fd)

    # Launch gdb in MI mode, pointing the inferior at the PTY.
    gdb_cmd = [
        "gdb",
        "--interpreter=mi2",
        "--quiet",
        "--nx",
        "-iex",
        "set pagination off",
        "-iex",
        "set confirm off",
        "-iex",
        f"set inferior-tty {slave_name}",
        "--args",
        binary,
        *prog_args,
    ]

    proc = await asyncio.create_subprocess_exec(
        *gdb_cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    pending: asyncio.Future | None = None
    cmd_lock = asyncio.Lock()
    exit_event = asyncio.Event()
    bp_ids: dict[tuple[str, int], str] = {}

    async def send_cmd(cmd: str, expect_response: bool = True):
        nonlocal pending
        if proc.stdin is None or proc.stdin.is_closing():
            raise RuntimeError("gdb stdin closed")
        fut = None
        async with cmd_lock:
            if expect_response:
                fut = loop.create_future()
                pending = fut
            proc.stdin.write((cmd + "\n").encode())
            await proc.stdin.drain()
        if not expect_response or fut is None:
            return None
        try:
            return await asyncio.wait_for(fut, timeout=5.0)
        finally:
            if pending is fut:
                pending = None

    async def apply_breakpoints(breakpoints: list[dict]):
        # Clear existing
        if bp_ids:
            ids = list(set(bp_ids.values()))
            bp_ids.clear()
            await send_cmd(f"-break-delete {' '.join(ids)}", expect_response=False)
        for bp in breakpoints or []:
            file = bp.get("file")
            line = bp.get("line")
            if not file or not line:
                continue
            resp = await send_cmd(f"-break-insert {file}:{int(line)}")
            m = re.search(r'number="([^"]+)"', resp or "")
            if m:
                bp_ids[(file, int(line))] = m.group(1)
        _emit("breakpoints_set", {"ok": True})

    async def handle_stop(stop_line: str):
        if "exited" in stop_line:
            _emit("terminated", {"reason": "exited"})
            exit_event.set()
            return

        top_frame = _parse_frame_from_stop(stop_line)

        stack_resp = ""
        locals_resp = ""
        try:
            stack_resp = await send_cmd("-stack-list-frames")
        except Exception:
            stack_resp = ""
        try:
            locals_resp = await send_cmd("-stack-list-variables --all-values")
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
        _emit("stopped", payload)

    async def pump_gdb_stdout():
        nonlocal pending
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    if pending and not pending.done():
                        pending.set_exception(RuntimeError("gdb stdout closed"))
                    exit_event.set()
                    break
                line = raw.decode(errors="ignore").strip()
                if not line or line == "(gdb)":
                    continue

                if line.startswith(("^done", "^running", "^error")):
                    if pending and not pending.done():
                        pending.set_result(line)
                    continue

                if line.startswith(("~", "@")):
                    txt = _mi_unquote(line[1:])
                    _emit("output", {"stream": "stdout", "data": txt})
                    continue

                if line.startswith("&"):
                    txt = _mi_unquote(line[1:])
                    _emit("output", {"stream": "stderr", "data": txt})
                    continue

                if line.startswith("*stopped"):
                    asyncio.create_task(handle_stop(line))
                    continue

                if line.startswith("*running"):
                    continue

                if "exited-normally" in line or "exited" in line:
                    _emit("terminated", {"reason": "exited"})
                    exit_event.set()
                    break
        except Exception:
            exit_event.set()

    async def pump_gdb_stderr():
        try:
            while True:
                raw = await proc.stderr.readline()
                if not raw:
                    break
                txt = raw.decode(errors="ignore")
                if txt:
                    _emit("output", {"stream": "stderr", "data": txt})
        except Exception:
            pass

    async def pump_inferior_output():
        """Read program stdout/stderr from the PTY master and forward to host."""
        try:
            while True:
                chunk = await loop.run_in_executor(None, os.read, master_fd, 1024)
                if not chunk:
                    break
                text = chunk.decode(errors="ignore")
                if text:
                    _emit("output", {"stream": "stdout", "data": text})
                    if not text.endswith("\n"):
                        _emit("await_input", {"prompt": ""})
        except Exception:
            pass

    async def pump_commands():
        while True:
            if exit_event.is_set():
                return
            try:
                cmd = await loop.run_in_executor(None, CMD_QUEUE.get)
            except Exception:
                continue
            t = cmd.get("type")
            if t == "continue":
                await send_cmd("-exec-continue")
            elif t == "step_over":
                await send_cmd("-exec-next")
            elif t == "step_in":
                await send_cmd("-exec-step")
            elif t == "step_out":
                await send_cmd("-exec-finish")
            elif t == "set_breakpoints":
                await apply_breakpoints(cmd.get("breakpoints") or [])
            elif t == "evaluate":
                expr = cmd.get("expr", "")
                mi_expr = json.dumps(expr)
                resp = await send_cmd(f"-data-evaluate-expression {mi_expr}")
                if resp and resp.startswith("^done"):
                    m = re.search(r'value="([^"]*)"', resp)
                    val = _mi_unquote(f'"{m.group(1)}"') if m else ""
                    _emit("evaluate_result", {"expr": expr, "value": val})
                else:
                    msg = resp or "evaluate failed"
                    _emit("evaluate_result", {"expr": expr, "error": msg})
            elif t == "stdin":
                data = cmd.get("data", "")
                try:
                    os.write(master_fd, data.encode())
                except Exception:
                    pass
            elif t == "stop":
                await send_cmd("-gdb-exit", expect_response=False)
                exit_event.set()
                return

    # Apply initial breakpoints from env (optional).
    init_bps = os.environ.get("OC_INIT_BPS", "")
    init_bps_path = os.environ.get("OC_INIT_BPS_PATH")
    init_list: list[dict] = []
    if init_bps_path and os.path.exists(init_bps_path):
        try:
            with open(init_bps_path, "r", encoding="utf-8") as f:
                init_list = json.loads(f.read())
        except Exception:
            init_list = []
    elif init_bps:
        try:
            init_list = json.loads(init_bps)
        except Exception:
            init_list = []

    # Start pumps
    tasks = [
        asyncio.create_task(pump_gdb_stdout()),
        asyncio.create_task(pump_gdb_stderr()),
        asyncio.create_task(pump_inferior_output()),
        asyncio.create_task(pump_commands()),
    ]

    # Sync initial breakpoints then run.
    if init_list:
        try:
            await apply_breakpoints(init_list)
        except Exception:
            pass

    try:
        await send_cmd("-exec-run")
    except Exception as e:
        _emit("output", {"stream": "stderr", "data": f"failed to start target: {e}"})
        exit_event.set()

    await exit_event.wait()

    for t in tasks:
        t.cancel()
    try:
        await proc.wait()
    except Exception:
        pass
    try:
        os.close(master_fd)
    except Exception:
        pass
    try:
        os.close(slave_fd)
    except Exception:
        pass
    _emit("terminated", {"reason": "shutdown"})


if __name__ == "__main__":
    asyncio.run(main())
