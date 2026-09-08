#!/usr/bin/env python3
"""
Lightweight Java debugger shim using jdb + JDWP attach.
- Starts the target JVM suspended with JDWP and a dedicated PTY for stdin/stdout.
- Attaches jdb to the JDWP socket and drives it via stdin/stdout.
- Accepts JSON commands on stdin (continue/step/breakpoints/evaluate/stdin/stop).
- Emits JSON events on stdout (paused/exception/evaluate_result/breakpoints_set/await_input/output/terminated).

jdb writes its prompt ("main[1] ") without a trailing newline, so the console
cannot be consumed with readline(): the prompt would never complete and every
command that expects a reply would block. The reader below works on byte
chunks instead and treats a prompt at the tail of the buffer as the end of a
response, which is what makes request/response against jdb possible at all.
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


# jdb prompts with "> " before the VM starts and "<thread>[<depth>] " once it
# is suspended in a frame. Either marks the end of a command's output.
PROMPT_RE = re.compile(r"(?:^|\n)[ \t]*(?:>|[\w.$-]+\[\d+\])[ \t]*$")

# Breakpoint hit: "thread=main", Hello.main(), line=10 bci=0
STOP_RE = re.compile(
    r'(?P<kind>Breakpoint hit|Step completed|Stopped due to|Exception occurred)'
    r'[^"\n]*"thread=(?P<thread>[^"]*)",\s*'
    r'(?P<cls>[\w.$]+)\.(?P<meth>[\w$<>]+)\s*\([^)]*\),\s*line=(?P<line>\d+)'
)

#   [1] Hello.helper (Hello.java:5)
FRAME_RE = re.compile(
    r'\[(?P<idx>\d+)\]\s+(?P<cls>[\w.$]+)\.(?P<meth>[\w$<>]+)\s*'
    r'\((?P<file>[^():]+):(?P<line>\d+)\)'
)

# "x = 5" / "args = instance of java.lang.String[0] (id=123)"
LOCAL_RE = re.compile(r'^\s*(?P<name>[\w$]+)\s*=\s*(?P<value>.+?)\s*$')

SKIP_LOCAL_NAMES = {"Method", "Local"}


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


def parse_stack_frames(text: str) -> list:
    """Turn the output of jdb's `where` into the shared frame representation."""
    frames = []
    for line in (text or "").splitlines():
        m = FRAME_RE.search(line)
        if not m:
            continue
        frames.append({
            "file": "/work/%s" % m.group("file"),
            "line": int(m.group("line")),
            "function": "%s.%s" % (m.group("cls"), m.group("meth")),
            "func": "%s.%s" % (m.group("cls"), m.group("meth")),
        })
    return frames


def parse_locals(text: str) -> dict:
    """Turn the output of jdb's `locals` into a name -> value mapping.

    jdb groups the output under "Method arguments:" and "Local variables:"
    headings, and reports an error line instead when the class was compiled
    without debug information. Both are skipped rather than parsed as bindings.
    """
    values = {}
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.endswith(":"):
            continue
        if "not available" in stripped or stripped.startswith("Try compiling"):
            continue
        m = LOCAL_RE.match(stripped)
        if not m:
            continue
        name = m.group("name")
        if name in SKIP_LOCAL_NAMES:
            continue
        values[name] = m.group("value")
    return values


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
    cmd_lock = asyncio.Lock()
    response_future: asyncio.Future | None = None
    collected: list = []
    # Console text that arrived while no command was outstanding, handed to the
    # idle handler so that stop notices can be acted on without blocking the
    # reader that must keep draining jdb while state is collected.
    idle_queue: asyncio.Queue = asyncio.Queue()

    def flush_collected():
        nonlocal response_future, collected
        text = "\n".join(collected)
        collected = []
        if response_future is not None and not response_future.done():
            response_future.set_result(text)
            response_future = None
        elif text.strip():
            idle_queue.put_nowait(text)

    async def jdb_cmd_send(cmd: str, expect_resp: bool = False, timeout: float = 8.0):
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
            except asyncio.TimeoutError:
                return None
            finally:
                if response_future is fut:
                    response_future = None

    async def apply_breakpoints(bps: list):
        for bp in list(bp_set):
            cls, ln = bp
            await jdb_cmd_send(f"clear {cls}:{ln}", expect_resp=True, timeout=4.0)
            bp_set.discard(bp)
        for bp in bps or []:
            file = bp.get("file") or ""
            line = bp.get("line")
            if not file or not line:
                continue
            cls = os.path.splitext(os.path.basename(file))[0]
            await jdb_cmd_send(f"stop at {cls}:{int(line)}", expect_resp=True, timeout=4.0)
            bp_set.add((cls, int(line)))
        send({"event": "breakpoints_set", "body": {"ok": True}})

    async def emit_stop(match):
        """Fill the shared state object for a pause and emit it.

        The pause notice alone carries only class, method and line. The file,
        call stack and local bindings each require a further jdb query, so the
        event is emitted after those have been collected rather than with the
        empty fields the notice can supply on its own.
        """
        cls = match.group("cls")
        meth = match.group("meth")
        line_no = int(match.group("line"))

        where_out = await jdb_cmd_send("where", expect_resp=True, timeout=6.0)
        locals_out = await jdb_cmd_send("locals", expect_resp=True, timeout=6.0)

        stack = parse_stack_frames(where_out or "")
        values = parse_locals(locals_out or "")

        # The top frame names the source file; fall back to the class name,
        # which matches the file for the single-class programs this runs on.
        top_file = stack[0]["file"] if stack else "/work/%s.java" % cls.split(".")[-1]
        if stack:
            line_no = stack[0]["line"]

        body = {
            "file": top_file,
            "line": line_no,
            "stack": stack,
            "locals": values,
            "function": "%s.%s" % (cls, meth),
        }
        if match.group("kind") == "Exception occurred":
            send({"event": "exception", "body": dict(body, message=match.group(0))})
        send({"event": "stopped", "body": body})

    async def handle_idle_text():
        while True:
            text = await idle_queue.get()
            if "The application exited" in text or "VM disconnected" in text:
                send({"event": "terminated", "body": {}})
                exit_event.set()
                return
            m = STOP_RE.search(text)
            if m:
                try:
                    await emit_stop(m)
                except Exception as e:
                    send({"event": "stopped", "body": {
                        "file": None, "line": int(m.group("line")),
                        "stack": [], "locals": {},
                        "function": "%s.%s" % (m.group("cls"), m.group("meth")),
                    }})

    async def pump_jdb_stdout():
        """Read jdb's console in chunks and split responses on its prompt.

        A prompt is only meaningful at the tail of what has been read so far;
        the same text in the middle of a buffer is ordinary output.
        """
        buf = ""
        try:
            while True:
                chunk = await jdb_proc.stdout.read(4096)
                if not chunk:
                    exit_event.set()
                    flush_collected()
                    break
                buf += chunk.decode(errors="ignore")
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    collected.append(line.rstrip("\r"))
                if buf and PROMPT_RE.search("\n" + buf):
                    buf = ""
                    flush_collected()
        except Exception:
            exit_event.set()

    async def pump_jdb_stderr():
        try:
            while True:
                raw = await jdb_proc.stderr.readline()
                if not raw:
                    break
                txt = raw.decode(errors="ignore")
                if txt.strip():
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
                resp = await jdb_cmd_send(f"print {expr}", expect_resp=True, timeout=6.0)
                value = ""
                for line in (resp or "").splitlines():
                    if "=" in line:
                        value = line.split("=", 1)[1].strip()
                        break
                send({"event": "evaluate_result",
                      "body": {"expr": expr, "value": value or (resp or "").strip()}})
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
        asyncio.create_task(handle_idle_text()),
    ]

    # jdb only accepts commands once it has printed its first prompt; issuing
    # them before the VM has connected leaves them unacknowledged.
    await asyncio.sleep(0.6)

    try:
        await jdb_cmd_send(f"stop in {entry_class}.main", expect_resp=True, timeout=6.0)
    except Exception:
        pass

    if init_bps:
        try:
            await apply_breakpoints(init_bps)
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
