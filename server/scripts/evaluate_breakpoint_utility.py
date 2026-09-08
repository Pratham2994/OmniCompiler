"""Non-circular evaluation of the breakpoint recommender.

The training labels are derived from the same regular expressions that most
features encode, so accuracy against those labels cannot demonstrate that a
recommendation is useful. This script sidesteps the labels entirely and
evaluates against execution instead.

Each benchmark program is executed under a line tracer that records which
source lines ran and how many times. The recommender is then asked for the
breakpoints it would set, and those are judged against that record:

  reached      - a breakpoint on a line that never executes is dead weight,
                 because the debugger will never stop there.
  hot          - a breakpoint inside a loop observes many more states than
                 one on a line that runs once, so mean execution count of the
                 selected lines measures how informative the stop is.
  ordering     - the recommender ranks candidates by score and takes the top
                 k. Comparing the top k against a random k drawn from the
                 same candidate pool isolates the contribution of the ranking
                 from the contribution of the candidate filter.

Two baselines are reported alongside, because a hit rate means nothing on its
own: random selection from the candidate pool, and the reachability of every
non-blank line in the file.
"""

from __future__ import annotations

import importlib.util
import statistics
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List, Set

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

BENCH_DIR = ROOT / "data" / "translation_bench"
RESULT_DIR = ROOT / "data" / "results"
MODEL_PATH = ROOT / "data" / "model" / "python_breakpoint_model.pkl"
PREDICTOR = ROOT / "scripts" / "python" / "predict_python_breakpoints.py"
RESULT_DIR.mkdir(parents=True, exist_ok=True)


def load_predictor():
    spec = importlib.util.spec_from_file_location("oc_predictor", PREDICTOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def trace_execution(path: Path) -> Counter:
    """Execution count per line of one program, collected with a line tracer."""
    counts: Counter = Counter()
    target = str(path.resolve())
    source = path.read_text(encoding="utf-8")
    code = compile(source, target, "exec")

    def tracer(frame, event, arg):
        if frame.f_code.co_filename == target and event == "line":
            counts[frame.f_lineno] += 1
        return tracer

    globals_dict = {"__name__": "__main__", "__file__": target}
    stdout = sys.stdout
    sys.stdout = open(Path(__file__).parent / "_trace_sink.tmp", "w", encoding="utf-8")
    sys.settrace(tracer)
    try:
        exec(code, globals_dict)
    finally:
        sys.settrace(None)
        sys.stdout.close()
        sys.stdout = stdout
        sink = Path(__file__).parent / "_trace_sink.tmp"
        if sink.exists():
            sink.unlink()
    return counts


def candidate_lines(module, path: Path) -> List[Dict]:
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for number, raw in enumerate(handle, start=1):
            line = raw.rstrip("\n")
            reasons = module.find_reasons(line)
            if not reasons:
                continue
            reasons_str = ";".join(reasons)
            feats = module.extract_features_from_line(line, reasons_str)
            rows.append({"line_no": number, "line": line.strip(),
                         "reasons": reasons_str, **feats})
    return rows


def main() -> None:
    module = load_predictor()
    model = joblib.load(MODEL_PATH)

    programs = sorted(BENCH_DIR.glob("*.py"))
    if not programs:
        raise SystemExit("no benchmark programs found in %s" % BENCH_DIR)

    rows = []
    for path in programs:
        executed = trace_execution(path)
        executed_lines: Set[int] = set(executed)

        source_lines = path.read_text(encoding="utf-8").splitlines()
        non_blank = [i + 1 for i, l in enumerate(source_lines) if l.strip()]
        reachable_all = sum(1 for n in non_blank if n in executed_lines) / max(len(non_blank), 1)

        candidates = candidate_lines(module, path)
        if not candidates:
            continue
        frame = pd.DataFrame(candidates)
        scores = model.predict_proba(frame[module.FEATURE_COLS])[:, 1]
        frame["score"] = scores

        ordered = frame.sort_values("score", ascending=False)
        k = module.select_k_from_scores(ordered["score"].tolist(),
                                        base_threshold=0.5, min_k=2, max_k=256)
        selected = ordered.head(k)

        selected_lines = list(selected["line_no"])
        hit = [n for n in selected_lines if n in executed_lines]
        candidate_reach = sum(1 for n in frame["line_no"] if n in executed_lines) / len(frame)

        selected_counts = [executed.get(n, 0) for n in selected_lines]
        all_candidate_counts = [executed.get(n, 0) for n in frame["line_no"]]

        rows.append({
            "program": path.stem,
            "source_lines": len(non_blank),
            "executed_lines": len(executed_lines & set(non_blank)),
            "candidates": len(frame),
            "recommended": len(selected_lines),
            "recommended_reached": len(hit),
            "recommended_reach_rate": len(hit) / max(len(selected_lines), 1),
            "random_candidate_baseline": candidate_reach,
            "all_line_baseline": reachable_all,
            "mean_exec_count_recommended": statistics.mean(selected_counts) if selected_counts else 0.0,
            "mean_exec_count_candidates": statistics.mean(all_candidate_counts) if all_candidate_counts else 0.0,
            "max_exec_count_recommended": max(selected_counts) if selected_counts else 0,
        })

    df = pd.DataFrame(rows)
    df.to_csv(RESULT_DIR / "breakpoint_utility_raw.csv", index=False)

    summary = {
        "programs": len(df),
        "total_recommended": int(df["recommended"].sum()),
        "recommended_reach_rate": float(df["recommended_reached"].sum() / max(df["recommended"].sum(), 1)),
        "random_candidate_baseline": float(df["random_candidate_baseline"].mean()),
        "all_line_baseline": float(df["all_line_baseline"].mean()),
        "mean_exec_count_recommended": float(df["mean_exec_count_recommended"].mean()),
        "mean_exec_count_candidates": float(df["mean_exec_count_candidates"].mean()),
        "programs_with_all_breakpoints_reached": int((df["recommended_reach_rate"] == 1.0).sum()),
    }
    summary["hot_line_ratio"] = (
        summary["mean_exec_count_recommended"] / summary["mean_exec_count_candidates"]
        if summary["mean_exec_count_candidates"] else float("nan"))
    pd.DataFrame([summary]).to_csv(RESULT_DIR / "breakpoint_utility.csv", index=False)

    print("=== BREAKPOINT UTILITY AGAINST EXECUTION ===")
    print(df.to_string(index=False, float_format=lambda v: "%.3f" % v))
    print()
    for key, value in summary.items():
        if isinstance(value, float):
            print("  %-38s %.3f" % (key, value))
        else:
            print("  %-38s %d" % (key, value))
    print()
    print("results written to %s" % RESULT_DIR)


if __name__ == "__main__":
    main()
