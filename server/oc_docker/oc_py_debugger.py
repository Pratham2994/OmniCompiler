# oc_py_debugger.py
import bdb
import sys
import json
import traceback
import threading
import queue
import os

COMMAND_QUEUE = queue.Queue()
INPUT_QUEUE = queue.Queue()


def read_commands():
    """Continuously read JSON commands from stdin and push to a queue."""
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except Exception:
            # Ignore malformed input
            continue
        # stdin payloads are routed to INPUT_QUEUE so that the input()
        # override can consume them without racing debug commands.
        if cmd.get("type") == "stdin":
            INPUT_QUEUE.put(cmd.get("data", ""))
            continue
        COMMAND_QUEUE.put(cmd)


class OmniDebugger(bdb.Bdb):
    """Minimal debugger used by Omni's Python debug backend."""

    def __init__(self, target_script: str):
        super().__init__()
        target_abspath = os.path.abspath(target_script)
        self.target_script = target_script
        self.target_base = os.path.basename(target_abspath)
        self.workdir = os.path.dirname(target_abspath)
        self.input_queue = INPUT_QUEUE

    # ------------ Bdb callbacks ------------

    def user_line(self, frame):
        """Called when we stop on a new source line."""
        if not self._is_user_frame(frame):
            # keep stepping until we reach the user script
            self.set_step()
            return

        info = self._collect_state(frame)
        self._emit_event("stopped", info)
        self._wait_for_command(frame)

    def user_exception(self, frame, exc_info):
        if not self._is_user_frame(frame):
            self.set_step()
            return

        info = self._collect_state(frame)
        info["exception"] = repr(exc_info[1])
        self._emit_event("exception", info)
        self._wait_for_command(frame)

    # ------------ helpers ------------

    def _is_user_frame(self, frame) -> bool:
        """
        Treat any file inside the working directory (e.g., /work) as user code.
        This lets us step into helper modules, not just the entry script.
        """
        fname = frame.f_code.co_filename
        if not fname:
            return False

        abspath = os.path.abspath(fname)
        try:
            if self.workdir and os.path.commonpath([abspath, self.workdir]) == self.workdir:
                return True
        except Exception:
            pass

        return os.path.basename(abspath) == self.target_base

    def _emit_event(self, event, body):
        packet = {"event": event, "body": body}
        sys.stdout.write(json.dumps(packet) + "\n")
        sys.stdout.flush()

    def _collect_state(self, frame):
        stack = []
        f = frame
        while f:
            stack.append(
                {
                    "file": f.f_code.co_filename,
                    "line": f.f_lineno,
                    "func": f.f_code.co_name,
                }
            )
            f = f.f_back

        return {
            "file": frame.f_code.co_filename,
            "line": frame.f_lineno,
            "locals": {k: repr(v) for k, v in frame.f_locals.items()},
            "stack": stack,
        }

    def _normalize_path(self, path: str) -> str:
        """
        Normalize a user-provided path so that both "/work/foo.py" and "foo.py"
        refer to the same file. Falls back to the original path on failure.
        """
        if not path:
            return path
        try:
            abspath = os.path.abspath(path)
            if self.workdir and os.path.commonpath([abspath, self.workdir]) == self.workdir:
                rel = os.path.relpath(abspath, self.workdir)
                return rel
        except Exception:
            pass
        return path

    def _wait_for_input(self, prompt: str = "") -> str:
        """
        Wait for a line of user input provided by the host via stdin messages.
        Emits an await_input event so the frontend can enable the input box.
        """
        try:
            self._emit_event("await_input", {"prompt": prompt})
        except Exception:
            pass
        try:
            line = self.input_queue.get()
        except Exception:
            line = ""
        return line

    def _wait_for_command(self, frame):
        """Block here until the user issues a debugger command."""
        while True:
            cmd = COMMAND_QUEUE.get()
            t = cmd.get("type")

            if t == "continue":
                # run until next breakpoint / stop
                return self.set_continue()

            if t == "step_over":
                # step over within this frame
                return self.set_next(frame)

            if t == "step_in":
                # step into
                return self.set_step()

            if t == "step_out":
                # run until current frame returns
                return self.set_return(frame)

            if t == "set_breakpoints":
                self.clear_all_breaks()
                for bp in cmd.get("breakpoints", []):
                    filename = self._normalize_path(bp["file"])
                    self.set_break(filename, bp["line"])
                self._emit_event("breakpoints_set", {"ok": True})
                continue

            if t == "evaluate":
                expr = cmd.get("expr", "")
                try:
                    value = eval(expr, frame.f_globals, frame.f_locals)
                    self._emit_event(
                        "evaluate_result",
                        {"expr": expr, "value": repr(value)},
                    )
                except Exception as e:
                    self._emit_event(
                        "evaluate_result",
                        {"expr": expr, "error": str(e)},
                    )
                continue

            if t == "stop":
                sys.exit(0)

            # Any other command types are ignored to keep the loop simple.


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: oc_py_debugger.py <script.py>\n")
        sys.exit(1)

    target_script = sys.argv[1]

    # background command reader
    threading.Thread(target=read_commands, daemon=True).start()

    dbg = OmniDebugger(target_script)

    # Override input() so the debug host can feed stdin from the browser.
    import builtins

    _orig_input = builtins.input

    def _oc_input(prompt=""):
        prompt_text = str(prompt)
        if prompt_text:
            try:
                dbg._emit_event("output", {"stream": "stdout", "data": prompt_text})
            except Exception:
                try:
                    sys.stdout.write(prompt_text)
                    sys.stdout.flush()
                except Exception:
                    pass
        return dbg._wait_for_input(prompt_text)

    builtins.input = _oc_input

    try:
        # Read and compile the user's script with the correct filename
        with open(target_script, "r", encoding="utf-8") as f:
            source = f.read()

        code = compile(source, target_script, "exec")

        builtins_mod = __import__("builtins")
        globs = {
            "__name__": "__main__",
            "__file__": target_script,
            "__package__": None,
            "__spec__": None,
            "__builtins__": builtins_mod,
        }

        # If initial breakpoints were provided (env var), set them and do not stop at line 1.
        init_bps = os.environ.get("OC_INIT_BPS", "")
        init_bps_path = os.environ.get("OC_INIT_BPS_PATH")
        bps_applied = False

        def _apply_breakpoints(bp_json: str):
            nonlocal bps_applied
            try:
                bp_list = json.loads(bp_json)
                for bp in bp_list or []:
                    filename = bp.get("file")
                    line = bp.get("line")
                    if filename and line:
                        dbg.set_break(dbg._normalize_path(filename), int(line))
                        bps_applied = True
            except Exception:
                bps_applied = False

        if init_bps_path and os.path.exists(init_bps_path):
            try:
                with open(init_bps_path, "r", encoding="utf-8") as f:
                    _apply_breakpoints(f.read())
            except Exception:
                bps_applied = False
        elif init_bps:
            _apply_breakpoints(init_bps)

        if not bps_applied:
            # Default: stop on the first line so the client can set breakpoints interactively
            dbg.set_step()

        # Run the compiled code object under the debugger
        dbg.run(code, globs, globs)

        # Let client know the program finished normally
        sys.stdout.write(json.dumps({"event": "terminated", "body": {}}) + "\n")
        sys.stdout.flush()

    except SystemExit:
        sys.stdout.write(
            json.dumps(
                {"event": "terminated", "body": {"reason": "SystemExit"}}
            )
            + "\n"
        )
        sys.stdout.flush()
    except Exception:
        traceback.print_exc()


if __name__ == "__main__":
    main()
