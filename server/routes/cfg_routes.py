import re
import textwrap
from typing import List, Optional, Dict, Any, Tuple
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# ---------- Models ----------
class FileSpec(BaseModel):
    name: str
    content: str

class CfgNode(BaseModel):
    id: str
    type: str                     # e.g., "function", "if", "for", "stmt", "class"
    label: str
    start_line: int
    end_line: int
    file: str                     # NEW: which file this node comes from
    meta: Optional[Dict[str, Any]] = None
    children: List[str] = Field(default_factory=list)  # child node ids (nested blocks)

class CfgResponse(BaseModel):
    status: str
    lang: str
    entry: str
    nodes: List[CfgNode]
    warnings: Optional[List[str]] = None


LANG_PATTERNS = {
    "python": {
        "function": re.compile(r"^\s*def\s+([A-Za-z_]\w*)\s*\(", re.M),
        "class": re.compile(r"^\s*class\s+([A-Za-z_]\w*)\s*[:\(]", re.M),
        "if": re.compile(r"^\s*if\b.*:\s*$", re.M),
        "elif": re.compile(r"^\s*elif\b.*:\s*$", re.M),
        "else": re.compile(r"^\s*else\b.*:\s*$", re.M),
        "for": re.compile(r"^\s*for\b.*:\s*$", re.M),
        "while": re.compile(r"^\s*while\b.*:\s*$", re.M),
        "return": re.compile(r"^\s*return\b", re.M),
    },
    "javascript": {
        "function": re.compile(
            r"^\s*(?:function\s+([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*=\s*function|\b([A-Za-z_]\w*)\s*\([^)]*\)\s*{)",
            re.M,
        ),
        "class": re.compile(r"^\s*class\s+([A-Za-z_]\w*)", re.M),
        "if": re.compile(r"^\s*if\s*\(.*\)\s*{", re.M),
        "else": re.compile(r"^\s*else\b", re.M),
        "for": re.compile(r"^\s*for\s*\(", re.M),
        "while": re.compile(r"^\s*while\s*\(", re.M),
        "return": re.compile(r"^\s*return\b", re.M),
    },
    "java": {
        "function": re.compile(
            r"^\s*(?:public|private|protected)?\s*(?:static\s+)?[A-Za-z_<>\[\]]+\s+([A-Za-z_]\w*)\s*\(",
            re.M,
        ),
        "class": re.compile(r"^\s*(?:public|private|protected)?\s*class\s+([A-Za-z_]\w*)", re.M),
        "if": re.compile(r"^\s*if\s*\(.*\)\s*{", re.M),
        "else": re.compile(r"^\s*else\b", re.M),
        "for": re.compile(r"^\s*for\s*\(", re.M),
        "while": re.compile(r"^\s*while\s*\(", re.M),
        "return": re.compile(r"^\s*return\b", re.M),
    },
    "cpp": {
        "function": re.compile(
            r"^\s*[A-Za-z_:<>\[\]\s*&]+?\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const)?\s*{",
            re.M,
        ),
        "class": re.compile(r"^\s*class\s+([A-Za-z_]\w*)", re.M),
        "if": re.compile(r"^\s*if\s*\(.*\)\s*{", re.M),
        "else": re.compile(r"^\s*else\b", re.M),
        "for": re.compile(r"^\s*for\s*\(", re.M),
        "while": re.compile(r"^\s*while\s*\(", re.M),
        "return": re.compile(r"^\s*return\b", re.M),
    },
    "go": {
        "function": re.compile(r"^\s*func\s+([A-Za-z_]\w*)\s*\(", re.M),
        "class": re.compile(r"^\s*type\s+([A-Za-z_]\w*)\s+struct", re.M),
        "if": re.compile(r"^\s*if\b.*{", re.M),
        "else": re.compile(r"^\s*else\b", re.M),
        "for": re.compile(r"^\s*for\b.*{", re.M),
        "while": re.compile(r"^\s*for\b.*{", re.M),  # Go uses for for loops
        "return": re.compile(r"^\s*return\b", re.M),
    },
}

BLOCK_LANGS = {"javascript", "java", "cpp", "go"}  # brace-based languages

def _line_indent(line: str) -> int:
    # Handle tabs robustly by expanding them to spaces
    expanded = line.expandtabs(4)
    return len(expanded) - len(expanded.lstrip(" "))

def _find_block_end_python(lines: List[str], start_idx: int) -> int:
    # start_idx is 0-based line index of the block header (def/class/if/for/while)
    header_indent = _line_indent(lines[start_idx])
    # block body is indented strictly greater than header_indent
    for i in range(start_idx + 1, len(lines)):
        line = lines[i]
        if not line.strip():
            continue
        if _line_indent(line) <= header_indent:
            return i - 1
    return len(lines) - 1

def _find_block_end_braces(lines: List[str], start_idx: int) -> int:
    # naive brace-matching starting at the line where '{' appears
    depth = 0
    started = False
    for i in range(start_idx, len(lines)):
        line = lines[i]
        for ch in line:
            if ch == '{':
                depth += 1
                started = True
            elif ch == '}':
                depth -= 1
                if depth == 0 and started:
                    return i
    return len(lines) - 1

def _sanitize_file_id(file_name: str) -> str:
    # Make file part safe for node ids (no dots/slashes)
    return re.sub(r"[^A-Za-z0-9_]+", "_", file_name)

def _collect_nodes_from_text(
    text: str,
    lang: str,
    file_name: str,
) -> Tuple[List[CfgNode], List[str]]:
    lines = text.splitlines()
    patterns = LANG_PATTERNS.get(lang, {})
    nodes: List[CfgNode] = []
    warnings: List[str] = []
    used_ids = set()
    file_slug = _sanitize_file_id(file_name)

    def make_id(ln: int, kind: str) -> str:
        # unique per file + line + kind
        base = f"{file_slug}_n{ln+1}_{kind}"
        if base not in used_ids:
            return base
        # ensure uniqueness if multiple nodes share same ln/kind
        c = 1
        while f"{base}_{c}" in used_ids:
            c += 1
        return f"{base}_{c}"

    i = 0
    while i < len(lines):
        line = lines[i]
        # skip empty
        if not line.strip():
            i += 1
            continue

        matched = False
        for kind, pat in patterns.items():
            m = pat.match(line)
            if m:
                matched = True
                node_id = make_id(i, kind)
                used_ids.add(node_id)

                # derive a label
                label = kind
                group_name = None
                # capture common name groups if present
                try:
                    for g in m.groups():
                        if isinstance(g, str) and g:
                            group_name = g
                            break
                except Exception:
                    group_name = None
                if group_name:
                    label = f"{kind}: {group_name}"
                else:
                    label = line.strip()[:80]

                # find block end depending on language
                if lang == "python":
                    end = _find_block_end_python(lines, i)
                elif lang in BLOCK_LANGS:
                    # if the '{' is not on current line, search forward for first '{'
                    if '{' not in line:
                        # search ahead a few lines to find the opening brace
                        open_idx = None
                        for j in range(i, min(i + 5, len(lines))):
                            if '{' in lines[j]:
                                open_idx = j
                                break
                        start_for_brace = open_idx if open_idx is not None else i
                    else:
                        start_for_brace = i
                    end = _find_block_end_braces(lines, start_for_brace)
                else:
                    # fallback: assume single-line statement
                    end = i

                node = CfgNode(
                    id=node_id,
                    type=kind,
                    label=label,
                    start_line=i + 1,
                    end_line=end + 1,
                    file=file_name,
                    meta={"snippet": lines[i:end + 1][:10]},
                    children=[],
                )
                nodes.append(node)
                # IMPORTANT: only advance one line so inner blocks are also scanned
                i += 1
                break

        if not matched:
            # treat as generic statement until next recognized block or blank line
            start = i
            # group consecutive non-empty non-matching lines into a single stmt node
            j = i
            while j < len(lines) and lines[j].strip():
                # stop if a known pattern matches at j
                stop = False
                for pat in patterns.values():
                    if pat.match(lines[j]):
                        stop = True
                        break
                if stop:
                    break
                j += 1
            end = j - 1
            node_id = make_id(start, "stmt")
            used_ids.add(node_id)
            snippet = lines[start:end + 1]
            label = snippet[0].strip()[:80] if snippet else ""
            node = CfgNode(
                id=node_id,
                type="stmt",
                label=label,
                start_line=start + 1,
                end_line=end + 1,
                file=file_name,
                meta={"lines": end - start + 1},
                children=[],
            )
            nodes.append(node)
            i = end + 1

    # Build a simple nesting structure PER FILE:
    # a node A is parent of B if B.start is within A.start..A.end and A != B,
    # and choose the smallest enclosing parent. Only compare nodes from same file.
    for idx, n in enumerate(nodes):
        for jdx, m in enumerate(nodes):
            if n.id == m.id or n.file != m.file:
                continue
            if m.start_line >= n.start_line and m.end_line <= n.end_line:
                # m is inside n; check if there's a tighter parent than n for m
                is_tighter = True
                for other in nodes:
                    if other.id in (n.id, m.id) or other.file != n.file:
                        continue
                    if (
                        other.start_line >= n.start_line
                        and other.end_line <= n.end_line
                        and m.start_line >= other.start_line
                        and m.end_line <= other.end_line
                    ):
                        # found another node that encloses m and is inside n -> n is not the immediate parent
                        is_tighter = False
                        break
                if is_tighter:
                    if m.id not in n.children:
                        n.children.append(m.id)

    return nodes, warnings

# ---------- Route ----------
class CfgRequest(BaseModel):
    lang: str
    entry: str
    files: List[FileSpec]

@router.post("/cfg", response_model=CfgResponse)
def cfg_endpoint(body: CfgRequest):
    lang = (body.lang or "").strip().lower()
    if lang not in LANG_PATTERNS:
        raise HTTPException(status_code=400, detail=f"unsupported language: {body.lang!r}")

    # find the entry file content exists (we still treat it as the "main" file)
    files_map = {f.name: f.content for f in body.files}
    if body.entry not in files_map:
        raise HTTPException(status_code=400, detail=f"entry file not found: {body.entry}")

    all_nodes: List[CfgNode] = []
    all_warnings: List[str] = []

    # NEW: parse ALL files, not just entry
    for f in body.files:
        file_nodes, file_warnings = _collect_nodes_from_text(f.content, lang, f.name)
        all_nodes.extend(file_nodes)
        all_warnings.extend(file_warnings)

    return CfgResponse(
        status="ok",
        lang=lang,
        entry=body.entry,
        nodes=all_nodes,
        warnings=all_warnings or None,
    )
