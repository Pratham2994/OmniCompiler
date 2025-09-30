import os
import sys
import json
from typing import List, Dict, Any, Tuple

# Ensure project root on path
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server.controller.detector import server_detect

Case = Dict[str, Any]

def make_req(code: str, mode: str = "auto", total_len_override: int | None = None) -> Dict[str, Any]:
    b = code.encode("utf-8", "ignore")
    total_len = len(b) if total_len_override is None else total_len_override
    return {
        "mode": mode,
        "first_chunk": code[: min(len(code), 4096)],
        "last_chunk": code[-min(len(code), 4096):],
        "more_chunks": None,
        "total_len": total_len,
    }

def bigify(code: str, target_bytes: int = 20000) -> str:
    if not code.endswith("\n"):
        code += "\n"
    out = []
    cur = 0
    while cur < target_bytes:
        out.append(code)
        cur += len(code.encode("utf-8", "ignore"))
    return "".join(out)

# Base samples (retain previous)
BASE_SAMPLES: List[Case] = [
    # Python (kept for regression stability though not in the 5 target langs)
    {"name":"py_print_small","lang":"python","code":"print('hello')\n"},
    {"name":"py_func_main","lang":"python","code":"def f():\n    pass\n\nif __name__ == '__main__':\n    print('x')\n"},
    {"name":"py_import_async","lang":"python","code":"#!/usr/bin/env python3\nfrom os import path\nasync def g():\n    pass\n"},
    # C++
    {"name":"cpp_include_main","lang":"cpp","code":"#include <iostream>\nint main(){ std::cout << \"hi\"; }\n"},
    {"name":"cpp_using_std","lang":"cpp","code":"#include \"my.h\"\nusing namespace std;\nstd::vector<int> v;\n"},
    {"name":"cpp_template","lang":"cpp","code":"template<typename T>\nT add(T a, T b){ return a+b; }\n"},
    # Go
    {"name":"go_hello_main","lang":"go","code":"package main\nimport \"fmt\"\nfunc main(){ fmt.Println(\"hi\") }\n"},
    {"name":"go_import_block","lang":"go","code":"package x\nimport (\n  \"fmt\"\n  \"os\"\n)\nfunc f(){ fmt.Printf(\"%d\", 3) }\n"},
    {"name":"go_short_decl","lang":"go","code":"package util\nfunc sum(xs []int) int { s := 0; for _,x := range xs { s += x }; return s }\n"},
    # Java
    {"name":"java_main","lang":"java","code":"package a.b;\npublic class Hello { public static void main(String[] args){ System.out.println(\"hi\"); } }\n"},
    {"name":"java_import_override","lang":"java","code":"import java.util.*;\nclass A { @Override public String toString(){ return \"\"; } }\n"},
    {"name":"java_class","lang":"java","code":"public class P { public int x; }\n"},
    # JavaScript
    {"name":"js_import_export","lang":"javascript","code":"import x from 'y';\nexport default function f(){}\n"},
    {"name":"js_cjs_console","lang":"javascript","code":"const x = require('x');\nmodule.exports = x;\nconsole.warn('w');\n"},
    {"name":"js_browser","lang":"javascript","code":"document.getElementById('a');\nwindow.location.href='/'\n"},
    # Plain text
    {"name":"plain_text_short","lang":"plain","code":"this is plain text\nno code here\n"},
    {"name":"plain_markdown","lang":"plain","code":"# Title\nSome description with arrows => but not JS code.\n"},
    {"name":"plain_config","lang":"plain","code":"key=value\nanother_key: 123\n"},
]

# Hard negatives to avoid false positives
HARD_NEGATIVES: List[Case] = [
    # Looks like Java but should be plain
    {"name":"plain_java_import_only","lang":"plain","code":"import java.util.*;\n"},
    {"name":"plain_java_override_only","lang":"plain","code":"@Override\n"},
    # Looks like C++ but should be plain (no robust cues)
    {"name":"plain_cpp_template_only","lang":"plain","code":"template<typename T>\n"},
    {"name":"plain_cpp_std_only","lang":"plain","code":"std::vector<int>\n"},
    {"name":"plain_cpp_include_midline","lang":"plain","code":"This doc mentions #include <stdio.h> in prose, not code.\n"},
    # Looks like JS but should be plain
    {"name":"plain_js_var_only","lang":"plain","code":"var x = 1\n"},
    {"name":"plain_js_const_only","lang":"plain","code":"const x = 2\n"},
    {"name":"plain_js_arrow_only","lang":"plain","code":"It maps a => b in text.\n"},
    # Looks like Go but should be plain
    {"name":"plain_go_package_only","lang":"plain","code":"package main\n"},
]

# Build big-code variants for robustness
def build_big_variants(cases: List[Case]) -> List[Case]:
    bigs: List[Case] = []
    for c in cases:
        # Create big variants for each except extremely short hard negatives that are intended as single-line traps
        if c["lang"] in ("cpp", "go", "java", "javascript", "python"):
            bigs.append({"name": c["name"] + "_big", "lang": c["lang"], "code": bigify(c["code"], 25000)})
    # Also big plain text
    bigs.append({"name": "plain_lorem_big", "lang": "plain", "code": bigify("lorem ipsum plain text only\n", 25000)})
    return bigs

SAMPLES: List[Case] = BASE_SAMPLES + HARD_NEGATIVES + build_big_variants(BASE_SAMPLES)

def evaluate(cases: List[Case]) -> Dict[str, Any]:
    by_expected: Dict[str, List[Tuple[str, float]]] = {}
    confusion: Dict[str, Dict[str, int]] = {}
    details: List[Dict[str, Any]] = []
    for c in cases:
        req = make_req(c["code"])
        res = server_detect(req)
        pred = res.get("lang", "plain")
        conf = float(res.get("confidence", 0.0))
        exp = c["lang"]
        confusion.setdefault(exp, {}).setdefault(pred, 0)
        confusion[exp][pred] += 1
        by_expected.setdefault(exp, []).append((pred, conf))
        details.append({"name": c["name"], "expected": exp, "pred": pred, "confidence": conf, "source": res.get("source")})
    # accuracy
    total = len(cases)
    correct = sum(1 for d in details if d["expected"] == d["pred"])
    acc = correct / total if total else 0.0
    return {"accuracy": acc, "total": total, "correct": correct, "confusion": confusion, "details": details}

def summarize_by_lang(report: Dict[str, Any]) -> Dict[str, float]:
    per_lang_acc: Dict[str, Tuple[int, int]] = {}  # lang -> (correct, total)
    for d in report["details"]:
        exp = d["expected"]
        ok = (d["expected"] == d["pred"])
        c, t = per_lang_acc.get(exp, (0, 0))
        per_lang_acc[exp] = (c + (1 if ok else 0), t + 1)
    return {lang: (c / t if t else 0.0) for lang, (c, t) in per_lang_acc.items()}

def print_report(report: Dict[str, Any]) -> None:
    print("Total:", report["total"], "Correct:", report["correct"], "Accuracy:", f"{report['accuracy']:.3f}")
    print("\nPer-language accuracy:")
    for lang, acc in sorted(summarize_by_lang(report).items()):
        print(f"  {lang:10s}: {acc:.3f}")
    print("\nConfusion matrix (expected -> predicted: count):")
    for exp, row in sorted(report["confusion"].items()):
        cells = ", ".join(f"{pred}:{cnt}" for pred, cnt in sorted(row.items()))
        print(f"  {exp:10s} -> {cells}")
    print("\nDetails:")
    for d in report["details"]:
        ok = "OK" if d["expected"] == d["pred"] else "MISS"
        print(f" - {ok:4s} {d['name']:28s}  exp={d['expected']:10s}  pred={d['pred']:10s}  conf={d['confidence']:.2f}  src={d.get('source')}")

if __name__ == "__main__":
    rep = evaluate(SAMPLES)
    print_report(rep)