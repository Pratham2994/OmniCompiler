"""Systems benchmarks for the SA-CLD execution and debugging path.

Measures three costs that the paper reports:

  1. container_provisioning - wall time to create a cold, resource-capped
     container with the language workdir mounted and run a trivial command.
     This is the isolation overhead that native local execution avoids.
     Every run is a cold start; the system maintains no warm container pool.

  2. end_to_end_execution   - wall time to provision a container and run a
     minimal program in the target language, including compilation for the
     compiled languages.

  3. debug_event_serialization - cost of encoding and decoding one debugger
     state message of the shape the WebSocket data plane carries during
     stepping, including a call stack and local variable scopes.

Results are written to server/data/results/ so the reported figures can be
regenerated. Requires a running Docker daemon and the omni-runner images.
"""

from __future__ import annotations

import json
import shutil
import statistics
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Dict, List

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RESULT_DIR = ROOT / "data" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

DOCKER_IMAGES = {
    "python": "omni-runner:python",
    "cpp": "omni-runner:cpp",
    "javascript": "omni-runner:node",
    "go": "omni-runner:go",
    "java": "omni-runner:java",
}

ISOLATION_FLAGS = [
    "--rm", "-i",
    "--network", "none",
    "--cpus", "1",
    "--memory", "512m",
    "--pids-limit", "256",
]

HELLO = {
    "python": ("hello.py", 'print("hello")\n', "python -u hello.py"),
    "javascript": ("hello.js", 'console.log("hello");\n', "node hello.js"),
    "go": ("hello.go", 'package main\nimport "fmt"\nfunc main() { fmt.Println("hello") }\n',
           "go run hello.go"),
    "cpp": ("hello.cpp", '#include <iostream>\nint main(){ std::cout << "hello" << std::endl; }\n',
            "g++ -O2 hello.cpp -o app && ./app"),
    "java": ("Hello.java", 'public class Hello { public static void main(String[] a){ System.out.println("hello"); } }\n',
             "javac Hello.java && java Hello"),
}

REPEATS = 7


def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        subprocess.run(["docker", "info"], capture_output=True, timeout=60, check=True)
        return True
    except Exception:
        return False


def time_provisioning(lang: str, image: str) -> List[float]:
    samples = []
    with tempfile.TemporaryDirectory(prefix="oc-bench-") as tmp:
        mount = "%s:/work" % Path(tmp).resolve()
        cmd = ["docker", "run"] + ISOLATION_FLAGS + [
            "-v", mount, "-w", "/work", image, "/bin/sh", "-c", "exit 0"]
        for _ in range(REPEATS):
            start = time.perf_counter()
            proc = subprocess.run(cmd, capture_output=True, timeout=300)
            elapsed = (time.perf_counter() - start) * 1000.0
            if proc.returncode != 0:
                raise RuntimeError("provisioning failed for %s: %s"
                                   % (lang, proc.stderr.decode(errors="ignore")[:200]))
            samples.append(elapsed)
    return samples


def time_end_to_end(lang: str, image: str) -> List[float]:
    name, source, run_cmd = HELLO[lang]
    samples = []
    with tempfile.TemporaryDirectory(prefix="oc-bench-") as tmp:
        path = Path(tmp) / name
        path.write_text(source, encoding="utf-8", newline="\n")
        mount = "%s:/work" % Path(tmp).resolve()
        cmd = ["docker", "run"] + ISOLATION_FLAGS + [
            "-v", mount, "-w", "/work", image, "/bin/sh", "-lc", run_cmd]
        for _ in range(REPEATS):
            start = time.perf_counter()
            proc = subprocess.run(cmd, capture_output=True, timeout=600)
            elapsed = (time.perf_counter() - start) * 1000.0
            if proc.returncode != 0 or b"hello" not in proc.stdout:
                raise RuntimeError("execution failed for %s: %s"
                                   % (lang, (proc.stderr or proc.stdout).decode(errors="ignore")[:200]))
            samples.append(elapsed)
    return samples


def debug_event_payload() -> Dict:
    """A stopped event of the shape the debugger shims emit while stepping."""
    frames = [
        {"id": i, "name": "frame_%d" % i, "file": "/work/module_%d.py" % i,
         "line": 40 + i, "column": 1}
        for i in range(8)
    ]
    variables = [
        {"name": "var_%d" % i, "value": "value string number %d" % i,
         "type": "str", "scope": "locals"}
        for i in range(40)
    ]
    return {
        "event": "stopped", "reason": "step", "threadId": 1,
        "file": "/work/main.py", "line": 42,
        "stack": frames, "variables": variables,
        "output": "partial program output line\n" * 4,
    }


def time_serialization() -> Dict[str, float]:
    payload = debug_event_payload()
    encoded = json.dumps(payload)
    reps = 20000

    start = time.perf_counter()
    for _ in range(reps):
        json.dumps(payload)
    encode_ms = (time.perf_counter() - start) * 1000.0 / reps

    start = time.perf_counter()
    for _ in range(reps):
        json.loads(encoded)
    decode_ms = (time.perf_counter() - start) * 1000.0 / reps

    return {
        "payload_bytes": len(encoded),
        "stack_frames": len(payload["stack"]),
        "variables": len(payload["variables"]),
        "encode_ms": encode_ms,
        "decode_ms": decode_ms,
        "round_trip_ms": encode_ms + decode_ms,
    }


def summarise(lang: str, kind: str, samples: List[float]) -> Dict:
    return {
        "language": lang,
        "measurement": kind,
        "repeats": len(samples),
        "mean_ms": statistics.mean(samples),
        "median_ms": statistics.median(samples),
        "min_ms": min(samples),
        "max_ms": max(samples),
        "stdev_ms": statistics.stdev(samples) if len(samples) > 1 else 0.0,
    }


def main() -> None:
    if not docker_available():
        raise SystemExit("Docker is not available; cannot run systems benchmarks.")

    info = subprocess.run(
        ["docker", "info", "--format",
         "{{.ServerVersion}}|{{.OSType}}|{{.NCPU}}|{{.MemTotal}}"],
        capture_output=True, text=True, check=True).stdout.strip()
    print("docker: %s" % info)

    rows = []
    for lang, image in DOCKER_IMAGES.items():
        print("  provisioning %s ..." % lang, flush=True)
        rows.append(summarise(lang, "cold_provisioning", time_provisioning(lang, image)))
        print("  end-to-end   %s ..." % lang, flush=True)
        rows.append(summarise(lang, "end_to_end_execution", time_end_to_end(lang, image)))

    df = pd.DataFrame(rows)
    df.to_csv(RESULT_DIR / "container_latency.csv", index=False)
    print("\n=== CONTAINER LATENCY (cold start, no warm pool) ===")
    print(df.to_string(index=False, float_format=lambda v: "%.1f" % v))

    ser = time_serialization()
    pd.DataFrame([ser]).to_csv(RESULT_DIR / "serialization_latency.csv", index=False)
    print("\n=== DEBUG EVENT SERIALIZATION ===")
    for k, v in ser.items():
        print("  %-18s %s" % (k, ("%.4f" % v) if isinstance(v, float) else v))

    print("\nresults written to %s" % RESULT_DIR)


if __name__ == "__main__":
    main()
