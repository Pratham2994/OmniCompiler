import re
import argparse
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "data" / "model" / "java_breakpoint_model.pkl"

PATTERNS = {
    "for_loop": re.compile(r"^\s*for\s*\("),
    "while_loop": re.compile(r"^\s*while\s*\("),
    "if": re.compile(r"^\s*if\s*\("),
    "else_if": re.compile(r"^\s*else\s+if\s*\("),
    "else": re.compile(r"^\s*else\s*(\{|$)"),
    "indexing": re.compile(r"\w+\s*\[[^\]]+\]"),
    "comparison": re.compile(r"<=|>=|==|!=|<|>"),
}

FEATURE_COLS = [
    "has_for", "has_while", "has_if", "has_else",
    "has_indexing", "has_comparison",
    "reason_count", "line_length",
    "num_ops", "num_parens", "num_tokens",
]

def find_reasons(line: str):
    return [name for name, pat in PATTERNS.items() if pat.search(line)]

def count_ops(s: str) -> int:
    return sum(s.count(ch) for ch in "+-*/%<>=!&|")

def count_parens(s: str) -> int:
    return sum(s.count(ch) for ch in "()[]{}")

def num_tokens(s: str) -> int:
    return len(s.split())

def extract_features_from_line(line: str, reasons_str: str):
    reasons = [r for r in reasons_str.split(";") if r]
    return {
        "has_for": int("for_loop" in reasons or "for" in line),
        "has_while": int("while_loop" in reasons or "while" in line),
        "has_if": int("if" in reasons or "else_if" in reasons or "if" in line),
        "has_else": int(line.strip().startswith("else")),
        "has_indexing": int("indexing" in reasons or ("[" in line and "]" in line)),
        "has_comparison": int(
            "comparison" in reasons or any(op in line for op in ["<=", ">=", "==", "!=", "<", ">"])
        ),
        "reason_count": len(reasons),
        "line_length": len(line),
        "num_ops": count_ops(line),
        "num_parens": count_parens(line),
        "num_tokens": num_tokens(line),
    }

def select_k_from_scores(scores, base_threshold=0.5, min_k=2, max_k=256):
    n = len(scores)
    if n == 0:
        return 0
    k = sum(score >= base_threshold for score in scores)
    if k < min_k:
        k = min(min_k, n)
    elif k > max_k:
        k = max_k
    return k

def predict_breakpoints(java_path: Path):
    model = joblib.load(MODEL_PATH)

    candidates = []
    with java_path.open("r", encoding="utf-8") as f:
        for i, raw_line in enumerate(f, start=1):
            line = raw_line.rstrip("\n")
            reasons = find_reasons(line)
            if not reasons:
                continue
            reasons_str = ";".join(reasons)
            feats = extract_features_from_line(line, reasons_str)
            candidates.append({
                "line_no": i,
                "line": line.strip(),
                "reasons": reasons_str,
                **feats,
            })

    if not candidates:
        print("No candidate lines found.")
        return

    df = pd.DataFrame(candidates)
    X = df[FEATURE_COLS]
    probs = model.predict_proba(X)[:, 1]
    df["score"] = probs

    df_sorted = df.sort_values("score", ascending=False)
    scores_sorted = df_sorted["score"].tolist()
    k = select_k_from_scores(scores_sorted, base_threshold=0.5, min_k=2, max_k=256)

    if k == 0:
        print(f"\nNo confident breakpoints found for {java_path.name}.\n")
        return

    df_top = df_sorted.head(k)

    print(f"\nAuto-breakpoints for {java_path.name} (k={k}):\n")
    for _, row in df_top.iterrows():
        print(f"• line {int(row['line_no']):>3}  |  score={row['score']:.3f}")
        print(f"   {row['line']}")
        print(f"   reasons: {row['reasons']}\n")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="Path to Java source file")
    args = parser.parse_args()

    java_path = Path(args.file)
    if not java_path.exists():
        raise SystemExit(f"File not found: {java_path}")

    predict_breakpoints(java_path)

if __name__ == "__main__":
    main()
