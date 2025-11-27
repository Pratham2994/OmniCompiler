import pandas as pd
from pathlib import Path

# ROOT = /.../OmniCompiler/server
ROOT = Path(__file__).resolve().parents[1]
CAND_DIR = ROOT / "data" / "candidates"

LANG_FILES = {
    "cpp":        "cpp_candidates.csv",
    "python":     "python_candidates.csv",
    "java":       "java_candidates.csv",
    "javascript": "javascript_candidates.csv",
    "go":         "go_candidates.csv",
}

def auto_label(df: pd.DataFrame) -> pd.DataFrame:
    def label_row(row):
        reasons = str(row.get("reasons", "")).split(";")
        reasons = [r.strip() for r in reasons if r.strip()]

        # Positive if it's a loop or conditional
        if any(r in reasons for r in ["for_loop", "while_loop", "if", "else_if", "elif"]):
            return 1

        # Positive if indexing + comparison appear together
        if "indexing" in reasons and "comparison" in reasons:
            return 1

        # Otherwise not a good breakpoint
        return 0

    df = df.copy()
    df["is_good_breakpoint"] = df.apply(label_row, axis=1)
    return df

def main():
    for lang, filename in LANG_FILES.items():
        path = CAND_DIR / filename
        if not path.exists():
            print(f"[{lang}] skipping, file not found: {path}")
            continue

        df = pd.read_csv(path)
        if df.empty:
            print(f"[{lang}] file exists but is empty: {path}")
            continue

        df_labeled = auto_label(df)
        out_path = CAND_DIR / f"{lang}_candidates_labeled.csv"
        df_labeled.to_csv(out_path, index=False)
        print(f"[{lang}] labeled {len(df_labeled)} rows → {out_path}")

if __name__ == "__main__":
    main()
