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
    from ..llm.gemini_client import (
        GeminiTranslationError,
        SUPPORTED_TARGET_LANGS,
        normalize_language_id,
        translate_with_gemini,
    )
except ImportError:                    
    try:
        from server.llm.gemini_client import (
            GeminiTranslationError,
            SUPPORTED_TARGET_LANGS,
            normalize_language_id,
            translate_with_gemini,
        )
    except ImportError:
        from llm.gemini_client import (                
            GeminiTranslationError,
            SUPPORTED_TARGET_LANGS,
            normalize_language_id,
            translate_with_gemini,
        )

router = APIRouter()

SUPPORTED_SOURCE_LANGS = {"python", "javascript", "java", "cpp", "go"}
DETECT_CHUNK = 4000


class TranslateOptions(BaseModel):
    preserve_comments: bool = True
    preserve_structure: bool = True


class TranslateRequest(BaseModel):
    source_code: str = Field(..., min_length=1)
    source_language: Optional[str] = None
    target_languages: List[str] = Field(..., min_items=1)
    options: TranslateOptions = TranslateOptions()


class TranslationResult(BaseModel):
    target_language: str
    code: str


class TranslateResponse(BaseModel):
    source_language: str
    translations: List[TranslationResult]


def _detect_language_from_code(code: str) -> str:
    snippet = code or ""
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


def _resolve_source_language(explicit: Optional[str], code: str) -> str:
    if explicit:
        normalized = normalize_language_id(explicit)
        if normalized == "plaintext":
            return "plaintext"
        if not normalized or normalized not in SUPPORTED_SOURCE_LANGS:
            raise HTTPException(status_code=400, detail=f"Unsupported source language: {explicit}")
        return normalized
    detected = _detect_language_from_code(code)
    if detected in SUPPORTED_SOURCE_LANGS:
        return detected
    return "plaintext"


def _normalize_targets(values: List[str]) -> List[str]:
    seen = set()
    normalized: List[str] = []
    for value in values:
        norm = normalize_language_id(value)
        if not norm or norm not in SUPPORTED_TARGET_LANGS:
            raise HTTPException(status_code=400, detail=f"Unsupported target language: {value}")
        if norm not in seen:
            seen.add(norm)
            normalized.append(norm)
    return normalized


@router.post("/translate", response_model=TranslateResponse)
def translate(payload: TranslateRequest) -> TranslateResponse:
    code = payload.source_code or ""
    if not code.strip():
        raise HTTPException(status_code=400, detail="source_code cannot be empty")

    source_language = _resolve_source_language(payload.source_language, code)
    if source_language == "plaintext":
        raise HTTPException(
            status_code=400,
            detail="Unable to detect a supported source language. Pin Python, JavaScript, Java, C++, or Go and try again.",
        )

    targets = _normalize_targets(payload.target_languages)
    if not targets:
        raise HTTPException(status_code=400, detail="Select at least one target language")

    try:
        translations = translate_with_gemini(
            source_code=code,
            source_language=source_language,
            target_languages=targets,
            options=payload.options.model_dump(),
        )
    except GeminiTranslationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return TranslateResponse(source_language=source_language, translations=translations)
