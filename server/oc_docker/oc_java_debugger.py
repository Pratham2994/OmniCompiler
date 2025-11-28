#!/usr/bin/env python3
"""
Lightweight Java debugger shim using jdb + JDWP attach.
- Starts the target JVM suspended with JDWP and a dedicated PTY for stdin/stdout.
- Attaches jdb to the JDWP socket and drives it via stdin/stdout.
- Accepts JSON commands on stdin (continue/step/breakpoints/evaluate/stdin/stop).
- Emits JSON events on stdout (paused/exception/evaluate_result/breakpoints_set/await_input/output/terminated).
"""

import asyncio
import json
import os
import pty
import re
import shlex
import sys
import threading
import socket


CMD_QUEUE: "queue.Queue[dict]" = None                
try:
    import queue
    CMD_QUEUE = queue.Queue()
except Exception:
    pass


def send(obj: dict):
    try:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def read_commands():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            CMD_QUEUE.put(obj)
        except Exception:
            continue


def parse_class_name(entry_path: str) -> str:
    base = os.path.basename(entry_path)
    return os.path.splitext(base)[0]


def parse_break_hit(line: str):
                                                                   
    m = re.search(r'line=(\d+)', line)
    line_no = int(m.group(1)) if m else None
    return line_no


async def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: oc_java_debugger.py <EntryClass> [args...]\n")
        sys.exit(1)

    entry_class = sys.argv[1]
    user_args = sys.argv[2:]

    loop = asyncio.get_running_loop()

    threading.Thread(target=read_commands, daemon=True).start()

                        
    master_fd, slave_fd = pty.openpty()
    slave_name = os.ttyname(slave_fd)

    exit_event = asyncio.Event()

                                                                   
    def _pick_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    jdwp_port = str(_pick_port())
                              
    jdb_cmd = [
        "jdb",
        "-sourcepath",
        "/work",
        "-listen",
        jdwp_port,
    ]

    jdb_proc = await asyncio.create_subprocess_exec(
        *jdb_cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd="/work",
    )

                                            
    try:
        rc = await asyncio.wait_for(jdb_proc.wait(), timeout=1.0)
    except asyncio.TimeoutError:
        rc = None
    if rc is not None:
        out, err_out = b"", b""
        try:
            out, err_out = await jdb_proc.communicate()
        except Exception:
            pass
        msg = (err_out or out or b"").decode(errors="ignore").strip() or f"jdb exited rc={rc}"
        send({"event": "exception", "body": {"message": msg}})
        await asyncio.sleep(5)
        exit_event.set()
        return

                                                        
    java_cmd = [
        "java",
        f"-agentlib:jdwp=transport=dt_socket,server=n,address=127.0.0.1:{jdwp_port},suspend=y",
        "-classpath",
        "/work",
        entry_class,
        *user_args,
    ]

    target_proc = await asyncio.create_subprocess_exec(
        *java_cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd="/work",
    )

    bp_set = set()
    response_future: asyncio.Future | None = None
    cmd_lock = asyncio.Lock()

    async def jdb_cmd_send(cmd: str, expect_resp: bool = False, timeout: float = 3.0):
        nonlocal response_future
        if jdb_proc.stdin is None or jdb_proc.stdin.is_closing():
            raise RuntimeError("jdb stdin closed")
        fut = None
        async with cmd_lock:
            if expect_resp:
                fut = loop.create_future()
                response_future = fut
            jdb_proc.stdin.write((cmd + "\n").encode())
            await jdb_proc.stdin.drain()
        if not fut:
            return None
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            if response_future is fut:
                response_future = None

    async def apply_breakpoints(bps: list[dict]):
                        
        for bp in list(bp_set):
            cls, ln = bp
            await jdb_cmd_send(f"clear {cls}:{ln}")
            bp_set.discard(bp)
        for bp in bps or []:
            file = bp.get("file") or ""
            line = bp.get("line")
            if not file or not line:
                continue
            cls = os.path.splitext(os.path.basename(file))[0]
            await jdb_cmd_send(f"stop at {cls}:{int(line)}")
            bp_set.add((cls, int(line)))
        send({"event": "breakpoints_set", "body": {"ok": True}})

    async def collect_state():
        stack = []
        locals_map = {}
        try:
            await jdb_cmd_send("where")
        except Exception:
            pass
                                                                                  
        return stack, locals_map

    async def handle_break_hit(line_text: str):
                                               
        try:
            await jdb_cmd_send("where")
        except Exception:
            pass
        try:
            await jdb_cmd_send("locals")
        except Exception:
            pass

    async def pump_jdb_stdout():
        nonlocal response_future
        buffer_lines = []
        try:
            while True:
                raw = await jdb_proc.stdout.readline()
                if not raw:
                    exit_event.set()
                    break
                text = raw.decode(errors="ignore").rstrip("\n")
                if not text:
                    continue
                stripped = text.strip()

                if response_future:
                    if stripped.endswith(">") or stripped.endswith("(main)"):
                        if not response_future.done():
                            response_future.set_result("\n".join(buffer_lines))
                        buffer_lines.clear()
                        response_future = None
                        continue
                    buffer_lines.append(text)
                    continue

                if "Breakpoint hit" in text or "stopped in" in text:
                    line_no = parse_break_hit(text)
                    send(
                        {
                            "event": "stopped",
                            "body": {
                                "file": None,
                                "line": line_no,
                                "stack": [],
                                "locals": {},
                                "function": None,
                            },
                        }
                    )
                    continue

                if "The application exited" in text or "VM disconnected" in text:
                    send({"event": "terminated", "body": {}})
                    exit_event.set()
                    break
                else:
                    send({"event": "output", "body": {"text": text + "\n", "stream": "stdout"}})
        except Exception:
            exit_event.set()

    async def pump_jdb_stderr():
        try:
            while True:
                raw = await jdb_proc.stderr.readline()
                if not raw:
                    break
                txt = raw.decode(errors="ignore")
                if txt:
                    send({"event": "output", "body": {"text": txt, "stream": "stderr"}})
        except Exception:
            pass

    async def pump_target_io():
        try:
            while True:
                chunk = await loop.run_in_executor(None, os.read, master_fd, 1024)
                if not chunk:
                    break
                text = chunk.decode(errors="ignore")
                if text:
                    send({"event": "output", "body": {"text": text, "stream": "stdout"}})
                    if not text.endswith("\n"):
                        send({"event": "await_input", "body": {"prompt": ""}})
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
                try:
                    await jdb_cmd_send("cont")
                except Exception:
                    pass
            elif t == "step_over":
                try:
                    await jdb_cmd_send("next")
                except Exception:
                    pass
            elif t == "step_in":
                try:
                    await jdb_cmd_send("step")
                except Exception:
                    pass
            elif t == "step_out":
                try:
                    await jdb_cmd_send("step up")
                except Exception:
                    pass
            elif t == "set_breakpoints":
                await apply_breakpoints(cmd.get("breakpoints") or [])
            elif t == "evaluate":
                expr = cmd.get("expr", "")
                resp = await jdb_cmd_send(f"print {expr}", expect_resp=True)
                send({"event": "evaluate_result", "body": {"expr": expr, "value": resp or ""}})
            elif t == "stdin":
                data = cmd.get("data", "")
                try:
                    os.write(master_fd, data.encode())
                except Exception:
                    pass
            elif t == "stop":
                try:
                    await jdb_cmd_send("quit")
                except Exception:
                    pass
                exit_event.set()
                return

                                  
    init_bps_env = os.environ.get("OC_INIT_BPS", "")
    init_bps = []
    if init_bps_env:
        try:
            init_bps = json.loads(init_bps_env)
        except Exception:
            init_bps = []

    tasks = [
        asyncio.create_task(pump_jdb_stdout()),
        asyncio.create_task(pump_jdb_stderr()),
        asyncio.create_task(pump_target_io()),
        asyncio.create_task(pump_commands()),
    ]

                                    
    if init_bps:
        try:
            await apply_breakpoints(init_bps)
        except Exception:
            pass

    try:
        await jdb_cmd_send(f"stop in {entry_class}.main")
    except Exception:
        pass
    try:
        await jdb_cmd_send("cont")
    except Exception as e:
        send({"event": "exception", "body": {"message": f"failed to continue: {e}"}})

    await exit_event.wait()

    for t in tasks:
        t.cancel()
    try:
        if jdb_proc.returncode is None:
            jdb_proc.terminate()
    except Exception:
        pass
    try:
        if target_proc.returncode is None:
            target_proc.terminate()
    except Exception:
        pass
    try:
        os.close(master_fd)
        os.close(slave_fd)
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(main())
