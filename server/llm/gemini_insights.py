from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from google import genai

try:
                                                                                  
    from .gemini_client import normalize_language_id
except ImportError:                    
    try:
        from server.llm.gemini_client import normalize_language_id
    except ImportError:
        from llm.gemini_client import normalize_language_id                

__all__ = ["GeminiInsightError", "analyze_with_gemini"]

DEFAULT_INSIGHT_MODEL = os.getenv("GOOGLE_GENAI_INSIGHT_MODEL", "gemini-2.5-pro")
INSIGHT_KEY_ENV_PRIMARY = "GOOGLE_GENAI_INSIGHT_API_KEY"
INSIGHT_KEY_FALLBACKS = ("GOOGLE_GENAI_API_KEY", "GEMINI_API_KEY")


class GeminiInsightError(RuntimeError):
    """Raised when Gemini insight analysis fails."""


def _resolve_api_key() -> str:
    """Choose the dedicated insight key first, then fall back to the shared keys."""
    api_key = os.getenv(INSIGHT_KEY_ENV_PRIMARY)
    if not api_key:
        for env_name in INSIGHT_KEY_FALLBACKS:
            api_key = os.getenv(env_name)
            if api_key:
                break
    if not api_key:
        raise GeminiInsightError(
            "Google Gemini insight API key is not set. Define GOOGLE_GENAI_INSIGHT_API_KEY, "
            "or fall back to GOOGLE_GENAI_API_KEY / GEMINI_API_KEY."
        )
    return api_key


def _run_completion(prompt: str) -> str:
    client = genai.Client(api_key=_resolve_api_key())
    try:
        response = client.models.generate_content(model=DEFAULT_INSIGHT_MODEL, contents=prompt)
    except Exception as exc:                                           
        raise GeminiInsightError(f"Gemini insight request failed: {exc}") from exc

    text = getattr(response, "text", None)
    if not text:
        parts = []
        for candidate in getattr(response, "candidates", []) or []:
            for part in getattr(getattr(candidate, "content", None), "parts", []) or []:
                value = getattr(part, "text", None)
                if value:
                    parts.append(value)
        text = "\n".join(parts)
    if not text:
        raise GeminiInsightError("Gemini response did not include any text output.")
    return text.strip()


def _coerce_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if value:
        return [str(value).strip()]
    return []


def _parse_json_response(raw: str) -> Dict[str, Any]:
    """Gemini sometimes wraps JSON; try a best-effort parse."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    cleaned = raw.strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(cleaned[start : end + 1])
        except Exception:
            pass
    raise GeminiInsightError("Gemini insight response was not valid JSON.")


def _build_prompt(code_blob: str, language_hint: Optional[str], focus_path: Optional[str]) -> str:
    schema = {
        "what_it_does": "1-2 sentences explaining the overall purpose.",
        "key_behaviors": ["short bullets describing main flows or outputs"],
        "obvious_bugs": ["concrete defects with evidence from the code"],
        "possible_bugs": ["suspicious or risky areas worth double-checking"],
        "fixes": ["specific fixes or refactors that address the bugs above"],
        "complexity": {
            "estimate": "Big-O or qualitative complexity for the dominant paths",
            "rationale": "Why this is the likely complexity",
        },
        "risks": ["security, reliability, or performance risks"],
        "test_ideas": ["targeted tests that would increase confidence"],
    }

    focus_line = focus_path or "not specified"
    language_line = language_hint or "auto-detect"
    return (
        "You are Gemini 2.5 Pro acting as an expert software engineer and static analysis partner.\n"
        "Analyze the provided code and return a STRICT JSON object matching the schema below. "
        "Do NOT include markdown, code fences, or any extra commentary.\n\n"
        f"Language hint: {language_line}\n"
        f"Primary file of interest: {focus_line}\n\n"
        "Required JSON schema (use the same keys):\n"
        f"{json.dumps(schema, indent=2)}\n\n"
        "Keep the response concise and evidence-based. Prefer short bullet strings; "
        "only include items you can justify from the code.\n\n"
        "Code to analyze:\n"
        f"{code_blob}"
    )


def _format_files(files: List[Dict[str, str]]) -> str:
    blocks = []
    for item in files:
        path = item.get("path") or item.get("name") or "snippet"
        content = item.get("content") or ""
        blocks.append(f"// File: {path}\n{content}")
    return "\n\n".join(blocks)


def analyze_with_gemini(
    files: List[Dict[str, str]],
    language: Optional[str] = None,
    focus_path: Optional[str] = None,
) -> Dict[str, Any]:
    if not files:
        raise GeminiInsightError("No files provided for analysis.")

    normalized_lang = normalize_language_id(language) if language else None
    code_blob = _format_files(files)
    prompt = _build_prompt(code_blob, normalized_lang, focus_path)
    raw = _run_completion(prompt)
    parsed = _parse_json_response(raw)

    return {
        "language": normalized_lang or (language or "unspecified"),
        "what_it_does": str(parsed.get("what_it_does", "")).strip(),
        "key_behaviors": _coerce_list(parsed.get("key_behaviors")),
        "obvious_bugs": _coerce_list(parsed.get("obvious_bugs")),
        "possible_bugs": _coerce_list(parsed.get("possible_bugs")),
        "fixes": _coerce_list(parsed.get("fixes")),
        "complexity": {
            "estimate": str(parsed.get("complexity", {}).get("estimate", "")).strip()
            if isinstance(parsed.get("complexity"), dict)
            else str(parsed.get("complexity") or "").strip(),
            "rationale": str(parsed.get("complexity", {}).get("rationale", "")).strip()
            if isinstance(parsed.get("complexity"), dict)
            else "",
        },
        "risks": _coerce_list(parsed.get("risks")),
        "test_ideas": _coerce_list(parsed.get("test_ideas")),
    }
