from __future__ import annotations

import os
from typing import Dict, List, Optional

from google import genai

__all__ = [
    "GeminiTranslationError",
    "SUPPORTED_TARGET_LANGS",
    "normalize_language_id",
    "translate_with_gemini",
]

DEFAULT_MODEL = os.getenv("GOOGLE_GENAI_MODEL", "gemini-2.5-flash")
API_KEY_ENV_PRIMARY = "GOOGLE_GENAI_API_KEY"
API_KEY_ENV_FALLBACK = "GEMINI_API_KEY"

SUPPORTED_TARGET_LANGS: Dict[str, str] = {
    "python": "Python",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "java": "Java",
    "cpp": "C++",
    "go": "Go",
    "c": "C",
    "csharp": "C#",
    "rust": "Rust",
    "kotlin": "Kotlin",
    "swift": "Swift",
    "php": "PHP",
    "ruby": "Ruby",
    "sql": "SQL",
    "html_css": "HTML/CSS",
    "bash": "Bash",
    "assembly": "Assembly (x86-64)",
}

LANG_ALIASES: Dict[str, str] = {
    "py": "python",
    "python": "python",
    "js": "javascript",
    "javascript": "javascript",
    "ts": "typescript",
    "typescript": "typescript",
    "java": "java",
    "c++": "cpp",
    "cpp": "cpp",
    "c": "c",
    "golang": "go",
    "go": "go",
    "c#": "csharp",
    "cs": "csharp",
    "csharp": "csharp",
    "kt": "kotlin",
    "kotlin": "kotlin",
    "swift": "swift",
    "php": "php",
    "rb": "ruby",
    "ruby": "ruby",
    "sql": "sql",
    "html": "html_css",
    "css": "html_css",
    "html/css": "html_css",
    "shell": "bash",
    "bash": "bash",
    "sh": "bash",
    "asm": "assembly",
    "assembly": "assembly",
    "assembly (x86-64)": "assembly",
    "plain": "plaintext",
    "plaintext": "plaintext",
    "text": "plaintext",
}

class GeminiTranslationError(RuntimeError):
    """Raised when Gemini translation fails."""


def normalize_language_id(lang: Optional[str]) -> Optional[str]:
    if not lang:
        return None
    key = str(lang).strip().lower()
    return LANG_ALIASES.get(key, key if key in SUPPORTED_TARGET_LANGS else None)


def _strip_code_fence(text: str) -> str:
    data = text.strip()
    if data.startswith("```"):
        parts = data.split("\n", 1)
        data = parts[1] if len(parts) > 1 else ""
        if data.endswith("```"):
            data = data[:-3]
    return data.strip("\n")


def _build_prompt(source_language: str, target_language: str, source_code: str, options: Dict[str, bool]) -> str:
    source_name = SUPPORTED_TARGET_LANGS.get(source_language, source_language.title())
    target_name = SUPPORTED_TARGET_LANGS.get(target_language, target_language.title())
    prompt = f"""You are Gemini 2.5 Flash, acting as an expert software engineer and code translator.
Your job is to translate code from one programming language to another while preserving behavior, structure, and intent as much as possible.

Input

Source language: {source_name}

Target language: {target_name}

Source code:

Writing

{source_code}

Translation requirements

Preserve semantics

The translated code must behave the same as the original code, including edge cases and error handling.

Preserve logical structure (functions, classes, modules) and algorithmic complexity where feasible.

Preserve comments and naming

Keep comments and docstrings; translate human-language text only if necessary.

Preserve variable, function, and class names unless a small idiomatic change is clearly beneficial.

Idiomatic target code

Use idiomatic patterns for {target_name}:

Correct imports/includes/usings.

Standard control flow, error handling, and standard library usage.

For low-level targets like Assembly, produce readable, well-commented code with clear labels and structure.

No extra text

Output ONLY the translated code, with no explanations, no markdown, and no code fences.

Completeness

Return a fully usable translation:

Include all required imports / includes / using statements / headers.

Avoid pseudo-code; everything should be valid {target_name} code.

If {target_name} lacks direct equivalents for certain features, emulate them with idiomatic helper functions.

Safety

Do not introduce new network access, file I/O, or external side effects that are not present in the original code.
"""
    if not options.get("preserve_comments", True):
        prompt += "\nIf comments are not meaningful, you may omit them for clarity."
    if not options.get("preserve_structure", True):
        prompt += f"\nYou may restructure the program when it yields more idiomatic {target_name} code, but keep behavior identical."
    prompt += f"\n\nNow output ONLY valid {target_name} code."
    return prompt


def _resolve_api_key() -> str:
    api_key = os.getenv(API_KEY_ENV_PRIMARY) or os.getenv(API_KEY_ENV_FALLBACK)
    if not api_key:
        raise GeminiTranslationError(
            "Google Gemini API key is not set. Define GOOGLE_GENAI_API_KEY or GEMINI_API_KEY."
        )
    return api_key


def _run_completion(prompt: str) -> str:
    client = genai.Client(api_key=_resolve_api_key())
    try:
        response = client.models.generate_content(model=DEFAULT_MODEL, contents=prompt)
    except Exception as exc:                                       
        raise GeminiTranslationError(f"Gemini request failed: {exc}") from exc

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
        raise GeminiTranslationError("Gemini response did not include any text output.")
    return _strip_code_fence(text)


def translate_with_gemini(
    source_code: str,
    source_language: str,
    target_languages: List[str],
    options: Optional[Dict[str, bool]] = None,
) -> List[Dict[str, str]]:
    if not source_code.strip():
        raise GeminiTranslationError("Source code is empty.")
    resolved_source = normalize_language_id(source_language) or source_language
    opts = options or {}

    results: List[Dict[str, str]] = []
    for lang in target_languages:
        norm = normalize_language_id(lang)
        if not norm or norm not in SUPPORTED_TARGET_LANGS:
            raise GeminiTranslationError(f"Unsupported target language: {lang}")
        prompt = _build_prompt(resolved_source, norm, source_code, opts)
        translated = _run_completion(prompt)
        results.append({"target_language": norm, "code": translated})
    return results
