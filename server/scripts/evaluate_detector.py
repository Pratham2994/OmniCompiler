"""Ablation and robustness evaluation of the hybrid language detector.

Three detection strategies are compared on identical inputs:

  regex_only    - lexical fingerprint scoring only, no fallback. Predicts the
                  highest scoring language, or plain when nothing matches.
  pygments_only - Pygments guess_lexer only, mapped onto the supported set.
  hybrid        - the shipped pipeline: fingerprints, plain-trap guards,
                  conflict tie-breaking, and Pygments fallback.

Three corpora are used:

  curated   - the hand-written regression suite, including adversarial
              negatives such as a bare Java import or a lone C++ template
              that must not be claimed as code.
  truncated - fragments derived from the curated code samples by removing
              file-level context (imports, includes, package and class
              headers) and by taking prefix, suffix and interior slices.
              This implements the truncation augmentation described in the
              methodology and simulates a user pasting part of a file.
  scaled    - curated samples repeated to roughly 25 KB. These probe
              behaviour on long inputs only; they are synthetic repetition,
              not natural long-form source, and every curated sample is
              under ten lines, so the corpus cannot support a genuine
              accuracy-by-length breakdown.

Truncation frequently destroys the evidence a language identity rests on, so
a fragment that can no longer be identified has no correct concrete answer.
Outcomes are therefore reported in three classes rather than as plain
accuracy:

  correct       - predicted the source language
  abstained     - predicted plain, declining to guess
  misidentified - predicted a different, wrong programming language

Misidentification is the operationally important failure: the detected
language selects the runtime container, so a wrong answer provisions the
wrong sandbox, whereas an abstention leaves the choice to the user.
"""

from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path
from typing import Dict, List

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from server.controller.detector import (
    _pygments_guess,
    _score_fingerprints,
    server_detect,
)
from server.test.eval_detector import (
    BASE_SAMPLES,
    HARD_NEGATIVES,
    bigify,
    make_req,
)

RESULT_DIR = ROOT / "data" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

CODE_LANGS = {"python", "javascript", "java", "cpp", "go"}

HEADER_PREFIXES = (
    "import ", "from ", "#include", "package ", "using ", "#!/",
    "public class", "class ", "const ", "let ", "var ",
)


def regex_only(code: str) -> str:
    scores = _score_fingerprints(code)
    if not scores:
        return "plain"
    top_lang = max(scores, key=lambda k: scores[k])
    return top_lang if scores[top_lang] > 0 else "plain"


def pygments_only(code: str) -> str:
    return _pygments_guess(code) or "plain"


def hybrid(code: str) -> str:
    """The shipped pipeline. Its request tracing is silenced during evaluation."""
    with contextlib.redirect_stdout(io.StringIO()):
        return server_detect(make_req(code)).get("lang", "plain")


METHODS = {
    "regex_only": regex_only,
    "pygments_only": pygments_only,
    "hybrid": hybrid,
}


def loc(code: str) -> int:
    return len([ln for ln in code.splitlines() if ln.strip()])


def truncate_variants(code: str) -> List[str]:
    """Fragments produced by removing file-level context and slicing."""
    lines = [ln for ln in code.splitlines() if ln.strip()]
    out: List[str] = []

    stripped = [ln for ln in lines
                if not ln.strip().lower().startswith(HEADER_PREFIXES)]
    if stripped and len(stripped) != len(lines):
        out.append("\n".join(stripped) + "\n")

    n = len(lines)
    for k in range(1, n):
        out.append("\n".join(lines[:k]) + "\n")
        out.append("\n".join(lines[k:]) + "\n")
    if n >= 3:
        out.append("\n".join(lines[1:-1]) + "\n")

    seen = set()
    unique = []
    for frag in out:
        key = frag.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(frag)
    return unique


def build_corpora():
    curated = [dict(c) for c in BASE_SAMPLES + HARD_NEGATIVES]

    truncated = []
    for case in BASE_SAMPLES:
        if case["lang"] not in CODE_LANGS:
            continue
        for idx, frag in enumerate(truncate_variants(case["code"])):
            truncated.append({
                "name": "%s_trunc%d" % (case["name"], idx),
                "lang": case["lang"],
                "code": frag,
            })

    scaled = [{"name": c["name"] + "_scaled", "lang": c["lang"],
               "code": bigify(c["code"], 25000)}
              for c in BASE_SAMPLES]
    return curated, truncated, scaled


def classify(expected: str, predicted: str) -> str:
    if predicted == expected:
        return "correct"
    if predicted == "plain":
        return "abstained"
    return "misidentified"


def run(cases: List[Dict], corpus_name: str) -> pd.DataFrame:
    rows = []
    for method_name, fn in METHODS.items():
        for case in cases:
            predicted = fn(case["code"])
            rows.append({
                "corpus": corpus_name,
                "method": method_name,
                "case": case["name"],
                "language": case["lang"],
                "loc": loc(case["code"]),
                "predicted": predicted,
                "outcome": classify(case["lang"], predicted),
            })
    return pd.DataFrame(rows)


def aggregate(df: pd.DataFrame, by: List[str]) -> pd.DataFrame:
    grouped = df.groupby(by, dropna=False)
    out = grouped["outcome"].value_counts().unstack(fill_value=0)
    for col in ("correct", "abstained", "misidentified"):
        if col not in out.columns:
            out[col] = 0
    out["n"] = out[["correct", "abstained", "misidentified"]].sum(axis=1)
    out["accuracy"] = out["correct"] / out["n"]
    out["abstention_rate"] = out["abstained"] / out["n"]
    out["misidentification_rate"] = out["misidentified"] / out["n"]
    return out.reset_index()[
        by + ["n", "correct", "abstained", "misidentified",
              "accuracy", "abstention_rate", "misidentification_rate"]]


def loc_bucket(value: int) -> str:
    if value < 10:
        return "< 10 LOC"
    if value <= 50:
        return "10-50 LOC"
    return "> 50 LOC"


def main() -> None:
    curated, truncated, scaled = build_corpora()
    print("curated cases   : %d" % len(curated))
    print("truncated cases : %d" % len(truncated))
    print("scaled cases    : %d  (repeated to ~25 KB to probe length robustness)"
          % len(scaled))

    df = pd.concat([run(curated, "curated"),
                    run(truncated, "truncated"),
                    run(scaled, "scaled")],
                   ignore_index=True)
    df["loc_bucket"] = df["loc"].map(loc_bucket)
    df.to_csv(RESULT_DIR / "detector_predictions.csv", index=False)

    overall = aggregate(df, ["corpus", "method"])
    overall.to_csv(RESULT_DIR / "detector_ablation.csv", index=False)
    print("\n=== ABLATION BY CORPUS ===")
    print(overall.to_string(index=False, float_format=lambda v: "%.3f" % v))

    by_lang = aggregate(df[df["corpus"] == "curated"], ["method", "language"])
    by_lang.to_csv(RESULT_DIR / "detector_by_language.csv", index=False)
    print("\n=== CURATED, BY LANGUAGE ===")
    print(by_lang.to_string(index=False, float_format=lambda v: "%.3f" % v))

    by_loc = aggregate(df, ["method", "loc_bucket"])
    by_loc.to_csv(RESULT_DIR / "detector_by_loc.csv", index=False)
    print("\n=== BY SNIPPET LENGTH ===")
    print(by_loc.to_string(index=False, float_format=lambda v: "%.3f" % v))

    print("\nresults written to %s" % RESULT_DIR)


if __name__ == "__main__":
    main()
