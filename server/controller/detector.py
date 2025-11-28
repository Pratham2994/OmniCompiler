from typing import Dict, Any, List, Optional

import re, textwrap, json
from pygments.lexers import guess_lexer
from pygments.util import ClassNotFound


                           
                         
                           
PRINT_SNIPPETS = False                                                         
LOG_VERBOSE    = False                                            
SNIPPET_PRINT_WIDTH = 1500

def log(*args, **kwargs):
    print(*args, **kwargs)

def log_json(title, obj):
    log(f"\n[{title}]")
    try:
        print(json.dumps(obj, indent=2, ensure_ascii=False)[:4000])
    except Exception:
        print(str(obj)[:4000])

                           
                            
                           

                                                    
FP = {
    "go": [
        re.compile(r"^\s*package\s+\w+\b", re.M),
        re.compile(r"^\s*func\s+\w+\s*\(", re.M),
        re.compile(r"^\s*import\s*\(", re.M),
        re.compile(r"^\s*import\s+\"[^\n\"]+\"\s*", re.M),
        re.compile(r"\bfmt\.(?:Print|Printf|Println|Fprint|Fprintf|Fprintln)\s*\("),
    ],
    "java": [
        re.compile(r"^\s*package\s+[\w.]+;", re.M),
        re.compile(r"\bpublic\s+class\b"),
        re.compile(r"\bpublic\s+static\s+void\s+main\s*\("),
        re.compile(r"^\s*import\s+(?:static\s+)?[\w.]+(?:\.\*)?\s*;", re.M),
        re.compile(r"\bSystem\.out\.println\s*\("),
        re.compile(r"@\s*Override\b"),
    ],
    "cpp": [
        re.compile(r"^\s*#\s*include\s*[<\"][^>\"\n]+[>\"]", re.M),
        re.compile(r"\busing\s+namespace\s+std\s*;"),
        re.compile(r"\bstd::\w+"),
        re.compile(r"\bint\s+main\s*\("),
        re.compile(r"\bcout\s*<<"),
        re.compile(r"\bcin\s*>>"),
        re.compile(r"\btemplate\s*<"),
    ],
    "python": [
        re.compile(r"^\s*def\s+\w+\s*\(", re.M),
        re.compile(r"^\s*class\s+\w+\s*:", re.M),
        re.compile(r"^\s*from\s+\w+(?:\.\w+)*\s+import\s+", re.M),
        re.compile(r"^\s*import\s+[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*\s*(?:#.*)?$", re.M),
        re.compile(r"^\s*if\s+__name__\s*==\s*['\"]__main__['\"]\s*:", re.M),
        re.compile(r"^\s*#!.*python[23]?\b", re.M),
        re.compile(r"^\s*async\s+def\s+\w+\s*\(", re.M),
        re.compile(r"^\s*print\s*\(", re.M),
    ],
    "javascript": [
        re.compile(r"^\s*import\s+.+\s+from\s+['\"].+['\"]\s*;?", re.M),
        re.compile(r"\bexport\s+(default|const|function|class)\b"),
        re.compile(r"\b(module\.exports|require\s*\()\b"),
        re.compile(r"\bconsole\.log\s*\("),
        re.compile(r"\bconsole\.(?:warn|error)\s*\("),
        re.compile(r"\bdocument\.getElementById\s*\("),
        re.compile(r"\bwindow\."),
        re.compile(r"^\s*(?:const|let|var)\s+\w+\s*=\s*", re.M),
    ],
}
LANGS = list(FP.keys())
                                                         

def _best_two(scores: dict[str, int]):
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    top = ranked[0]
    second = ranked[1] if len(ranked) > 1 else ("", -1)
    return top, second, ranked

def _is_ambiguous(top, second, margin: int = 1):
                                                      
    return second[1] >= 0 and (top[1] - second[1]) <= margin

def _conflict_policy(snippet: str, top_lang: str, second_lang: str) -> str:
    """
    Return one of: 'unknown', 'prefer_top', 'prefer_second'
    You can encode any bias rules here. We’ll stay conservative.
    """
    pair = {top_lang, second_lang}

                          
    if pair == {"python", "javascript"}:
                                                                             
        if "__name__" in snippet or re.search(r"^\s*from\s+\w+", snippet, re.M):
            return "prefer_top" if top_lang == "python" else "prefer_second"
                                                      
        if re.search(r"^\s*import\s+.+\s+from\s+['\"].+['\"]\s*;?", snippet, re.M)\
           or re.search(r"\bexport\s+(default|const|function|class)\b", snippet):
            return "prefer_top" if top_lang == "javascript" else "prefer_second"
        return "unknown"

                                                                                                   
    if pair == {"java", "python"}:
        if re.search(r"^\s*import\s+[\w.]+\s*;", snippet, re.M) or "@Override" in snippet:
            return "prefer_top" if top_lang == "java" else "prefer_second"
        if re.search(r"^\s*from\s+\w+(?:\.\w+)*\s+import\s+", snippet, re.M):
            return "prefer_top" if top_lang == "python" else "prefer_second"
        return "unknown"

                                                 
    return "unknown"


def _assemble(first_chunk: str, last_chunk: str, more_chunks: Optional[List[Dict[str,str]]], cap_bytes: int = 98_304) -> str:
    if LOG_VERBOSE:
        log("\n[assemble] Building snippet from chunks...")
        log(f"[assemble] first_chunk bytes: {len(first_chunk.encode('utf-8', 'ignore'))}, last_chunk bytes: {len(last_chunk.encode('utf-8','ignore'))}")
        if more_chunks:
            log(f"[assemble] additional more_chunks: {len(more_chunks)}")
    parts = [first_chunk or ""]
    parts.append("\n/*…gap…*/\n")
    if more_chunks:
        more_sorted = sorted(more_chunks, key=lambda x: x.get("start", 0))
        for i, ch in enumerate(more_sorted):
            seg = ch.get("data","")
            parts.append(seg)
            parts.append("\n/*…gap…*/\n")
            if LOG_VERBOSE:
                log(f"[assemble] more_chunk[{i}] start={ch.get('start','?')} bytes={len(seg.encode('utf-8','ignore'))}")
    parts.append(last_chunk or "")
    assembled = "".join(parts)
    if len(assembled.encode("utf-8","ignore")) > cap_bytes:
        if LOG_VERBOSE:
            log(f"[assemble] capping assembled snippet to {cap_bytes} bytes")
        assembled = assembled.encode("utf-8","ignore")[:cap_bytes].decode("utf-8","ignore")
    if PRINT_SNIPPETS:
        log("\n--- Assembled Snippet (truncated) ---\n")
        log(textwrap.shorten(assembled, width=SNIPPET_PRINT_WIDTH, placeholder="... [truncated] ..."))
    return assembled

def _score_fingerprints(snippet: str) -> Dict[str, int]:
    if LOG_VERBOSE:
        log("\n[regex] Scoring fingerprints...")
    scores = {k: 0 for k in LANGS}
    hits: Dict[str, List[str]] = {k: [] for k in LANGS}
    for lang, regs in FP.items():
        s = 0
        for r in regs:
            m = r.search(snippet)
            if m:
                pat = r.pattern
                                                                                                         
                weak = False
                if "=>" in pat:
                    weak = True
                               
                if "std::" in pat:
                    weak = True
                if "template\\s*<" in pat:
                    weak = True
                                                                                              
                if "(?:const|let|var)" in pat and "=" in pat:
                    weak = True
                pts = 1 if weak else 2
                s += pts
                if LOG_VERBOSE:
                                                          
                    start = max(m.start() - 30, 0)
                    end   = min(m.end() + 30, len(snippet))
                    excerpt = snippet[start:end].replace("\n", "\\n")
                    hits[lang].append(f"hit(+{pts}): /{r.pattern}/ ... {excerpt[:120]}")
        scores[lang] = s
    if LOG_VERBOSE:
        log_json("regex.scores", scores)
        for lang in LANGS:
            if hits[lang]:
                log(f"\n[regex.hits.{lang}]")
                for h in hits[lang][:10]:
                    log("  ", h[:300])
                if len(hits[lang]) > 10:
                    log(f"  ... and {len(hits[lang]) - 10} more hits")
    return scores

def _pygments_guess(snippet: str) -> Optional[str]:
    if LOG_VERBOSE:
        log("\n[pygments] Guessing language...")
    try:
        lx = guess_lexer(snippet)
    except ClassNotFound:
        if LOG_VERBOSE:
            log("[pygments] No lexer class found.")
        return None
    alias = (lx.aliases[0] if lx.aliases else lx.name or "").lower()
    if LOG_VERBOSE:
        log(f"[pygments] raw alias/name: {alias}")
    MAP = {
                       
        "python":"python", "py":"python", "python3":"python", "python2":"python", "py3":"python", "ipython":"python", "pycon":"python",
                                                                  
        "javascript":"javascript", "js":"javascript", "node":"javascript", "nodejs":"javascript", "ecmascript":"javascript",
        "jsx":"javascript", "mjs":"javascript", "cjs":"javascript", "typescript":"javascript", "ts":"javascript", "tsx":"javascript",
              
        "java":"java",
             
        "cpp":"cpp", "c++":"cpp", "cxx":"cpp", "arduino":"cpp",
            
        "go":"go", "golang":"go",
    }
    mapped = MAP.get(alias)
    if LOG_VERBOSE:
        log(f"[pygments] mapped: {mapped}")
    return mapped

def _used_chunks(req: Dict[str, Any]) -> List[str]:
    uc = ["first", "last"]
    if req.get("more_chunks"):
        uc.append("more")
    return uc
def _looks_like_plain_trap(snippet: str) -> bool:
    """
    Heuristics to avoid false positives by recognizing tiny, single-cue snippets
    that are likely prose or incomplete code fragments.
    Prefer returning plain text when these patterns occur without stronger cues.
    """
                                                
    lines = [ln for ln in snippet.splitlines() if ln.strip()]
    short = len(lines) <= 3
                                                                                        
    if re.fullmatch(r"\s*import\s+(?:static\s+)?[\w.]+(?:\.\*)?\s*;.*", (lines[0] if lines else ""), flags=0) and\
       not re.search(r"\b(class|public|static|System\.out\.println)\b", snippet):
        return True
    if "@Override" in snippet and not re.search(r"\b(class|public)\b", snippet):
        return True
                                                                                            
    if short and (re.search(r"\btemplate\s*<", snippet) or re.search(r"\bstd::\w+", snippet)) and\
       not re.search(r"^\s*#\s*include", snippet, re.M) and\
       not re.search(r"\bint\s+main\s*\(", snippet) and\
       not re.search(r"\busing\s+namespace\s+std\s*;", snippet) and\
       not re.search(r"\bcout\s*<<|\bcin\s*>>", snippet):
        return True
                                                                                                         
    if short and re.search(r"^\s*(?:const|let|var)\s+\w+\s*=", snippet, re.M) and\
       not re.search(r"^\s*import\s+.+\s+from\s+['\"].+['\"]\s*;?", snippet, re.M) and\
       not re.search(r"\bexport\s+(default|const|function|class)\b", snippet) and\
       not re.search(r"\b(module\.exports|require\s*\()\b", snippet) and\
       not re.search(r"\bconsole\.(?:log|warn|error)\s*\(", snippet) and\
       not re.search(r"\bdocument\.getElementById\s*\(", snippet) and\
       not re.search(r"\bwindow\.", snippet):
        return True
                                               
    if short and re.search(r"^\s*package\s+\w+\s*$", snippet, re.M) and\
       not re.search(r"^\s*import\b", snippet, re.M) and\
       not re.search(r"^\s*func\b", snippet, re.M):
        return True
    return False

                                                               

def server_detect(request: Dict[str, Any]) -> Dict[str, Any]:
    log_json("server.request", {k: (v if k not in ("first_chunk","last_chunk","more_chunks") else f"<{k} omitted for brevity>") for k,v in request.items()})

    mode = request.get("mode", "auto")
    forced = request.get("forced_lang")
    total_len = int(request.get("total_len", 0))

    if forced:
        resp = {"status":"ok","lang":forced,"confidence":1.0,"source":"user","used_chunks": _used_chunks(request)}
        log_json("server.response", resp)
        return resp

    snippet = _assemble(request.get("first_chunk",""), request.get("last_chunk",""), request.get("more_chunks"))

                     
    scores = _score_fingerprints(snippet)

                                                                                        
                                                                                          
    if scores.get("javascript", 0) <= 1 and "=>" in snippet:
        if not re.search(r"^\s*import\s+.+\s+from\s+['\"].+['\"]\s*;?", snippet, re.M) and\
           not re.search(r"\bexport\s+(default|const|function|class)\b", snippet) and\
           not re.search(r"\b(module\.exports|require\s*\()\b", snippet) and\
           not re.search(r"\bconsole\.(?:log|warn|error)\s*\(", snippet) and\
           not re.search(r"\bdocument\.getElementById\s*\(", snippet) and\
           not re.search(r"\bwindow\.", snippet) and\
           not re.search(r"^\s*(?:const|let|var)\s+\w+\s*=", snippet, re.M):
            scores["javascript"] = 0

                                                                                                                        
    if _looks_like_plain_trap(snippet):
        ranked_vals = sorted(scores.values(), reverse=True)
        top_val = ranked_vals[0] if ranked_vals else 0
        sec_val = ranked_vals[1] if len(ranked_vals) > 1 else 0
        if top_val <= 2 and sec_val <= 1:
            resp = {"status":"ok","lang":"plain","confidence":0.25,"source":"plain_trap","used_chunks": _used_chunks(request)}
            log_json("server.response", resp)
            return resp

    (top_lang, top_score), (sec_lang, sec_score), ranked = _best_two(scores)
    if LOG_VERBOSE:
        log(f"[decision] regex top: {top_lang}={top_score}, second: {sec_lang}={sec_score}")

                                                       
    if top_score == 0:
                                                                                      
        if _looks_like_plain_trap(snippet):
            resp = {"status":"ok","lang":"plain","confidence":0.25,"source":"plain_trap","used_chunks": _used_chunks(request)}
            log_json("server.response", resp)
            return resp
                                                  
        pg = _pygments_guess(snippet)
        if pg:
            resp = {"status":"ok","lang":pg,"confidence":0.70,"source":"pygments","used_chunks": _used_chunks(request)}
            log_json("server.response", resp)
            return resp
                                                            
        if mode == "verify":
            if total_len > 8192 and not request.get("more_chunks"):
                mid_start = max(total_len//2 - 4096, 0)
                resp = {"status":"need_more","reason":"no_signal","request_ranges":[{"start": int(mid_start), "len": 8192}]}
                log_json("server.response", resp)
                return resp
        resp = {"status":"ok","lang":"plain","confidence":0.20,"source":"fallback","used_chunks": _used_chunks(request)}
        log_json("server.response", resp)
        return resp

                      
    if top_score >= 3 and top_score - sec_score >= 2:
        resp = {"status":"ok","lang":top_lang,"confidence":0.90,"source":"fingerprints","used_chunks": _used_chunks(request)}
        log_json("server.response", resp)
        return resp

                          
    if _is_ambiguous((top_lang, top_score), (sec_lang, sec_score), margin=0):
        log(f"[conflict] ambiguous between {top_lang} and {sec_lang} at score {top_score}=={sec_score}")
        policy = _conflict_policy(snippet, top_lang, sec_lang)
        if policy == "prefer_top":
            resp = {"status":"ok","lang":top_lang,"confidence":0.80,"source":"fingerprints_tiebreak","used_chunks": _used_chunks(request)}
            log_json("server.response", resp)
            return resp
        if policy == "prefer_second":
            resp = {"status":"ok","lang":sec_lang,"confidence":0.80,"source":"fingerprints_tiebreak","used_chunks": _used_chunks(request)}
            log_json("server.response", resp)
            return resp
                                                                    
        if mode == "verify":
            if total_len > 8192 and not request.get("more_chunks"):
                mid_start = max(total_len//2 - 4096, 0)
                resp = {"status":"need_more","reason":"ambiguous_"+top_lang+"_vs_"+sec_lang,"request_ranges":[{"start": int(mid_start), "len": 8192}]}
                log_json("server.response", resp)
                return resp
                                                      
            resp = {"status":"ok","lang":"plain","confidence":0.30,"source":"ambiguous","used_chunks": _used_chunks(request)}
            log_json("server.response", resp)
            return resp
        else:
                                                                                   
            resp = {"status":"ok","lang":"plain","confidence":0.30,"source":"ambiguous","used_chunks": _used_chunks(request)}
            log_json("server.response", resp)
            return resp

                                                     
    pg = _pygments_guess(snippet)
    if pg:
        conf = 0.70
        if pg == top_lang and top_score >= 2:
            conf = 0.80
            if LOG_VERBOSE: log("[decision] regex and pygments align; lifting confidence.")
        resp = {"status":"ok","lang":pg,"confidence":conf,"source":"pygments","used_chunks": _used_chunks(request)}
        log_json("server.response", resp)
        return resp

                         
    resp = {"status":"ok","lang":top_lang,"confidence":0.50,"source":"fallback","used_chunks": _used_chunks(request)}
    log_json("server.response", resp)
    return resp


def detect(payload: Dict[str, Any]) -> Dict[str, Any]:
    return server_detect(payload)