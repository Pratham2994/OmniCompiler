import re
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GO_DIR = ROOT / "data" / "raw" / "go"
OUT_PATH = ROOT / "data" / "candidates" / "go_candidates.csv"
OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

PATTERNS = {
    "for_loop": re.compile(r"^\s*for\s+"),
    "if": re.compile(r"^\s*if\s+"),
    "else_if": re.compile(r"^\s*else\s+if\s+"),
    "else": re.compile(r"^\s*else\s*{"),
    "indexing": re.compile(r"\w+\s*\[[^\]]+\]"),
    "comparison": re.compile(r"<=|>=|==|!=|<|>"),
}

def find_reasons(line: str):
    return [name for name, pat in PATTERNS.items() if pat.search(line)]

def main():
    rows = []
    for go_file in GO_DIR.glob("*.go"):
        with go_file.open("r", encoding="utf-8") as f:
            for i, raw_line in enumerate(f, start=1):
                line = raw_line.rstrip("\n")
                reasons = find_reasons(line)
                if not reasons:
                    continue
                rows.append({
                    "file": go_file.name,
                    "path": str(go_file.relative_to(ROOT)),
                    "line_no": i,
                    "line": line.strip(),
                    "reasons": ";".join(reasons),
                })

    with OUT_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["file","path","line_no","line","reasons"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Extracted {len(rows)} go candidate lines → {OUT_PATH}")

if __name__ == "__main__":
    main()
