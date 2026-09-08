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

import argparse
import concurrent.futures
import json
import re
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

REPEATS = 50
CONCURRENCY_LEVELS = [1, 5, 10, 25]
MEMORY_SETTLE_SECONDS = 2.0


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


def percentile(samples, fraction):
    ordered = sorted(samples)
    if not ordered:
        return float("nan")
    index = min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1))))
    return ordered[index]


IDLE_SOURCE = {
    "python": ("idle.py", "import time\ntime.sleep(25)\n", "python -u idle.py"),
    "javascript": ("idle.js", "setTimeout(function () {}, 25000);\n", "node idle.js"),
    "java": ("Idle.java",
             "public class Idle {\n"
             "    public static void main(String[] args) throws Exception {\n"
             "        Thread.sleep(25000);\n"
             "    }\n"
             "}\n",
             "javac Idle.java && java Idle"),
    "cpp": ("idle.cpp",
            "#include <unistd.h>\nint main() { sleep(25); return 0; }\n",
            "g++ -O0 idle.cpp -o idle && ./idle"),
    "go": ("idle.go",
           "package main\n\nimport \"time\"\n\nfunc main() { time.Sleep(25 * time.Second) }\n",
           "go run idle.go"),
}


def measure_memory(lang: str, image: str) -> Dict[str, float]:
    """Resident memory of a container holding a suspended program.

    The workload starts the language runtime and then sleeps, which
    approximates a session paused at a breakpoint: the interpreter or virtual
    machine is resident while the program makes no progress. Measuring a bare
    sleep would report only the container's own overhead, roughly one
    megabyte, which says nothing about the cost of a debugging session. C++
    has no separate runtime, so its figure is that of the compiled binary.

    The source is written into a mounted directory rather than generated by a
    shell command, so that quoting differences between the languages cannot
    silently drop a measurement.
    """
    spec = IDLE_SOURCE.get(lang)
    if not spec:
        return {}
    filename, source, command = spec
    name = "oc-mem-%s-%d" % (lang, int(time.time() * 1000))

    with tempfile.TemporaryDirectory(prefix="oc-mem-") as tmp:
        (Path(tmp) / filename).write_text(source, encoding="utf-8", newline="\n")
        cmd = (["docker", "run", "-d", "--name", name] + ISOLATION_FLAGS[2:]
               + ["-v", "%s:/work" % Path(tmp).resolve(), "-w", "/work",
                  image, "/bin/sh", "-lc", command])
        created = subprocess.run(cmd, capture_output=True, timeout=300)
        if created.returncode != 0:
            return {}
        try:
            settle = MEMORY_SETTLE_SECONDS + (10.0 if lang in ("java", "go", "cpp") else 1.0)
            time.sleep(settle)
            samples = []
            for _ in range(6):
                stat = subprocess.run(
                    ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", name],
                    capture_output=True, timeout=60)
                text = stat.stdout.decode(errors="ignore").strip()
                match = re.match(r"([0-9.]+)\s*([KMG]i?B)", text)
                if match:
                    value = float(match.group(1))
                    unit = match.group(2).rstrip("B").rstrip("i")
                    factor = {"K": 1 / 1024.0, "M": 1.0, "G": 1024.0}.get(unit, 1.0)
                    samples.append(value * factor)
                time.sleep(0.8)
            alive = subprocess.run(["docker", "ps", "-q", "--filter", "name=" + name],
                                   capture_output=True, timeout=60)
            running = bool(alive.stdout.strip())
            if not samples:
                return {}
            return {"idle_mb": statistics.median(samples),
                    "peak_mb": max(samples),
                    "samples": len(samples),
                    "runtime_resident": running}
        finally:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=120)


def measure_concurrency(lang: str, image: str, level: int) -> Dict[str, float]:
    """Wall time to provision `level` containers at once.

    Reports the time for the whole batch and the mean per container, so that
    contention is visible as the gap between the two.
    """
    with tempfile.TemporaryDirectory(prefix="oc-conc-") as tmp:
        mount = "%s:/work" % Path(tmp).resolve()
        cmd = ["docker", "run"] + ISOLATION_FLAGS + [
            "-v", mount, "-w", "/work", image, "/bin/sh", "-c", "exit 0"]

        def one():
            start = time.perf_counter()
            subprocess.run(cmd, capture_output=True, timeout=600)
            return (time.perf_counter() - start) * 1000.0

        batch_start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=level) as pool:
            durations = list(pool.map(lambda _: one(), range(level)))
        batch_ms = (time.perf_counter() - batch_start) * 1000.0

    return {"language": lang, "concurrency": level,
            "batch_ms": batch_ms,
            "mean_container_ms": statistics.mean(durations),
            "median_container_ms": statistics.median(durations),
            "p95_container_ms": percentile(durations, 0.95),
            "max_container_ms": max(durations)}


def summarise(lang: str, kind: str, samples: List[float]) -> Dict:
    return {
        "language": lang,
        "measurement": kind,
        "repeats": len(samples),
        "mean_ms": statistics.mean(samples),
        "median_ms": statistics.median(samples),
        "stdev_ms": statistics.stdev(samples) if len(samples) > 1 else 0.0,
        "min_ms": min(samples),
        "p95_ms": percentile(samples, 0.95),
        "p99_ms": percentile(samples, 0.99),
        "max_ms": max(samples),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-latency", action="store_true",
                        help="reuse the existing latency CSV and measure only "
                             "memory and concurrency")
    args = parser.parse_args()

    if not docker_available():
        raise SystemExit("Docker is not available; cannot run systems benchmarks.")

    info = subprocess.run(
        ["docker", "info", "--format",
         "{{.ServerVersion}}|{{.OSType}}|{{.NCPU}}|{{.MemTotal}}"],
        capture_output=True, text=True, check=True).stdout.strip()
    print("docker: %s" % info)

    rows = []
    for lang, image in ({} if args.skip_latency else DOCKER_IMAGES).items():
        print("  provisioning %s ..." % lang, flush=True)
        rows.append(summarise(lang, "cold_provisioning", time_provisioning(lang, image)))
        print("  end-to-end   %s ..." % lang, flush=True)
        rows.append(summarise(lang, "end_to_end_execution", time_end_to_end(lang, image)))

    if not rows:
        # --skip-latency reuses the existing file; writing an empty frame
        # here would destroy the measurements the paper cites.
        print("\n=== CONTAINER LATENCY: skipped, existing CSV kept ===")
    else:
        df = pd.DataFrame(rows)
        df.to_csv(RESULT_DIR / "container_latency.csv", index=False)
        print("\n=== CONTAINER LATENCY (cold start, no warm pool) ===")
        print(df.to_string(index=False, float_format=lambda v: "%.1f" % v))

    mem_rows = []
    for lang, image in DOCKER_IMAGES.items():
        print("  memory      %s ..." % lang, flush=True)
        stats = measure_memory(lang, image)
        if stats:
            stats.update({"language": lang})
            mem_rows.append(stats)
    if mem_rows:
        mem = pd.DataFrame(mem_rows)[["language", "idle_mb", "peak_mb", "samples", "runtime_resident"]]
        mem.to_csv(RESULT_DIR / "container_memory.csv", index=False)
        print("\n=== PAUSED CONTAINER MEMORY ===")
        print(mem.to_string(index=False, float_format=lambda v: "%.1f" % v))

    conc_rows = []
    for level in CONCURRENCY_LEVELS:
        print("  concurrency %d ..." % level, flush=True)
        conc_rows.append(measure_concurrency("python", DOCKER_IMAGES["python"], level))
    conc = pd.DataFrame(conc_rows)
    conc.to_csv(RESULT_DIR / "container_concurrency.csv", index=False)
    print("\n=== CONCURRENT PROVISIONING (python image) ===")
    print(conc.to_string(index=False, float_format=lambda v: "%.1f" % v))

    ser = time_serialization()
    pd.DataFrame([ser]).to_csv(RESULT_DIR / "serialization_latency.csv", index=False)
    print("\n=== DEBUG EVENT SERIALIZATION ===")
    for k, v in ser.items():
        print("  %-18s %s" % (k, ("%.4f" % v) if isinstance(v, float) else v))

    print("\nresults written to %s" % RESULT_DIR)


if __name__ == "__main__":
    main()
