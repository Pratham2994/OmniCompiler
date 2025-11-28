import os
import time
import json
import hashlib
import threading
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any
try:
    from ..controller.detector import detect as run_detect
except ImportError:
    try:
        from server.controller.detector import detect as run_detect
    except ImportError:
        from controller.detector import detect as run_detect

router = APIRouter()

                                                                                      
                           
                                                                               
                                                                            
_DETECT_CACHE_TTL = int(os.getenv("DETECT_CACHE_TTL_SECONDS", "0"))                          
_DETECT_CACHE_MAX_ENTRIES = int(os.getenv("DETECT_CACHE_MAX_ENTRIES", "256"))

_detect_cache: Dict[str, Dict[str, Any]] = {}
_detect_cache_ts: Dict[str, float] = {}
_detect_cache_lock = threading.Lock()

def _make_cache_key(payload: Dict[str, Any]) -> str:
                                                            
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()

def _prune_cache(now: float) -> None:
                 
    if _DETECT_CACHE_TTL > 0:
        expired = [k for k, ts in _detect_cache_ts.items() if now - ts > _DETECT_CACHE_TTL]
        for k in expired:
            _detect_cache.pop(k, None)
            _detect_cache_ts.pop(k, None)
                                  
    if len(_detect_cache) > _DETECT_CACHE_MAX_ENTRIES:
        by_age = sorted(_detect_cache_ts.items(), key=lambda kv: kv[1])
        overflow = len(_detect_cache) - _DETECT_CACHE_MAX_ENTRIES
        for k, _ in by_age[: max(0, overflow)]:
            _detect_cache.pop(k, None)
            _detect_cache_ts.pop(k, None)

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
                                                             
        payload: Dict[str, Any] = req.model_dump() if hasattr(req, "model_dump") else req.dict()

                                                                                                  
        key = _make_cache_key(payload)
        now = time.time()
        with _detect_cache_lock:
            if key in _detect_cache:
                if _DETECT_CACHE_TTL == 0 or (now - _detect_cache_ts.get(key, 0.0) <= _DETECT_CACHE_TTL):
                    return _detect_cache[key]

                              
        result = run_detect(payload)

                                              
        if hasattr(result, "model_dump"):
            result_dict = result.model_dump()                              
        elif isinstance(result, dict):
            result_dict = result
        else:
            try:
                result_dict = dict(result)                          
            except Exception:
                result_dict = {"status": "error", "reason": "unserializable_result"}

                        
        with _detect_cache_lock:
            _prune_cache(now)
            _detect_cache[key] = result_dict
            _detect_cache_ts[key] = now

        return result_dict
    except Exception:
        return DetectResponse(status="error", reason="internal_error")
