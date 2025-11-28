from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from ..controller.detector import detect as run_detect
except ImportError:                    
    try:
        from server.controller.detector import detect as run_detect
    except ImportError:
        from controller.detector import detect as run_detect                

try:
    from ..llm.gemini_insights import analyze_with_gemini, GeminiInsightError
    from ..llm.gemini_client import normalize_language_id
except ImportError:                    
    try:
        from server.llm.gemini_insights import analyze_with_gemini, GeminiInsightError
        from server.llm.gemini_client import normalize_language_id
    except ImportError:
        from llm.gemini_insights import analyze_with_gemini, GeminiInsightError                
        from llm.gemini_client import normalize_language_id                

router = APIRouter()

DETECT_CHUNK = 4000


class InsightFile(BaseModel):
    path: str = Field(..., min_length=1, max_length=256)
    content: str = Field(..., min_length=1)


class InsightRequest(BaseModel):
    files: List[InsightFile] = Field(..., min_items=1, max_items=50)
    language: Optional[str] = None
    focus_path: Optional[str] = Field(
        default=None, description="Optional file path to highlight in the analysis output."
    )


class ComplexityOut(BaseModel):
    estimate: str = ""
    rationale: str = ""


class InsightResponse(BaseModel):
    language: str
    what_it_does: str
    key_behaviors: List[str]
    obvious_bugs: List[str]
    possible_bugs: List[str]
    fixes: List[str]
    complexity: ComplexityOut
    risks: List[str]
    test_ideas: List[str]


def _detect_language_from_files(files: List[InsightFile]) -> str:
    combined = "\n\n".join(f.content or "" for f in files)
    snippet = combined[:DETECT_CHUNK]
    payload = {
        "first_chunk": snippet[:DETECT_CHUNK],
        "last_chunk": snippet[-DETECT_CHUNK:] if len(snippet) > DETECT_CHUNK else snippet[:DETECT_CHUNK],
        "total_len": len(snippet),
        "n_bytes": len(snippet.encode("utf-8", "ignore")),
        "mode": "auto",
    }
    try:
        result = run_detect(payload) or {}
    except Exception as exc:                                                     
        raise HTTPException(status_code=500, detail=f"Language detection failed: {exc}") from exc
    raw = str(result.get("lang") or "").lower()
    if raw == "plain":
        raw = "plaintext"
    norm = normalize_language_id(raw) or raw
    return norm or "plaintext"


def _resolve_language(explicit: Optional[str], files: List[InsightFile]) -> str:
    if explicit:
        return normalize_language_id(explicit) or explicit
    return _detect_language_from_files(files)


@router.post("/insights", response_model=InsightResponse)
def get_insights(payload: InsightRequest) -> InsightResponse:
    files = payload.files or []
    if not files:
        raise HTTPException(status_code=400, detail="files cannot be empty")

    language = _resolve_language(payload.language, files)

    safe_files = [{"path": f.path.strip(), "content": f.content} for f in files]
    try:
        result = analyze_with_gemini(
            files=safe_files,
            language=language,
            focus_path=payload.focus_path,
        )
    except GeminiInsightError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return InsightResponse(
        language=str(result.get("language") or language or "unspecified"),
        what_it_does=result.get("what_it_does", ""),
        key_behaviors=result.get("key_behaviors", []),
        obvious_bugs=result.get("obvious_bugs", []),
        possible_bugs=result.get("possible_bugs", []),
        fixes=result.get("fixes", []),
        complexity=result.get("complexity", {}),
        risks=result.get("risks", []),
        test_ideas=result.get("test_ideas", []),
    )
