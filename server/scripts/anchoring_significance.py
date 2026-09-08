"""Hypothesis tests for the CFG-anchoring comparison.

The comparison is paired: each program and target language is translated once
with the structural summary and once without, so every observation has a
matched counterpart differing in exactly one factor.

Two tests are reported per model:

  McNemar (exact)  on the binary output-correctness outcome. Only discordant
                   pairs carry information, so the exact binomial form is used
                   rather than the chi-square approximation, which is not
                   valid at these counts.
  Wilcoxon         on the paired structural distance, measured as the absolute
                   difference in total cyclomatic complexity between the
                   translation and its source.

A Wilson score interval is also given for the difference in output-correctness
rates, so the result can be read as a bound on the effect rather than only as
a failure to reject.
"""

from __future__ import annotations

import math
from pathlib import Path

import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
RESULT_DIR = ROOT / "data" / "results"

ARMS = [
    ("gemini-3.6-flash", "anchoring_ablation_raw.csv"),
    ("gemini-3.5-flash-lite", "anchoring_ablation_raw_lite.csv"),
]


def wilson(successes: int, total: int, z: float = 1.96):
    if total == 0:
        return (float("nan"), float("nan"))
    p = successes / total
    d = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / d
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return (centre - half, centre + half)


rows = []
for model, filename in ARMS:
    path = RESULT_DIR / filename
    if not path.exists():
        print("missing: %s" % path)
        continue
    df = pd.read_csv(path)

    correct = df.pivot_table(index=["program", "target_language"],
                             columns="condition", values="output_match")
    b = int(((correct["anchored"] == 1) & (correct["plain"] == 0)).sum())
    c = int(((correct["anchored"] == 0) & (correct["plain"] == 1)).sum())
    n_pairs = len(correct)

    if b + c == 0:
        p_mcnemar = 1.0
    else:
        p_mcnemar = min(1.0, 2.0 * stats.binom.cdf(min(b, c), b + c, 0.5))

    a_rate = float(correct["anchored"].mean())
    p_rate = float(correct["plain"].mean())
    lo_a, hi_a = wilson(int(correct["anchored"].sum()), n_pairs)
    lo_p, hi_p = wilson(int(correct["plain"].sum()), n_pairs)

    dist = df.pivot_table(index=["program", "target_language"],
                          columns="condition", values="cyclomatic_delta")
    diff = (dist["plain"] - dist["anchored"]).dropna()
    nonzero = diff[diff != 0]
    if len(nonzero) >= 1:
        try:
            _, p_wilcoxon = stats.wilcoxon(dist["anchored"], dist["plain"],
                                           zero_method="wilcox")
        except ValueError:
            p_wilcoxon = 1.0
    else:
        p_wilcoxon = 1.0

    rows.append({
        "model": model,
        "pairs": n_pairs,
        "anchored_correct": int(correct["anchored"].sum()),
        "plain_correct": int(correct["plain"].sum()),
        "discordant_anchored_only": b,
        "discordant_plain_only": c,
        "mcnemar_exact_p": p_mcnemar,
        "anchored_rate": a_rate,
        "anchored_ci_low": lo_a, "anchored_ci_high": hi_a,
        "plain_rate": p_rate,
        "plain_ci_low": lo_p, "plain_ci_high": hi_p,
        "structural_tied_pairs": int((diff == 0).sum()),
        "wilcoxon_p": p_wilcoxon,
    })

out = pd.DataFrame(rows)
out.to_csv(RESULT_DIR / "anchoring_significance.csv", index=False)

pd.set_option("display.width", 200)
print("=== PAIRED SIGNIFICANCE TESTS ===")
for r in rows:
    print("\n%s  (%d matched pairs)" % (r["model"], r["pairs"]))
    print("  output correct      : anchored %d/%d [%.3f, %.3f]   plain %d/%d [%.3f, %.3f]"
          % (r["anchored_correct"], r["pairs"], r["anchored_ci_low"], r["anchored_ci_high"],
             r["plain_correct"], r["pairs"], r["plain_ci_low"], r["plain_ci_high"]))
    print("  discordant pairs    : anchored-only %d, plain-only %d"
          % (r["discordant_anchored_only"], r["discordant_plain_only"]))
    print("  McNemar exact       : p = %.3f" % r["mcnemar_exact_p"])
    print("  structural tied     : %d/%d pairs" % (r["structural_tied_pairs"], r["pairs"]))
    print("  Wilcoxon signed-rank: p = %.3f" % r["wilcoxon_p"])
print("\nresults written to %s" % (RESULT_DIR / "anchoring_significance.csv"))
