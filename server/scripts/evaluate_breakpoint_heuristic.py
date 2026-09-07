"""Evaluation of the breakpoint recommendation component.

The shipped pipeline derives the is_good_breakpoint label from the `reasons`
field (see label_multilang_candidates.py) and derives most model features from
that same field (see build_multilang_training_features.py). The label is
therefore a deterministic function of part of the input, and any classifier
trained on the full feature set reproduces it almost exactly. Reporting that
accuracy as a predictive result would be misleading.

This script measures the component honestly:

  1. dataset_summary      - corpus shape, label balance, and a direct test of
                            whether the label is determined by `reasons`.
  2. model_selection      - RF, Naive Bayes and SVM under grouped
                            leave-file-out cross-validation, on two feature
                            sets: LEAKY (all 11 shipped features, which encode
                            the labelling rule) and LEAK_FREE (four purely
                            lexical counts that carry no information about the
                            labelling rule). The gap between the two is the
                            measurement of interest.
  3. cross_language       - the corpus is parallel: the same 15 problems are
                            implemented in all five languages. This measures
                            whether the recommender surfaces the same kinds of
                            structural locations for the same algorithm across
                            languages.
  4. inference_latency    - per-line scoring cost of the deployed model.

Outputs go to server/data/results/ and are committed so that every number in
the paper can be regenerated from the repository.
"""

from __future__ import annotations

import json
import re
import time
from itertools import combinations
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.model_selection import GroupKFold
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

ROOT = Path(__file__).resolve().parents[1]
FEAT_DIR = ROOT / "data" / "features"
RESULT_DIR = ROOT / "data" / "results"
RESULT_DIR.mkdir(parents=True, exist_ok=True)

LANGUAGES = ["cpp", "go", "java", "javascript", "python"]

LEAKY_FEATURES = [
    "has_for", "has_while", "has_if", "has_else",
    "has_indexing", "has_comparison",
    "reason_count", "line_length",
    "num_ops", "num_parens", "num_tokens",
]

LEAK_FREE_FEATURES = ["line_length", "num_ops", "num_parens", "num_tokens"]

FEATURE_SETS = {
    "LEAKY (11 shipped)": LEAKY_FEATURES,
    "LEAK_FREE (4 lexical)": LEAK_FREE_FEATURES,
}

RANDOM_STATE = 42
N_SPLITS = 5


def load_language(lang: str) -> pd.DataFrame:
    path = FEAT_DIR / f"{lang}_training_features.csv"
    df = pd.read_csv(path)
    df["language"] = lang
    return df


def load_all() -> pd.DataFrame:
    return pd.concat([load_language(l) for l in LANGUAGES], ignore_index=True)


def problem_key(file_name: str) -> str:
    """Normalise a filename to its problem identity across languages.

    two_sum.py, TwoSum.java and two_sum.cpp all map to "twosum".
    """
    stem = re.sub(r"\.[^.]+$", "", str(file_name))
    return re.sub(r"[^a-z0-9]", "", stem.lower())


def make_models() -> Dict[str, object]:
    return {
        "Random Forest": RandomForestClassifier(
            n_estimators=200, random_state=RANDOM_STATE),
        "Naive Bayes": GaussianNB(),
        "SVM (RBF)": Pipeline([
            ("scale", StandardScaler()),
            ("svc", SVC(kernel="rbf", random_state=RANDOM_STATE)),
        ]),
    }


def grouped_oof_predictions(X, y, groups, model_factory) -> np.ndarray:
    """Out-of-fold predictions under leave-file-out grouped CV."""
    n_groups = len(np.unique(groups))
    splits = min(N_SPLITS, n_groups)
    cv = GroupKFold(n_splits=splits)
    oof = np.zeros(len(y), dtype=int)
    for train_idx, test_idx in cv.split(X, y, groups):
        model = model_factory()
        model.fit(X[train_idx], y[train_idx])
        oof[test_idx] = model.predict(X[test_idx])
    return oof


def score(y_true, y_pred) -> Dict[str, float]:
    return {
        "accuracy": accuracy_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "recall": recall_score(y_true, y_pred, zero_division=0),
        "f1": f1_score(y_true, y_pred, zero_division=0),
    }


def rule_label(reasons_value: str) -> int:
    """The labelling rule from label_multilang_candidates.py, verbatim."""
    reasons = [r.strip() for r in str(reasons_value).split(";") if r.strip()]
    if any(r in reasons for r in ["for_loop", "while_loop", "if", "else_if", "elif"]):
        return 1
    if "indexing" in reasons and "comparison" in reasons:
        return 1
    return 0


def write_dataset_summary(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for lang in LANGUAGES:
        sub = df[df["language"] == lang]
        conflicts = sub.groupby("reasons")["is_good_breakpoint"].nunique()
        rule_pred = sub["reasons"].map(rule_label)
        rows.append({
            "language": lang,
            "files": sub["file"].nunique(),
            "annotated_lines": len(sub),
            "positive": int(sub["is_good_breakpoint"].sum()),
            "negative": int((sub["is_good_breakpoint"] == 0).sum()),
            "distinct_reason_patterns": int(sub["reasons"].nunique()),
            "reason_patterns_with_conflicting_labels": int((conflicts > 1).sum()),
            "label_reproduced_by_rule": float((rule_pred == sub["is_good_breakpoint"]).mean()),
        })
    sub = df
    conflicts = sub.groupby("reasons")["is_good_breakpoint"].nunique()
    rule_pred = sub["reasons"].map(rule_label)
    rows.append({
        "language": "POOLED",
        "files": sub["file"].nunique(),
        "annotated_lines": len(sub),
        "positive": int(sub["is_good_breakpoint"].sum()),
        "negative": int((sub["is_good_breakpoint"] == 0).sum()),
        "distinct_reason_patterns": int(sub["reasons"].nunique()),
        "reason_patterns_with_conflicting_labels": int((conflicts > 1).sum()),
        "label_reproduced_by_rule": float((rule_pred == sub["is_good_breakpoint"]).mean()),
    })
    out = pd.DataFrame(rows)
    out.to_csv(RESULT_DIR / "dataset_summary.csv", index=False)
    return out


def write_model_selection(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    scopes: List[Tuple[str, pd.DataFrame]] = [(l, df[df["language"] == l]) for l in LANGUAGES]
    scopes.append(("POOLED", df))

    for scope_name, sub in scopes:
        y = sub["is_good_breakpoint"].to_numpy()
        groups = sub["file"].to_numpy()

        rule_pred = sub["reasons"].map(rule_label).to_numpy()
        rows.append({
            "scope": scope_name, "feature_set": "n/a",
            "model": "Labelling rule (reference)", "n": len(sub), **score(y, rule_pred)})

        for set_name, cols in FEATURE_SETS.items():
            X = sub[cols].to_numpy(dtype=float)
            for model_name, _ in make_models().items():
                def factory(name=model_name):
                    return make_models()[name]
                pred = grouped_oof_predictions(X, y, groups, factory)
                rows.append({
                    "scope": scope_name, "feature_set": set_name,
                    "model": model_name, "n": len(sub), **score(y, pred)})

    out = pd.DataFrame(rows)
    out = out[["scope", "feature_set", "model", "n", "accuracy", "precision", "recall", "f1"]]
    out.to_csv(RESULT_DIR / "model_selection.csv", index=False)
    return out


def write_cross_language(df: pd.DataFrame) -> pd.DataFrame:
    """Agreement on the kinds of location flagged, across implementations."""
    df = df.copy()
    df["problem"] = df["file"].map(problem_key)

    def reason_categories(sub: pd.DataFrame) -> set:
        cats = set()
        for value in sub.loc[sub["is_good_breakpoint"] == 1, "reasons"]:
            for r in str(value).split(";"):
                r = r.strip()
                if r:
                    cats.add(r)
        return cats

    rows = []
    for problem, group in df.groupby("problem"):
        per_lang = {}
        for lang in LANGUAGES:
            sub = group[group["language"] == lang]
            if len(sub):
                per_lang[lang] = reason_categories(sub)
        if len(per_lang) < 2:
            continue
        sims = []
        for a, b in combinations(sorted(per_lang), 2):
            sa, sb = per_lang[a], per_lang[b]
            union = sa | sb
            sims.append(len(sa & sb) / len(union) if union else 1.0)
        rows.append({
            "problem": problem,
            "languages_present": len(per_lang),
            "mean_pairwise_jaccard": float(np.mean(sims)),
            "min_pairwise_jaccard": float(np.min(sims)),
            "flagged_categories_union": len(set().union(*per_lang.values())),
        })

    out = pd.DataFrame(rows).sort_values("problem").reset_index(drop=True)
    out.to_csv(RESULT_DIR / "cross_language_consistency.csv", index=False)
    return out


def write_latency(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for lang in LANGUAGES:
        sub = df[df["language"] == lang]
        X = sub[LEAKY_FEATURES].to_numpy(dtype=float)
        y = sub["is_good_breakpoint"].to_numpy()
        model = RandomForestClassifier(n_estimators=200, random_state=RANDOM_STATE)
        model.fit(X, y)

        model.predict_proba(X[:1])
        reps = 50
        start = time.perf_counter()
        for _ in range(reps):
            model.predict_proba(X)
        elapsed = time.perf_counter() - start

        rows.append({
            "language": lang,
            "candidate_lines": len(sub),
            "ms_per_batch": 1000.0 * elapsed / reps,
            "us_per_line": 1e6 * elapsed / (reps * max(len(sub), 1)),
        })
    out = pd.DataFrame(rows)
    out.to_csv(RESULT_DIR / "inference_latency.csv", index=False)
    return out


def main() -> None:
    df = load_all()

    summary = write_dataset_summary(df)
    print("\n=== DATASET SUMMARY ===")
    print(summary.to_string(index=False))

    models = write_model_selection(df)
    print("\n=== MODEL SELECTION (leave-file-out grouped CV) ===")
    print(models.to_string(index=False, float_format=lambda v: f"{v:.3f}"))

    cross = write_cross_language(df)
    print("\n=== CROSS-LANGUAGE CONSISTENCY (parallel corpus) ===")
    print(cross.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print(f"\nmean over {len(cross)} problems: "
          f"{cross['mean_pairwise_jaccard'].mean():.3f}")

    latency = write_latency(df)
    print("\n=== INFERENCE LATENCY ===")
    print(latency.to_string(index=False, float_format=lambda v: f"{v:.3f}"))

    print(f"\nresults written to {RESULT_DIR}")


if __name__ == "__main__":
    main()
