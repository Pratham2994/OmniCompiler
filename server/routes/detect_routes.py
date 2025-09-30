from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any
from ..controller.detector import detect as run_detect

router = APIRouter()

class MoreChunk(BaseModel):
    start: int = Field(..., ge=0)
    data: str

Mode = Literal["auto", "verify"]

class DetectRequest(BaseModel):
    first_chunk: str
    last_chunk: str
    more_chunks: Optional[List[MoreChunk]] = None
    total_len: Optional[int] = None
    n_bytes: Optional[int] = None
    mode: Mode = "auto"
    forced_lang: Optional[Literal["python","javascript","java","cpp","go"]] = None
    content_sha256: Optional[str] = None

class DetectResponse(BaseModel):
    status: Literal["ok","need_more","error"]
    lang: Optional[str] = None
    confidence: Optional[float] = None
    source: Optional[str] = None
    used_chunks: Optional[List[str]] = None
    request_ranges: Optional[List[Dict[str, int]]] = None
    reason: Optional[str] = None

@router.post("/detect", response_model=DetectResponse)
def detect_endpoint(req: DetectRequest):
    try:
        # Support both Pydantic v2 (model_dump) and v1 (dict)
        payload = req.model_dump() if hasattr(req, "model_dump") else req.dict()
        return run_detect(payload)
    except Exception:
        return DetectResponse(status="error", reason="internal_error")
