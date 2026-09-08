"""External validation of the control-flow graph's complexity metric.

The graph builder computes cyclomatic complexity as M = E - V + 2P over each
function's own subgraph. Checking that against the decision-point count is
useful but self-referential: both numbers come from the same extractor.

This script compares the metric against lizard, an established multi-language
complexity analyser that parses each language directly rather than reusing
this project's regex-based extraction. Agreement with an independent
implementation is evidence that the graph is a faithful control-flow
representation and not merely internally consistent.

Functions are matched between the two tools by name within a file. Functions
that only one tool reports are counted separately, since the extractor here
is regex-based and does not recognise every declaration form (JavaScript
arrow functions assigned to constants, for example).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List

import lizard
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from server.routes.cfg_routes import (  # noqa: E402
    _collect_nodes_from_text,
    build_cfg_edges,
)

RESULT_DIR = ROOT / "data" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

EXT_LANG = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".java": "java",
    ".cpp": "cpp",
    ".go": "go",
}

SKIP_PARTS = {".venv", "node_modules", ".git", "dist", "results", "translations"}
MAX_BYTES = 400_000


def clean_name(raw: str) -> str:
    """Reduce a label from either tool to a bare function name."""
    name = str(raw or "")
    if ":" in name:
        name = name.split(":", 1)[1]
    name = name.strip()
    if "::" in name:
        name = name.rsplit("::", 1)[1]
    return name.strip()


def our_functions(code: str, lang: str, name: str) -> Dict[str, Dict[str, int]]:
    nodes, _ = _collect_nodes_from_text(code, lang, name)
    if not nodes:
        return {}
    _edges, _synth, metrics = build_cfg_edges(nodes, sources={name: code})
    out: Dict[str, Dict[str, int]] = {}
    for fn in metrics.get("functions", []):
        key = clean_name(fn["function"])
        if key and key not in out:
            out[key] = {
                "graph": fn["cyclomatic"],
                "extended": fn.get("cyclomatic_extended", fn["cyclomatic"]),
            }
    return out


def lizard_functions(path: Path) -> Dict[str, int]:
    try:
        analysis = lizard.analyze_file(str(path))
    except Exception:
        return {}
    out: Dict[str, int] = {}
    for fn in analysis.function_list:
        key = clean_name(fn.name)
        if key and key not in out:
            out[key] = fn.cyclomatic_complexity
    return out


def main() -> None:
    rows: List[Dict] = []
    for path in sorted(REPO.rglob("*")):
        if not path.is_file() or SKIP_PARTS & set(path.parts):
            continue
        lang = EXT_LANG.get(path.suffix.lower())
        if not lang:
            continue
        try:
            code = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if len(code) > MAX_BYTES:
            continue

        ours = our_functions(code, lang, path.name)
        theirs = lizard_functions(path)
        if not ours and not theirs:
            continue

        for name in sorted(set(ours) | set(theirs)):
            mine = ours.get(name)
            rows.append({
                "file": str(path.relative_to(REPO)).replace("\\", "/"),
                "language": lang,
                "function": name,
                "sacld": mine["graph"] if mine else None,
                "sacld_extended": mine["extended"] if mine else None,
                "lizard": theirs.get(name),
            })

    df = pd.DataFrame(rows)
    df["matched"] = df["sacld"].notna() & df["lizard"].notna()
    df.to_csv(RESULT_DIR / "cyclomatic_validation_raw.csv", index=False)

    both = df[df["matched"]].copy()
    both["delta"] = both["sacld_extended"] - both["lizard"]
    both["abs_delta"] = both["delta"].abs()
    both["abs_delta_graph"] = (both["sacld"] - both["lizard"]).abs()

    def band(v: float) -> str:
        if v == 0:
            return "exact"
        if v <= 1:
            return "within 1"
        if v <= 2:
            return "within 2"
        return "off by 3+"

    both["agreement"] = both["abs_delta"].map(band)

    overall = {
        "metric": "cyclomatic_extended (graph M plus short-circuit operators)",
        "functions_compared": len(both),
        "only_in_sacld": int((df["sacld"].notna() & df["lizard"].isna()).sum()),
        "only_in_lizard": int((df["sacld"].isna() & df["lizard"].notna()).sum()),
        "exact_agreement": float((both["abs_delta"] == 0).mean()),
        "within_1": float((both["abs_delta"] <= 1).mean()),
        "within_2": float((both["abs_delta"] <= 2).mean()),
        "mean_abs_delta": float(both["abs_delta"].mean()),
        "median_abs_delta": float(both["abs_delta"].median()),
        "pearson_r": float(both["sacld_extended"].corr(both["lizard"])),
        "spearman_r": float(both["sacld_extended"].corr(both["lizard"], method="spearman")),
        "mean_sacld_extended": float(both["sacld_extended"].mean()),
        "mean_lizard": float(both["lizard"].mean()),
        "graph_only_exact_agreement": float((both["abs_delta_graph"] == 0).mean()),
        "graph_only_within_1": float((both["abs_delta_graph"] <= 1).mean()),
        "graph_only_pearson_r": float(both["sacld"].corr(both["lizard"])),
        "graph_only_mean": float(both["sacld"].mean()),
    }
    pd.DataFrame([overall]).to_csv(RESULT_DIR / "cyclomatic_validation.csv", index=False)

    by_lang = both.groupby("language").agg(
        functions=("function", "count"),
        exact_agreement=("abs_delta", lambda s: float((s == 0).mean())),
        within_1=("abs_delta", lambda s: float((s <= 1).mean())),
        mean_abs_delta=("abs_delta", "mean"),
        pearson_r=("sacld_extended", lambda s: float(s.corr(both.loc[s.index, "lizard"]))),
    ).reset_index()
    by_lang.to_csv(RESULT_DIR / "cyclomatic_validation_by_language.csv", index=False)

    print("=== CYCLOMATIC COMPLEXITY vs LIZARD ===")
    for key, value in overall.items():
        if isinstance(value, float):
            print("  %-26s %.3f" % (key, value))
        elif isinstance(value, int):
            print("  %-26s %d" % (key, value))
        else:
            print("  %-26s %s" % (key, value))
    print()
    print("=== BY LANGUAGE ===")
    print(by_lang.to_string(index=False, float_format=lambda v: "%.3f" % v))
    print()
    print("=== AGREEMENT DISTRIBUTION ===")
    dist = both["agreement"].value_counts().reindex(
        ["exact", "within 1", "within 2", "off by 3+"], fill_value=0)
    for label, count in dist.items():
        print("  %-12s %4d  (%.1f%%)" % (label, count, 100.0 * count / max(len(both), 1)))
    print()
    print("results written to %s" % RESULT_DIR)


if __name__ == "__main__":
    main()
