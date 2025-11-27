import subprocess
import threading
import time
from pathlib import Path


IMAGE = "omni-runner:python"   # <- your Python Docker image name
CONTAINER_WORKDIR = "/work"


def start_pdb_container() -> subprocess.Popen:
    """
    Start a docker container that runs:
        python -u -m pdb sample_program.py
    and returns the Popen handle. Stdin/stdout are piped so we can
    send commands and read output.
    """
    workdir = Path(__file__).resolve().parent

    cmd = [
        "docker", "run",
        "--rm",
        "-i",                         # keep stdin open
        "-v", f"{str(workdir)}:{CONTAINER_WORKDIR}",
        "-w", CONTAINER_WORKDIR,
        IMAGE,
        "python", "-u", "-m", "pdb", "sample_program.py",
    ]

    print("\n[debug] starting pdb container:")
    print(" ", " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,  # line-buffered
    )

    # Pump stdout to our console so we can see the debugger output.
    def pump_stdout():
        assert proc.stdout is not None
        for line in proc.stdout:
            print("[pdb]", line.rstrip())

    t = threading.Thread(target=pump_stdout, daemon=True)
    t.start()

    return proc


def send_cmd(proc: subprocess.Popen, cmd: str) -> None:
    """Send a single pdb command to the container."""
    assert proc.stdin is not None
    print(f"[send] {cmd}")
    proc.stdin.write(cmd + "\n")
    proc.stdin.flush()


def main():
    proc = start_pdb_container()

    try:
        # Give pdb a moment to start and show the initial prompt.
        time.sleep(1.0)

        # 1) Set a breakpoint on line 13 in sample_program.py
        #    (x = greet(f"user-{i}"))
        send_cmd(proc, "b sample_program.py:13")

        # 2) Continue execution until it hits the breakpoint
        send_cmd(proc, "c")

        # Give it a bit of time to hit the breakpoint and print stack info.
        time.sleep(1.0)

        # 3) Show where we are (stack trace)
        send_cmd(proc, "w")

        # 4) Inspect some variables
        send_cmd(proc, "p i")
        send_cmd(proc, "p x")
        send_cmd(proc, "p total")
        send_cmd(proc, "p locals()")

        # 5) Step to next line, just to demonstrate stepping
        send_cmd(proc, "n")  # "next" in pdb

        time.sleep(0.5)

        # 6) Continue to the end
        send_cmd(proc, "c")

        # 7) Quit the debugger (in case the program hasn't finished)
        time.sleep(0.5)
        send_cmd(proc, "q")

        # Wait a bit for container to exit cleanly
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print("[debug] container did not exit in time; terminating...")
            proc.terminate()

    finally:
        # Safety cleanup
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()