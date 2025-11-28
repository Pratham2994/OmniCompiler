import subprocess
import threading
import time
from pathlib import Path


IMAGE = "omni-runner:python"                                     
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
        "-i",                                          
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
        bufsize=1,                 
    )

                                                                   
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
                                                                 
        time.sleep(1.0)

                                                             
                                     
        send_cmd(proc, "b sample_program.py:13")

                                                            
        send_cmd(proc, "c")

                                                                           
        time.sleep(1.0)

                                            
        send_cmd(proc, "w")

                                   
        send_cmd(proc, "p i")
        send_cmd(proc, "p x")
        send_cmd(proc, "p total")
        send_cmd(proc, "p locals()")

                                                            
        send_cmd(proc, "n")                 

        time.sleep(0.5)

                                
        send_cmd(proc, "c")

                                                                    
        time.sleep(0.5)
        send_cmd(proc, "q")

                                                  
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print("[debug] container did not exit in time; terminating...")
            proc.terminate()

    finally:
                        
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()