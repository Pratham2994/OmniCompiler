import re
import csv
from pathlib import Path

# Paths
ROOT = Path(__file__).resolve().parents[2]          
CPP_DIR = ROOT / "data" / "raw" / "cpp"
OUT_PATH = ROOT / "data" / "candidates" / "cpp_candidates.csv"
OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

# Regex patterns for C++ candidate lines
PATTERNS = {
    "for_loop": re.compile(r"^\s*for\s*\("),
    "while_loop": re.compile(r"^\s*while\s*\("),
    "if": re.compile(r"^\s*if\s*\("),
    "else_if": re.compile(r"^\s*else\s+if\s*\("),
    "else": re.compile(r"^\s*else\s*(\{|$)"),
    "indexing": re.compile(r"\w+\s*\[[^\]]+\]"),   # arr[i], nums[index]
    "comparison": re.compile(r"< =|<=|>=|>|==|!=".replace(" ", "")),  # simple op check
}

def find_reasons(line: str):
    reasons = []
    for name, pattern in PATTERNS.items():
        if pattern.search(line):
            reasons.append(name)
    return reasons

def main():
    rows = []

    for cpp_file in CPP_DIR.glob("*.cpp"):
        with cpp_file.open("r", encoding="utf-8") as f:
            for i, raw_line in enumerate(f, start=1):
                line = raw_line.rstrip("\n")
                reasons = find_reasons(line)
                if reasons:
                    rows.append({
                        "file": cpp_file.name,
                        "path": str(cpp_file.relative_to(ROOT)),
                        "line_no": i,
                        "line": line.strip(),
                        "reasons": ";".join(reasons),
                    })

    # Write CSV
    with OUT_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["file", "path", "line_no", "line", "reasons"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Extracted {len(rows)} candidate lines into {OUT_PATH}")

if __name__ == "__main__":
    main()
