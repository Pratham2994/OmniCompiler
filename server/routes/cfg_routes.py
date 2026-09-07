import json
import re
import textwrap
from typing import List, Optional, Dict, Any, Tuple
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


class FileSpec(BaseModel):
    name: str
    content: str

class CfgNode(BaseModel):
    id: str
    type: str
    label: str
    start_line: int
    end_line: int
    file: str
    meta: Optional[Dict[str, Any]] = None
    children: List[str] = Field(default_factory=list)

class CfgEdge(BaseModel):
    """A directed control-flow transition between two graph nodes.

    type is one of: seq (fall-through), true / false (branch outcomes),
    return (return to function exit), enter (declaration to its body entry;
    excluded from control-flow metrics).

    back marks an edge that closes a loop by returning control to a loop
    header. It is independent of type, because the statement that closes a
    loop body is often a conditional, whose edge back to the header is a
    true or false outcome rather than a plain fall-through.
    """
    source: str
    target: str
    type: str = "seq"
    back: bool = False

class CfgResponse(BaseModel):
    status: str
    lang: str
    entry: str
    nodes: List[CfgNode]
    edges: List[CfgEdge] = Field(default_factory=list)
    synthetic_nodes: List[CfgNode] = Field(default_factory=list)
    metrics: Optional[Dict[str, Any]] = None
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
        "elif": re.compile(r"^\s*\}?\s*else\s+if\s*\(.*\)\s*{", re.M),
        "else": re.compile(r"^\s*\}?\s*else\b", re.M),
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
        "elif": re.compile(r"^\s*\}?\s*else\s+if\s*\(.*\)\s*{", re.M),
        "else": re.compile(r"^\s*\}?\s*else\b", re.M),
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
        "elif": re.compile(r"^\s*\}?\s*else\s+if\s*\(.*\)\s*{", re.M),
        "else": re.compile(r"^\s*\}?\s*else\b", re.M),
        "for": re.compile(r"^\s*for\s*\(", re.M),
        "while": re.compile(r"^\s*while\s*\(", re.M),
        "return": re.compile(r"^\s*return\b", re.M),
    },
    "go": {
        "function": re.compile(r"^\s*func\s+([A-Za-z_]\w*)\s*\(", re.M),
        "class": re.compile(r"^\s*type\s+([A-Za-z_]\w*)\s+struct", re.M),
        "if": re.compile(r"^\s*if\b.*{", re.M),
        "elif": re.compile(r"^\s*\}?\s*else\s+if\b.*{", re.M),
        "else": re.compile(r"^\s*\}?\s*else\b", re.M),
        "for": re.compile(r"^\s*for\b.*{", re.M),
        "while": re.compile(r"^\s*for\b.*{", re.M),
        "return": re.compile(r"^\s*return\b", re.M),
    },
}

_PATTERN_PRIORITY = ["if", "elif", "else", "for", "while", "return", "function", "class"]

def _prioritize(patterns):
    """Match control constructs before declarations.

    The C++ and JavaScript function patterns are permissive enough to match
    "for (...) {" and "while (...) {" as function definitions, which erases
    the loop and leaves the graph acyclic. Trying the control-construct
    patterns first removes that ambiguity without loosening any pattern.
    """
    ordered = {k: patterns[k] for k in _PATTERN_PRIORITY if k in patterns}
    for key, value in patterns.items():
        if key not in ordered:
            ordered[key] = value
    return ordered

LANG_PATTERNS = {lang: _prioritize(pats) for lang, pats in LANG_PATTERNS.items()}

_PUNCT_ONLY = re.compile(r"^[\s{}()\[\];,]*$")

BLOCK_KINDS = {"function", "class", "if", "elif", "else", "for", "while"}

BLOCK_LANGS = {"javascript", "java", "cpp", "go"}

def _line_indent(line: str) -> int:

    expanded = line.expandtabs(4)
    return len(expanded) - len(expanded.lstrip(" "))

def _find_block_end_python(lines: List[str], start_idx: int) -> int:

    header_indent = _line_indent(lines[start_idx])

    for i in range(start_idx + 1, len(lines)):
        line = lines[i]
        if not line.strip():
            continue
        if _line_indent(line) <= header_indent:
            return i - 1
    return len(lines) - 1

def _find_block_end_braces(lines: List[str], start_idx: int) -> int:

    depth = 0
    started = False
    for i in range(start_idx, len(lines)):
        line = lines[i]
        for ch in line:
            if ch == '{':
                depth += 1
                started = True
            elif ch == '}':
                if not started:
                    continue
                depth -= 1
                if depth == 0:
                    return i
    return len(lines) - 1

def _sanitize_file_id(file_name: str) -> str:

    return re.sub(r"[^A-Za-z0-9_]+", "_", file_name)

def _assign_containment(nodes: List[CfgNode]) -> None:
    """Link every node to its tightest enclosing node, per file.

    Produces the same parent/child assignment as comparing each pair against
    every possible intermediate ancestor, but runs as one ordered sweep with
    a stack of open ranges instead of three nested passes over the node list.
    On the largest file in this repository that is the difference between
    roughly 285 ms and under 5 ms.
    """
    by_file: Dict[str, List[CfgNode]] = {}
    for node in nodes:
        by_file.setdefault(node.file, []).append(node)

    for file_nodes in by_file.values():
        ordered = sorted(file_nodes, key=lambda n: (n.start_line, -n.end_line))
        stack: List[CfgNode] = []
        for node in ordered:
            while stack and not (
                stack[-1].start_line <= node.start_line
                and stack[-1].end_line >= node.end_line
            ):
                stack.pop()
            if stack and node.id not in stack[-1].children:
                stack[-1].children.append(node.id)
            stack.append(node)


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

        base = f"{file_slug}_n{ln+1}_{kind}"
        if base not in used_ids:
            return base

        c = 1
        while f"{base}_{c}" in used_ids:
            c += 1
        return f"{base}_{c}"

    i = 0
    while i < len(lines):
        line = lines[i]

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


                label = kind
                group_name = None

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


                if kind not in BLOCK_KINDS:
                    end = i
                elif lang == "python":
                    end = _find_block_end_python(lines, i)
                elif lang in BLOCK_LANGS:

                    if '{' not in line:

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

                i += 1
                break

        if not matched:

            start = i

            base_indent = _line_indent(lines[i])
            j = i
            while j < len(lines) and lines[j].strip():

                if j > start and _line_indent(lines[j]) < base_indent:
                    break
                stop = False
                for pat in patterns.values():
                    if pat.match(lines[j]):
                        stop = True
                        break
                if stop:
                    break
                j += 1
            end = j - 1
            run = lines[start:end + 1]
            if all(_PUNCT_ONLY.match(ln) for ln in run if ln.strip()):
                i = end + 1
                continue
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




    _assign_containment(nodes)

    return nodes, warnings



LOOP_TYPES = {"for", "while"}
DECISION_TYPES = {"if", "elif", "for", "while"}
CHAIN_TAIL_TYPES = {"elif", "else"}
DECLARATION_TYPES = {"function", "class"}


class _CfgGraphBuilder:
    """Derives control-flow edges from the syntactic containment tree.

    The tree produced by _collect_nodes_from_text records which constructs are
    nested inside which. For structured control flow that is enough to
    reconstruct an intra-procedural control-flow graph: sibling order gives
    sequential flow, an if/elif/else chain gives true and false edges, and a
    loop header gives a body-entry edge plus a back edge from the end of its
    body, which is what makes the graph cyclic.

    Not modelled, and treated as ordinary statements: break, continue, goto,
    switch fallthrough, and exceptional control flow.
    """

    def __init__(self, nodes: List[CfgNode]):
        self.by_id: Dict[str, CfgNode] = {n.id: n for n in nodes}
        self.edges: List[CfgEdge] = []
        self.synthetic: List[CfgNode] = []
        self.loop_headers: Dict[str, CfgNode] = {}
        self._seen = set()

    def add(self, source: Optional[str], target: Optional[str], kind: str = "seq") -> None:
        if not source or not target or source == target:
            return
        key = (source, target, kind)
        if key in self._seen:
            return
        self._seen.add(key)
        self.edges.append(CfgEdge(source=source, target=target, type=kind))

    def _synth(self, node_id: str, kind: str, file_name: str, line: int) -> str:
        node = CfgNode(
            id=node_id,
            type=kind,
            label=kind,
            start_line=line,
            end_line=line,
            file=file_name,
            meta={"synthetic": True},
            children=[],
        )
        self.synthetic.append(node)
        self.by_id[node_id] = node
        return node_id

    def children_of(self, node: CfgNode) -> List[CfgNode]:
        kids = [self.by_id[c] for c in node.children if c in self.by_id]
        return sorted(kids, key=lambda n: (n.start_line, n.end_line))

    def _group(self, seq: List[CfgNode]) -> List[List[CfgNode]]:
        """Collapse an if / elif* / else? run of siblings into one construct."""
        groups: List[List[CfgNode]] = []
        i = 0
        while i < len(seq):
            node = seq[i]
            if node.type == "if":
                chain = [node]
                j = i + 1
                while j < len(seq) and seq[j].type in CHAIN_TAIL_TYPES:
                    chain.append(seq[j])
                    is_else = seq[j].type == "else"
                    j += 1
                    if is_else:
                        break
                groups.append(chain)
                i = j
            else:
                groups.append([node])
                i += 1
        return groups

    def wire_sequence(self, seq: List[CfgNode], next_id: str, func_exit: str) -> str:
        current = next_id
        for group in reversed(self._group(seq)):
            current = self.wire_group(group, current, func_exit)
        return current

    def wire_group(self, group: List[CfgNode], next_id: str, func_exit: str) -> str:
        if len(group) > 1 or group[0].type == "if":
            return self.wire_conditional(group, next_id, func_exit)
        return self.wire_node(group[0], next_id, func_exit)

    def wire_conditional(self, chain: List[CfgNode], join_id: str, func_exit: str) -> str:
        for idx, cond in enumerate(chain):
            body_entry = self.wire_sequence(self.children_of(cond), join_id, func_exit)
            if cond.type == "else":
                self.add(cond.id, body_entry, "seq")
                continue
            self.add(cond.id, body_entry, "true")
            following = chain[idx + 1].id if idx + 1 < len(chain) else join_id
            self.add(cond.id, following, "false")
        return chain[0].id

    def wire_node(self, node: CfgNode, next_id: str, func_exit: str) -> str:
        kind = node.type
        if kind in LOOP_TYPES:
            self.loop_headers[node.id] = node
            body_entry = self.wire_sequence(self.children_of(node), node.id, func_exit)
            self.add(node.id, body_entry, "true")
            self.add(node.id, next_id, "false")
            return node.id
        if kind == "return":
            self.add(node.id, func_exit, "return")
            return node.id
        if kind in DECLARATION_TYPES:
            self.wire_declaration(node)
            self.add(node.id, next_id, "seq")
            return node.id
        self.add(node.id, next_id, "seq")
        return node.id

    def wire_declaration(self, node: CfgNode) -> None:
        entry_id = self._synth(node.id + "__entry", "entry", node.file, node.start_line)
        exit_id = self._synth(node.id + "__exit", "exit", node.file, node.end_line)
        self.add(node.id, entry_id, "enter")
        body_entry = self.wire_sequence(self.children_of(node), exit_id, exit_id)
        self.add(entry_id, body_entry, "seq")

    def mark_back_edges(self) -> None:
        """Flag every edge that returns control from a loop body to its header."""
        for edge in self.edges:
            if edge.type == "enter":
                continue
            header = self.loop_headers.get(edge.target)
            if header is None:
                continue
            source = self.by_id.get(edge.source)
            if source is None:
                continue
            if source.start_line >= header.start_line and source.end_line <= header.end_line:
                edge.back = True

    def function_metrics(self) -> List[Dict[str, Any]]:
        """Cyclomatic complexity per function over its own reachable subgraph.

        enter edges are excluded so that a nested declaration's body is not
        counted inside its parent. For a single connected function subgraph
        P is 1, so M = E - V + 2, which for structured code should agree with
        the decision-point count plus one.
        """
        adjacency: Dict[str, List[CfgEdge]] = {}
        for edge in self.edges:
            if edge.type == "enter":
                continue
            adjacency.setdefault(edge.source, []).append(edge)

        results: List[Dict[str, Any]] = []
        for node in list(self.by_id.values()):
            if node.type != "function":
                continue
            entry_id = node.id + "__entry"
            if entry_id not in self.by_id:
                continue

            visited = set()
            stack = [entry_id]
            while stack:
                current = stack.pop()
                if current in visited:
                    continue
                visited.add(current)
                for edge in adjacency.get(current, []):
                    stack.append(edge.target)

            edge_count = sum(
                1 for e in self.edges
                if e.type != "enter" and e.source in visited and e.target in visited
            )
            decisions = sum(
                1 for nid in visited
                if nid in self.by_id and self.by_id[nid].type in DECISION_TYPES
            )
            complexity = edge_count - len(visited) + 2
            results.append({
                "function": node.label,
                "file": node.file,
                "start_line": node.start_line,
                "end_line": node.end_line,
                "nodes": len(visited),
                "edges": edge_count,
                "cyclomatic": complexity,
                "decision_points": decisions,
                "matches_decision_rule": complexity == decisions + 1,
            })
        return sorted(results, key=lambda r: (r["file"], r["start_line"]))


def build_cfg_edges(nodes: List[CfgNode]) -> Tuple[List[CfgEdge], List[CfgNode], Dict[str, Any]]:
    """Build control-flow edges, entry/exit pseudo-nodes, and graph metrics."""
    builder = _CfgGraphBuilder(nodes)

    contained = set()
    for node in nodes:
        for child in node.children:
            contained.add(child)

    roots_by_file: Dict[str, List[CfgNode]] = {}
    for node in nodes:
        if node.id in contained:
            continue
        roots_by_file.setdefault(node.file, []).append(node)

    for file_name, roots in roots_by_file.items():
        ordered = sorted(roots, key=lambda n: (n.start_line, n.end_line))
        slug = _sanitize_file_id(file_name)
        module_entry = builder._synth(slug + "__module_entry", "entry", file_name, 0)
        module_exit = builder._synth(slug + "__module_exit", "exit", file_name, 0)
        body_entry = builder.wire_sequence(ordered, module_exit, module_exit)
        builder.add(module_entry, body_entry, "seq")

    builder.mark_back_edges()
    per_function = builder.function_metrics()

    back_edges = sum(1 for e in builder.edges if e.back)
    decision_nodes = sum(1 for n in nodes if n.type in DECISION_TYPES)
    metrics = {
        "node_count": len(nodes) + len(builder.synthetic),
        "edge_count": len(builder.edges),
        "back_edge_count": back_edges,
        "decision_nodes": decision_nodes,
        "functions": per_function,
    }
    return builder.edges, builder.synthetic, metrics



OUTLINE_TYPES = {"function", "class", "if", "elif", "else", "for", "while", "return"}


def _control_outline(nodes: List[CfgNode], file_name: str, max_lines: int = 40) -> List[str]:
    """Indented outline of the control constructs in one file."""
    by_id = {n.id: n for n in nodes if n.file == file_name}
    contained = set()
    for node in by_id.values():
        for child in node.children:
            if child in by_id:
                contained.add(child)
    roots = sorted(
        [n for n in by_id.values() if n.id not in contained],
        key=lambda n: (n.start_line, n.end_line),
    )

    out: List[str] = []

    def walk(node: CfgNode, depth: int) -> None:
        if len(out) >= max_lines:
            return
        next_depth = depth
        if node.type in OUTLINE_TYPES:
            label = node.label if node.type in ("function", "class") else node.type
            out.append("%s%s L%d-%d" % ("  " * depth, label, node.start_line, node.end_line))
            next_depth = depth + 1
        kids = [by_id[c] for c in node.children if c in by_id]
        for child in sorted(kids, key=lambda n: (n.start_line, n.end_line)):
            walk(child, next_depth)

    for root in roots:
        walk(root, 0)
    if len(out) >= max_lines:
        out.append("... outline truncated")
    return out


def summarize_cfg_nodes(
    nodes: List[CfgNode],
    edges: List[CfgEdge],
    metrics: Dict[str, Any],
    max_chars: int = 4000,
) -> Dict[str, Any]:
    """Compact, size-capped structural summary suitable for an LLM prompt."""
    per_file: Dict[str, Dict[str, Any]] = {}
    for node in nodes:
        bucket = per_file.setdefault(node.file, {
            "file": node.file,
            "decision_nodes": 0,
            "functions": [],
            "outline": [],
        })
        if node.type in DECISION_TYPES:
            bucket["decision_nodes"] += 1

    for fn in metrics.get("functions", []):
        bucket = per_file.get(fn["file"])
        if bucket is None:
            continue
        bucket["functions"].append({
            "name": fn["function"],
            "lines": [fn["start_line"], fn["end_line"]],
            "cyclomatic_complexity": fn["cyclomatic"],
            "decision_points": fn["decision_points"],
        })

    for file_name, bucket in per_file.items():
        bucket["outline"] = _control_outline(nodes, file_name)

    summary = {
        "representation": "control-flow graph (intra-procedural, structured control flow)",
        "totals": {
            "nodes": metrics.get("node_count", 0),
            "edges": metrics.get("edge_count", 0),
            "loop_back_edges": metrics.get("back_edge_count", 0),
            "decision_nodes": metrics.get("decision_nodes", 0),
        },
        "files": sorted(per_file.values(), key=lambda b: b["file"]),
        "notes": (
            "cyclomatic_complexity is M = E - V + 2P computed on the function subgraph. "
            "break, continue, goto, switch fallthrough and exceptional edges are not modelled."
        ),
    }

    while len(json.dumps(summary)) > max_chars and summary["files"]:
        trimmed = False
        for bucket in summary["files"]:
            if len(bucket["outline"]) > 4:
                bucket["outline"] = bucket["outline"][:-1]
                trimmed = True
        if not trimmed:
            if len(summary["files"]) > 1:
                summary["files"] = summary["files"][:-1]
            else:
                break
    return summary


def build_cfg_summary(
    files: List[Tuple[str, str]],
    lang: str,
    max_chars: int = 4000,
) -> Optional[Dict[str, Any]]:
    """Structural summary for a set of (name, content) pairs.

    Returns None whenever a summary cannot be produced, so that callers can
    fall back to their original prompt without any change in behaviour.
    """
    normalized = (lang or "").strip().lower()
    if normalized not in LANG_PATTERNS:
        return None
    try:
        all_nodes: List[CfgNode] = []
        for name, content in files:
            if not content or not content.strip():
                continue
            file_nodes, _ = _collect_nodes_from_text(content, normalized, name)
            all_nodes.extend(file_nodes)
        if not all_nodes:
            return None
        edges, _synthetic, metrics = build_cfg_edges(all_nodes)
        summary = summarize_cfg_nodes(all_nodes, edges, metrics, max_chars=max_chars)
        if not any(b["functions"] or b["outline"] for b in summary["files"]):
            return None
        return summary
    except Exception:
        return None


MAX_CFG_FILES = 50
MAX_CFG_FILE_BYTES = 200_000
MAX_CFG_TOTAL_BYTES = 2_000_000


class CfgRequest(BaseModel):
    lang: str
    entry: str
    files: List[FileSpec] = Field(..., min_items=1, max_items=MAX_CFG_FILES)

@router.post("/cfg", response_model=CfgResponse)
def cfg_endpoint(body: CfgRequest):
    lang = (body.lang or "").strip().lower()
    if lang not in LANG_PATTERNS:
        raise HTTPException(status_code=400, detail=f"unsupported language: {body.lang!r}")


    total_bytes = 0
    for f in body.files:
        size = len((f.content or "").encode("utf-8", "ignore"))
        if size > MAX_CFG_FILE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"file too large (>{MAX_CFG_FILE_BYTES} bytes): {f.name}")
        total_bytes += size
    if total_bytes > MAX_CFG_TOTAL_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"payload too large (>{MAX_CFG_TOTAL_BYTES} bytes total)")

    files_map = {f.name: f.content for f in body.files}
    if body.entry not in files_map:
        raise HTTPException(status_code=400, detail=f"entry file not found: {body.entry}")

    all_nodes: List[CfgNode] = []
    all_warnings: List[str] = []


    for f in body.files:
        file_nodes, file_warnings = _collect_nodes_from_text(f.content, lang, f.name)
        all_nodes.extend(file_nodes)
        all_warnings.extend(file_warnings)

    edges, synthetic_nodes, metrics = build_cfg_edges(all_nodes)

    return CfgResponse(
        status="ok",
        lang=lang,
        entry=body.entry,
        nodes=all_nodes,
        edges=edges,
        synthetic_nodes=synthetic_nodes,
        metrics=metrics,
        warnings=all_warnings or None,
    )
