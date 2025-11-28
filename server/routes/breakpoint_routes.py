import asyncio
import re
import sys
import tempfile
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, validator

router = APIRouter(prefix="/breakpoints", tags=["auto-breakpoints"])

ROOT_DIR = Path(__file__).resolve().parents[1]
LANGUAGE_SCRIPTS = {
    "cpp": ROOT_DIR / "scripts" / "cpp" / "predict_cpp_breakpoints.py",
    "python": ROOT_DIR / "scripts" / "python" / "predict_python_breakpoints.py",
    "javascript": ROOT_DIR / "scripts" / "javascript" / "predict_js_breakpoints.py",
    "java": ROOT_DIR / "scripts" / "java" / "predict_java_breakpoints.py",
    "go": ROOT_DIR / "scripts" / "go" / "predict_go_breakpoints.py",
}

SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
LINE_PATTERN = re.compile(r"^\s*[•*-]?\s*line\s+(\d+)\b", re.IGNORECASE)
MAX_FILE_BYTES = 200_000


def _normalize_newlines(content: str) -> str:
    """Force LF line-endings regardless of client platform."""
    content = content.replace("\r\n", "\n")
    content = content.replace("\r", "\n")
    return content


async def _run_predictor(script_path: Path, source_path: Path) -> str:
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        str(script_path),
        str(source_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        detail = (stderr or stdout or b"predictor failed").decode(errors="ignore").strip()
        raise HTTPException(status_code=500, detail=detail)
    return stdout.decode(errors="ignore")


def _parse_breakpoint_lines(raw_output: str) -> List[int]:
    lines: List[int] = []
    for raw_line in raw_output.splitlines():
        match = LINE_PATTERN.search(raw_line)
        if match:
            try:
                lines.append(int(match.group(1)))
            except ValueError:
                continue
    return lines


class SourceFile(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    content: str

    @validator("name")
    def _validate_name(cls, value: str) -> str:  # noqa: N805 (pydantic naming)
        if not SAFE_NAME.match(value):
            raise ValueError("filename may only include letters, numbers, dot, underscore, or dash")
        return value


class AutoBreakpointsRequest(BaseModel):
    language: str = Field(default="cpp", description="Language of the provided source files")
    files: List[SourceFile] = Field(..., min_items=1, max_items=5)

    @validator("language")
    def _validate_language(cls, value: str) -> str:  # noqa: N805
        lang = (value or "").strip().lower()
        if lang not in LANGUAGE_SCRIPTS:
            allowed = ", ".join(sorted(LANGUAGE_SCRIPTS))
            raise ValueError(f"language must be one of: {allowed}")
        return lang


class BreakpointResult(BaseModel):
    file: str
    line: int


class AutoBreakpointsResponse(BaseModel):
    breakpoints: List[BreakpointResult]


@router.post("/auto", response_model=AutoBreakpointsResponse)
async def generate_auto_breakpoints(payload: AutoBreakpointsRequest) -> AutoBreakpointsResponse:
    script_path = LANGUAGE_SCRIPTS[payload.language]
    if not script_path.exists():
        raise HTTPException(status_code=500, detail=f"predictor script not found for language '{payload.language}'")

    names_seen: set[str] = set()
    breakpoints: List[BreakpointResult] = []

    with tempfile.TemporaryDirectory(prefix="oc-autobp-") as tmpdir:
        tmp_dir = Path(tmpdir)
        for source in payload.files:
            if source.name in names_seen:
                raise HTTPException(status_code=400, detail=f"duplicate filename: {source.name}")
            names_seen.add(source.name)

            normalized = _normalize_newlines(source.content or "")
            byte_size = len(normalized.encode("utf-8", "ignore"))
            if byte_size > MAX_FILE_BYTES:
                raise HTTPException(status_code=400, detail=f"file too large (>{MAX_FILE_BYTES} bytes): {source.name}")

            file_path = tmp_dir / source.name
            with open(file_path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(normalized)

            stdout = await _run_predictor(script_path, file_path)
            for line_no in _parse_breakpoint_lines(stdout):
                breakpoints.append(BreakpointResult(file=source.name, line=line_no))

    return AutoBreakpointsResponse(breakpoints=breakpoints)
