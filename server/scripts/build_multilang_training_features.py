import csv
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]                
CAND_DIR = ROOT / "data" / "candidates"
FEAT_DIR = ROOT / "data" / "features"
FEAT_DIR.mkdir(parents=True, exist_ok=True)

LANG_FILES = {
    "cpp":        "cpp_candidates_labeled.csv",
    "python":     "python_candidates_labeled.csv",
    "java":       "java_candidates_labeled.csv",
    "javascript": "javascript_candidates_labeled.csv",
    "go":         "go_candidates_labeled.csv",
}

def count_ops(s: str) -> int:
    return sum(s.count(ch) for ch in "+-*/%<>=!&|")

def count_parens(s: str) -> int:
    return sum(s.count(ch) for ch in "()[]{}")

def num_tokens(s: str) -> int:
                                  
    return len(s.split())

def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    def extract(row):
        line = str(row["line"])
        reasons_str = str(row.get("reasons", ""))
        reasons = [r for r in reasons_str.split(";") if r]

        return {
            "has_for": int("for_loop" in reasons or "for" in line),
            "has_while": int("while_loop" in reasons or "while" in line),
            "has_if": int("if" in reasons or "else_if" in reasons or "if" in line),
            "has_else": int(line.strip().startswith("else")),
            "has_indexing": int("indexing" in reasons or ("[" in line and "]" in line)),
            "has_comparison": int(
                "comparison" in reasons
                or any(op in line for op in ["<=", ">=", "==", "!=", "<", ">"])
            ),
            "reason_count": len(reasons),
            "line_length": len(line),
            "num_ops": count_ops(line),
            "num_parens": count_parens(line),
            "num_tokens": num_tokens(line),
        }

    feat_df = df.apply(extract, axis=1, result_type="expand")
    df_full = pd.concat([df, feat_df], axis=1)
    return df_full

def main():
    for lang, filename in LANG_FILES.items():
        in_path = CAND_DIR / filename
        if not in_path.exists():
            print(f"[{lang}] skipping, not found: {in_path}")
            continue

        df = pd.read_csv(in_path)
        if df.empty:
            print(f"[{lang}] skipping, empty file: {in_path}")
            continue

        df_full = compute_features(df)
        out_path = FEAT_DIR / f"{lang}_training_features.csv"
        df_full.to_csv(out_path, index=False)
        print(f"[{lang}] wrote {len(df_full)} rows with features → {out_path}")

if __name__ == "__main__":
    main()
