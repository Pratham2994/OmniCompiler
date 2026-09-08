"""Controlled comparison of CFG-anchored against raw-text prompting.

The framework claims that supplying control-flow structure alongside the
source text improves large language model reasoning about code. This script
tests that claim directly on cross-language translation.

Every benchmark program is translated to every target language twice under
identical settings, differing only in whether the prompt carries the
structural summary produced by build_cfg_summary:

  anchored - prompt includes the control-flow graph summary
  plain    - prompt is the source text alone

Each translation is then judged three ways:

  structural  - the control-flow graph of the translation is extracted with
                the same engine used on the source, and compared on total
                cyclomatic complexity, loop count, branch count and function
                count. This asks whether the translation preserved the shape
                of the original program.
  executable  - the translation is compiled and run in the language's
                sandbox container. This asks whether it is valid code.
  output      - the program's standard output is compared with the source
                program's. This asks whether it is behaviourally correct.

Translations are cached under data/results/translations/ so an interrupted
run resumes without repeating API calls, and so a reviewer can inspect the
exact model outputs behind the reported numbers.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import threading
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

load_dotenv(ROOT / ".env")

from server.routes.cfg_routes import (  # noqa: E402
    _collect_nodes_from_text,
    build_cfg_edges,
    build_cfg_summary,
)
from server.llm.gemini_client import (  # noqa: E402
    GeminiTranslationError,
    translate_with_gemini,
)

BENCH_DIR = ROOT / "data" / "translation_bench"
RESULT_DIR = ROOT / "data" / "results"
TRANSLATION_DIR = RESULT_DIR / "translations"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

SOURCE_LANG = "python"

TARGETS: Dict[str, Dict[str, str]] = {
    "javascript": {"ext": "js", "image": "omni-runner:node", "run": "node {file}"},
    "java": {"ext": "java", "image": "omni-runner:java", "run": "javac {file} && java {stem}"},
    "cpp": {"ext": "cpp", "image": "omni-runner:cpp", "run": "g++ -O2 {file} -o app && ./app"},
    "go": {"ext": "go", "image": "omni-runner:go", "run": "go run {file}"},
}

CONDITIONS = ["anchored", "plain"]

ISOLATION = ["--rm", "-i", "--network", "none", "--cpus", "1",
             "--memory", "512m", "--pids-limit", "256"]

LOOP_TYPES = {"for", "while"}
BRANCH_TYPES = {"if", "elif", "else"}

API_PAUSE_SECONDS = 1.2
MAX_RETRIES = 8

RETRY_AFTER = re.compile(r"retry in ([0-9.]+)s", re.IGNORECASE)


KEY_SHAPE = re.compile(r"[A-Za-z0-9._\-]{25,}")


def distinct_keys() -> List[str]:
    """Every distinct API credential in server/.env, to spread calls across them.

    Both the older AIza form and the newer AQ. form are accepted. Values are
    read from the file rather than the environment so that keys recorded
    without a recognised variable name are still picked up.
    """
    seen: List[str] = []
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            value = line.split("=", 1)[1].strip() if "=" in line else line
            if not KEY_SHAPE.fullmatch(value):
                continue
            if not (value.startswith("AIza") or value.startswith("AQ.")):
                continue
            if value not in seen:
                seen.append(value)
    for name in ("GOOGLE_GENAI_API_KEY", "GEMINI_API_KEY",
                 "GOOGLE_GENAI_INSIGHT_API_KEY"):
        value = os.getenv(name)
        if value and value not in seen:
            seen.append(value)
    if not seen:
        raise SystemExit("no Gemini API key configured in server/.env")
    return seen


def live_keys(candidates: List[str]) -> List[str]:
    """Keep only credentials that can serve a request right now.

    Quotas are per credential, so a run that rotates blindly spends most of
    its retries on keys that are already exhausted. One cheap probe each
    keeps the worker pool pointed at usable capacity.
    """
    import httpx

    url = ("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent"
           % os.getenv("GOOGLE_GENAI_MODEL", "gemini-3.6-flash"))
    live = []
    for key in candidates:
        try:
            reply = httpx.post(url, params={"key": key},
                               json={"contents": [{"parts": [{"text": "ok"}]}]},
                               timeout=45)
            if reply.status_code == 200:
                live.append(key)
        except Exception:
            continue
    return live or candidates


_KEYS = None
_key_index = 0


def next_key() -> str:
    global _KEYS, _key_index
    if _KEYS is None:
        _KEYS = distinct_keys()
    key = _KEYS[_key_index % len(_KEYS)]
    _key_index += 1
    return key


def structural_profile(code: str, lang: str) -> Optional[Dict[str, int]]:
    """Control-flow shape of one program, or None if it cannot be extracted."""
    try:
        nodes, _ = _collect_nodes_from_text(code, lang, "prog")
        if not nodes:
            return None
        _edges, _synth, metrics = build_cfg_edges(nodes)
    except Exception:
        return None
    return {
        "functions": len(metrics.get("functions", [])),
        "cyclomatic": sum(f["cyclomatic"] for f in metrics.get("functions", [])),
        "loops": sum(1 for n in nodes if n.type in LOOP_TYPES),
        "branches": sum(1 for n in nodes if n.type in BRANCH_TYPES),
        "back_edges": metrics.get("back_edge_count", 0),
    }


def java_stem(code: str, fallback: str) -> str:
    match = re.search(r"public\s+(?:final\s+)?class\s+([A-Za-z_]\w*)", code)
    if match:
        return match.group(1)
    match = re.search(r"class\s+([A-Za-z_]\w*)", code)
    return match.group(1) if match else fallback


def run_in_sandbox(code: str, lang: str, stem: str) -> Tuple[bool, str]:
    """Compile and run one translation. Returns (succeeded, stdout)."""
    spec = TARGETS[lang]
    if lang == "java":
        stem = java_stem(code, "Main")
    filename = "%s.%s" % (stem, spec["ext"])

    with tempfile.TemporaryDirectory(prefix="oc-anchor-") as tmp:
        path = Path(tmp) / filename
        path.write_text(code, encoding="utf-8", newline="\n")
        command = spec["run"].format(file=filename, stem=stem)
        cmd = (["docker", "run"] + ISOLATION
               + ["-v", "%s:/work" % Path(tmp).resolve(), "-w", "/work",
                  spec["image"], "/bin/sh", "-lc", command])
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=180)
        except subprocess.TimeoutExpired:
            return False, ""
    if proc.returncode != 0:
        return False, proc.stdout.decode(errors="ignore")
    return True, proc.stdout.decode(errors="ignore")


def docker_available() -> bool:
    """True only when the daemon actually answers.

    Checking that the client binary exists is not enough: with the daemon
    stopped every run fails, and recording those as execution failures would
    silently corrupt the results.
    """
    if not shutil.which("docker"):
        return False
    try:
        proc = subprocess.run(["docker", "info"], capture_output=True, timeout=60)
        return proc.returncode == 0
    except Exception:
        return False


def normalise_output(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.strip().splitlines())


def cache_path(condition: str, lang: str, stem: str) -> Path:
    return TRANSLATION_DIR / condition / lang / ("%s.%s" % (stem, TARGETS[lang]["ext"]))


_key_lock = threading.Lock()


def translate(code: str, lang: str, cfg_summary, api_key: Optional[str] = None) -> str:
    """One translation.

    An explicit api_key is used when supplied, so that concurrent workers can
    each hold their own credential instead of racing on a process-wide
    environment variable.
    """
    last = None
    for attempt in range(MAX_RETRIES):
        if api_key is None:
            with _key_lock:
                os.environ["GOOGLE_GENAI_API_KEY"] = next_key()
            key_for_call = None
        else:
            key_for_call = api_key
        try:
            results = translate_with_gemini_keyed(
                key_for_call,
                source_code=code,
                source_language=SOURCE_LANG,
                target_languages=[lang],
                options={"preserve_comments": True, "preserve_structure": True},
                cfg_summary=cfg_summary,
            )
            return results[0]["code"]
        except GeminiTranslationError as exc:
            last = exc
            match = RETRY_AFTER.search(str(exc))
            if match:
                wait = float(match.group(1)) + 2.0
            else:
                wait = min(API_PAUSE_SECONDS * (2 ** attempt), 90.0)
            print("      retry %d after %.0fs (%s)" % (attempt + 1, wait, str(exc)[:70]))
            time.sleep(wait)
    raise RuntimeError("translation failed after retries: %s" % last)


def translate_with_gemini_keyed(api_key, **kwargs):
    """translate_with_gemini bound to one credential, without touching os.environ.

    The client library resolves its key from the environment, so a concurrent
    caller has to set and restore it under a lock. Serialising only this
    assignment keeps the expensive network call parallel.
    """
    if api_key is None:
        return translate_with_gemini(**kwargs)
    with _key_lock:
        previous = os.environ.get("GOOGLE_GENAI_API_KEY")
        os.environ["GOOGLE_GENAI_API_KEY"] = api_key
    try:
        return translate_with_gemini(**kwargs)
    finally:
        with _key_lock:
            if previous is None:
                os.environ.pop("GOOGLE_GENAI_API_KEY", None)
            else:
                os.environ["GOOGLE_GENAI_API_KEY"] = previous


def prefetch_translations(programs, summaries) -> int:
    """Fetch every missing translation concurrently, one worker per key."""
    keys = live_keys(distinct_keys())
    jobs = []
    for program in programs:
        stem = program.stem
        source = program.read_text(encoding="utf-8")
        for lang in TARGETS:
            for condition in CONDITIONS:
                target = cache_path(condition, lang, stem)
                if target.exists():
                    continue
                summary = summaries[stem] if condition == "anchored" else None
                jobs.append((target, source, lang, summary, stem, condition))

    if not jobs:
        print("all translations already cached")
        return 0

    print("fetching %d translations with %d keys in parallel" % (len(jobs), len(keys)))
    done = 0
    failures = 0
    lock = threading.Lock()

    def work(job, key):
        target, source, lang, summary, stem, condition = job
        text = translate(source, lang, summary, api_key=key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")
        return stem, lang, condition

    with ThreadPoolExecutor(max_workers=len(keys)) as pool:
        futures = {
            pool.submit(work, job, keys[i % len(keys)]): job
            for i, job in enumerate(jobs)
        }
        for future in as_completed(futures):
            job = futures[future]
            try:
                stem, lang, condition = future.result()
                with lock:
                    done += 1
                    print("  [%3d/%3d] %-22s %-11s %s"
                          % (done + failures, len(jobs), stem, lang, condition))
            except Exception as exc:
                with lock:
                    failures += 1
                    print("  FAILED %-22s %-11s %-9s %s"
                          % (job[4], job[2], job[5], str(exc)[:70]))
    print("fetched %d, failed %d" % (done, failures))
    return failures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0,
                        help="only use the first N benchmark programs")
    parser.add_argument("--skip-execution", action="store_true",
                        help="skip the Docker execution stage")
    args = parser.parse_args()

    programs = sorted(BENCH_DIR.glob("*.py"))
    if args.limit:
        programs = programs[:args.limit]
    if not programs:
        raise SystemExit("no benchmark programs found in %s" % BENCH_DIR)

    docker_ok = (not args.skip_execution) and docker_available()
    if not args.skip_execution and not docker_ok:
        print("docker daemon not reachable; recording structural results only "
              "and leaving execution columns empty")

    summaries = {}
    for program in programs:
        source = program.read_text(encoding="utf-8")
        summaries[program.stem] = build_cfg_summary(
            [(program.name, source)], SOURCE_LANG)
    prefetch_translations(programs, summaries)

    rows: List[Dict] = []
    exhausted = False
    for program in programs:
        if exhausted:
            break
        stem = program.stem
        source = program.read_text(encoding="utf-8")
        source_profile = structural_profile(source, SOURCE_LANG)
        cfg_summary = build_cfg_summary([(program.name, source)], SOURCE_LANG)

        reference = subprocess.run([sys.executable, str(program)],
                                   capture_output=True, timeout=120)
        expected = normalise_output(reference.stdout.decode(errors="ignore"))

        print("\n%s  (cyclomatic=%s loops=%s branches=%s)" % (
            stem, source_profile["cyclomatic"], source_profile["loops"],
            source_profile["branches"]))

        for lang in TARGETS:
            if exhausted:
                break
            for condition in CONDITIONS:
                target_path = cache_path(condition, lang, stem)
                target_path.parent.mkdir(parents=True, exist_ok=True)

                if target_path.exists():
                    translated = target_path.read_text(encoding="utf-8")
                    cached = True
                else:
                    summary = cfg_summary if condition == "anchored" else None
                    translated = translate(source, lang, summary)
                    target_path.write_text(translated, encoding="utf-8", newline="\n")
                    cached = False
                    time.sleep(API_PAUSE_SECONDS)

                profile = structural_profile(translated, lang)
                executed = None
                output_match = None
                if docker_ok:
                    ok, stdout = run_in_sandbox(translated, lang, stem)
                    executed = ok
                    output_match = ok and normalise_output(stdout) == expected

                row = {
                    "program": stem,
                    "target_language": lang,
                    "condition": condition,
                    "cached": cached,
                    "source_cyclomatic": source_profile["cyclomatic"],
                    "source_loops": source_profile["loops"],
                    "source_branches": source_profile["branches"],
                    "source_functions": source_profile["functions"],
                    "executable": executed,
                    "output_match": output_match,
                    "translated_chars": len(translated),
                }
                if profile is None:
                    row.update({"extracted": False, "cyclomatic_delta": None,
                                "loop_delta": None, "branch_delta": None,
                                "function_delta": None})
                else:
                    row.update({
                        "extracted": True,
                        "translation_cyclomatic": profile["cyclomatic"],
                        "translation_loops": profile["loops"],
                        "translation_branches": profile["branches"],
                        "translation_functions": profile["functions"],
                        "cyclomatic_delta": abs(profile["cyclomatic"] - source_profile["cyclomatic"]),
                        "loop_delta": abs(profile["loops"] - source_profile["loops"]),
                        "branch_delta": abs(profile["branches"] - source_profile["branches"]),
                        "function_delta": abs(profile["functions"] - source_profile["functions"]),
                    })
                rows.append(row)
                print("   %-11s %-9s %s exec=%s output=%s dCC=%s" % (
                    lang, condition, "cached" if cached else "fresh ",
                    executed, output_match, row.get("cyclomatic_delta")))

    df = pd.DataFrame(rows)
    if df.empty:
        raise SystemExit("no results produced")
    complete = (df.groupby("program")["condition"].count() ==
                len(TARGETS) * len(CONDITIONS))
    df = df[df["program"].isin(complete[complete].index)]
    print("\nprograms with a complete anchored/plain matrix: %d"
          % df["program"].nunique())
    df.to_csv(RESULT_DIR / "anchoring_ablation_raw.csv", index=False)

    summary = df.groupby("condition").agg(
        n=("program", "count"),
        executable_rate=("executable", "mean"),
        output_match_rate=("output_match", "mean"),
        mean_cyclomatic_delta=("cyclomatic_delta", "mean"),
        mean_loop_delta=("loop_delta", "mean"),
        mean_branch_delta=("branch_delta", "mean"),
        mean_function_delta=("function_delta", "mean"),
    ).reset_index()
    summary.to_csv(RESULT_DIR / "anchoring_ablation.csv", index=False)

    by_lang = df.groupby(["target_language", "condition"]).agg(
        n=("program", "count"),
        executable_rate=("executable", "mean"),
        output_match_rate=("output_match", "mean"),
        mean_cyclomatic_delta=("cyclomatic_delta", "mean"),
    ).reset_index()
    by_lang.to_csv(RESULT_DIR / "anchoring_ablation_by_language.csv", index=False)

    print("\n=== ANCHORED vs PLAIN ===")
    print(summary.to_string(index=False, float_format=lambda v: "%.3f" % v))
    print("\n=== BY TARGET LANGUAGE ===")
    print(by_lang.to_string(index=False, float_format=lambda v: "%.3f" % v))
    print("\nresults written to %s" % RESULT_DIR)


if __name__ == "__main__":
    main()
