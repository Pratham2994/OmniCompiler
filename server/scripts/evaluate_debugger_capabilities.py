"""Capability evaluation of the five debugger integrations.

The framework's central claim is that five native debuggers, each with its own
protocol and state representation, are presented through one interface. The
other experiments measure components around that claim rather than the claim
itself. This script tests it directly.

For each supported language the script drives a real debugging session over
the WebSocket data plane, exactly as the browser client does: it creates a
session through the REST endpoint, connects to the session socket, and issues
the same commands the user interface issues. It then records which of the
following the session actually delivers.

  breakpoint        a breakpoint request is acknowledged and execution pauses
  pause_location    the pause reports the file and line that was requested
  continue          execution resumes and reaches the breakpoint again
  step_over         a step advances within the current frame
  step_in           a step enters the callee
  step_out          a step returns to the caller
  local_variables   the paused state carries local variable bindings
  call_stack        the paused state carries a call stack
  evaluate          an expression is evaluated in the paused frame
  stdin             a blocked read is surfaced and a reply is accepted
  exception         a runtime fault is reported as a debugger event
  program_output    program output is streamed to the client

A capability counts as supported only if the observable evidence for it
appears in the event stream. Absence is recorded as absence rather than
inferred from the code.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import pandas as pd
import websockets

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

sys.path.insert(0, str(ROOT / "data" / "debug_bench"))
import programs  # noqa: E402

RESULT_DIR = ROOT / "data" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

LANGUAGES = ["python", "javascript", "java", "cpp", "go"]

CAPABILITIES = [
    "breakpoint", "pause_location", "continue", "step_over", "step_in",
    "step_out", "local_variables", "call_stack", "evaluate", "stdin",
    "exception", "program_output",
]

EVENT_TIMEOUT = 45.0
SESSION_TIMEOUT = 200.0


class Session:
    """One debugging session driven over the WebSocket data plane."""

    def __init__(self, ws):
        self.ws = ws
        self.events: List[Dict[str, Any]] = []

    async def send(self, payload: Dict[str, Any]) -> None:
        await self.ws.send(json.dumps(payload))

    async def collect(self, until, timeout: float = EVENT_TIMEOUT) -> Optional[Dict[str, Any]]:
        """Read events until one satisfies `until`, or the timeout elapses."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=remaining)
            except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
                return None
            try:
                event = json.loads(raw)
            except Exception:
                continue
            self.events.append(event)
            if until(event):
                return event
        return None

    def paused_events(self) -> List[Dict[str, Any]]:
        return [e for e in self.events
                if e.get("type") == "debug_event" and e.get("event") == "paused"]

    def has_event(self, name: str) -> bool:
        return any(e.get("type") == "debug_event" and e.get("event") == name
                   for e in self.events)

    def output_text(self) -> str:
        return "".join(str(e.get("data", "")) for e in self.events
                       if e.get("type") == "out")


def is_paused(event: Dict[str, Any]) -> bool:
    return event.get("type") == "debug_event" and event.get("event") == "paused"


def is_terminal(event: Dict[str, Any]) -> bool:
    return (event.get("type") in ("exit", "err")
            or (event.get("type") == "debug_event"
                and event.get("event") == "terminated"))


def frame_of(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("payload") or event.get("body") or event
    stack = body.get("stack") or body.get("frames") or []
    if isinstance(stack, list) and stack:
        top = stack[0]
        if isinstance(top, dict):
            return top
    return body


def line_of(event: Dict[str, Any]) -> Optional[int]:
    payload = event.get("payload") or {}
    if isinstance(payload.get("line"), int):
        return payload["line"]
    frame = frame_of(event)
    for key in ("line", "lineNumber", "line_no"):
        if isinstance(frame.get(key), int):
            return frame[key]
    body = event.get("payload") or {}
    return body.get("line") if isinstance(body.get("line"), int) else None


def function_of(event: Dict[str, Any]) -> str:
    payload = event.get("payload") or {}
    if isinstance(payload.get("function"), str):
        return payload["function"]
    frame = frame_of(event)
    for key in ("func", "function", "name", "method"):
        if isinstance(frame.get(key), str):
            return frame[key]
    return ""


def variables_of(event: Dict[str, Any]) -> Any:
    body = event.get("payload") or event.get("body") or event
    for key in ("locals", "variables", "scopes"):
        if body.get(key):
            return body[key]
    frame = frame_of(event)
    for key in ("variables", "locals"):
        if frame.get(key):
            return frame[key]
    return None


def stack_of(event: Dict[str, Any]) -> Any:
    body = event.get("payload") or event.get("body") or event
    for key in ("stack", "frames", "callStack"):
        if body.get(key):
            return body[key]
    return None


async def open_session(base: str, lang: str, entry: str, source: str,
                       breakpoints: List[Dict[str, Any]]):
    payload = {
        "lang": lang,
        "entry": entry,
        "files": [{"name": entry, "content": source}],
        "mode": "debug",
        "breakpoints": breakpoints,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        reply = await client.post(base + "/run", json=payload)
    if reply.status_code != 200:
        raise RuntimeError("run failed %d: %s" % (reply.status_code, reply.text[:180]))
    sid = reply.json()["session_id"]
    ws_url = base.replace("http://", "ws://") + "/ws/run/" + sid
    return await websockets.connect(ws_url, max_size=8 * 1024 * 1024), sid


async def stepping_probe(base: str, lang: str, found: Dict[str, bool]) -> None:
    """Drive one session: reach the breakpoint, then step through it."""
    entry, source, break_line = programs.STEPPING[lang]
    ws, _ = await open_session(base, lang, entry, source,
                               [{"file": entry, "line": break_line}])
    session = Session(ws)
    try:
        first = await session.collect(is_paused)
        if first is None:
            return

        # The session pauses at the program entry before the requested
        # breakpoint, so resume once to reach it.
        at_break = first
        if line_of(first) != break_line:
            await session.send({"type": "debug_cmd", "command": "continue"})
            reached = await session.collect(
                lambda e: is_paused(e) and line_of(e) == break_line, timeout=60)
            if reached is not None:
                at_break = reached

        if line_of(at_break) == break_line:
            found["breakpoint"] = True
            found["pause_location"] = True
        elif is_paused(at_break):
            found["breakpoint"] = True

        if variables_of(at_break):
            found["local_variables"] = True
        if stack_of(at_break):
            found["call_stack"] = True

        outer = function_of(at_break)
        outer_line = line_of(at_break)

        await session.send({"type": "debug_cmd", "command": "evaluate", "expr": "acc"})
        if await session.collect(
                lambda e: e.get("event") == "evaluate_result", timeout=30):
            found["evaluate"] = True

        # Each stepping operation is issued from the breakpoint pause rather
        # than from wherever the previous one happened to leave the program.
        # Measuring them in sequence made the result order-dependent: a step
        # over issued from a loop header advances execution but reports the
        # same line, which is correct behaviour that the earlier ordering
        # recorded as a failure. The breakpoint sits inside a loop, so the
        # session can be returned to it between operations.
        await session.send({"type": "debug_cmd", "command": "next"})
        over = await session.collect(is_paused, timeout=45)
        if over is not None and line_of(over) != outer_line:
            found["step_over"] = True

        await session.send({"type": "debug_cmd", "command": "continue"})
        again = await session.collect(
            lambda e: is_paused(e) and line_of(e) == break_line, timeout=60)
        if again is not None:
            found["continue"] = True

        await session.send({"type": "debug_cmd", "command": "step_in"})
        stepped = await session.collect(is_paused, timeout=45)
        inner = ""
        if stepped is not None:
            inner = function_of(stepped)
            if inner and outer and inner != outer:
                found["step_in"] = True

        if stepped is not None:
            await session.send({"type": "debug_cmd", "command": "step_out"})
            back = await session.collect(is_paused, timeout=45)
            if back is not None and inner and function_of(back) != inner:
                found["step_out"] = True

        await session.send({"type": "debug_cmd", "command": "stop"})
        await session.collect(is_terminal, timeout=30)
        if session.output_text().strip():
            found["program_output"] = True
    finally:
        await ws.close()


async def stdin_probe(base: str, lang: str, found: Dict[str, bool]) -> None:
    entry, source = programs.STDIN[lang]
    ws, _ = await open_session(base, lang, entry, source, [])
    session = Session(ws)
    try:
        # Debug sessions pause at the entry point; resume so the program can
        # reach its blocking read.
        if await session.collect(is_paused, timeout=60) is not None:
            await session.send({"type": "debug_cmd", "command": "continue"})
        asked = await session.collect(
            lambda e: e.get("type") == "awaiting_input"
            or (e.get("type") == "debug_event" and e.get("event") == "await_input"),
            timeout=60)
        if asked is not None:
            found["stdin"] = True
            await session.send({"type": "stdin", "data": "world\n"})
        await session.collect(is_terminal, timeout=60)
        if "world" in session.output_text():
            found["stdin"] = True
            found["program_output"] = True
        elif session.output_text().strip():
            found["program_output"] = True
    finally:
        await ws.close()


async def exception_probe(base: str, lang: str, found: Dict[str, bool]) -> None:
    entry, source = programs.EXCEPTION[lang]
    ws, _ = await open_session(base, lang, entry, source, [])
    session = Session(ws)
    try:
        # Resume past the entry pause so the fault is actually reached.
        if await session.collect(is_paused, timeout=60) is not None:
            await session.send({"type": "debug_cmd", "command": "continue"})
        await session.collect(is_terminal, timeout=90)
        if session.has_event("exception"):
            found["exception"] = True
        if session.output_text().strip():
            found["program_output"] = True
    finally:
        await ws.close()


def reap_containers(lang: str) -> None:
    """Best-effort removal of containers a probe left behind.

    Closing the socket kills the docker client process but does not always
    stop the container it attached to, so sessions that end abruptly can
    leave a runtime alive. The probe cleans up after itself so repeated runs
    do not accumulate them.
    """
    image = {"python": "omni-runner:python", "javascript": "omni-runner:node",
             "java": "omni-runner:java", "cpp": "omni-runner:cpp",
             "go": "omni-runner:go"}.get(lang)
    if not image:
        return
    try:
        listed = subprocess.run(["docker", "ps", "-q", "--filter", "ancestor=" + image],
                                capture_output=True, timeout=60)
        ids = [i for i in listed.stdout.decode().split() if i]
        if ids:
            subprocess.run(["docker", "rm", "-f"] + ids, capture_output=True, timeout=120)
    except Exception:
        pass


async def evaluate_language(base: str, lang: str) -> Dict[str, Any]:
    found = {c: False for c in CAPABILITIES}
    notes = []
    for name, probe in (("stepping", stepping_probe),
                        ("stdin", stdin_probe),
                        ("exception", exception_probe)):
        try:
            await asyncio.wait_for(probe(base, lang, found), timeout=SESSION_TIMEOUT)
        except Exception as exc:
            notes.append("%s: %s %s" % (name, type(exc).__name__, str(exc)[:70]))
        finally:
            reap_containers(lang)
    row = {"language": lang}
    row.update({c: found[c] for c in CAPABILITIES})
    row["supported"] = sum(found.values())
    row["notes"] = "; ".join(notes)
    return row


async def main_async(base: str, languages: List[str]) -> None:
    rows = []
    for lang in languages:
        print("probing %s ..." % lang, flush=True)
        row = await evaluate_language(base, lang)
        rows.append(row)
        got = [c for c in CAPABILITIES if row[c]]
        print("   %d/%d: %s" % (len(got), len(CAPABILITIES), ", ".join(got) or "none"))
        if row["notes"]:
            print("   notes: %s" % row["notes"])

    df = pd.DataFrame(rows)
    df.to_csv(RESULT_DIR / "debugger_capabilities.csv", index=False)

    print("\n=== DEBUGGER CAPABILITY MATRIX ===")
    header = "%-18s %s" % ("capability", " ".join("%-11s" % l for l in languages))
    print(header)
    for cap in CAPABILITIES:
        cells = []
        for lang in languages:
            row = next(r for r in rows if r["language"] == lang)
            cells.append("%-11s" % ("yes" if row[cap] else "no"))
        print("%-18s %s" % (cap, " ".join(cells)))
    print("\nresults written to %s" % (RESULT_DIR / "debugger_capabilities.csv"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8099")
    parser.add_argument("--languages", default=",".join(LANGUAGES))
    args = parser.parse_args()
    langs = [l.strip() for l in args.languages.split(",") if l.strip()]
    asyncio.run(main_async(args.base.rstrip("/"), langs))


if __name__ == "__main__":
    main()
