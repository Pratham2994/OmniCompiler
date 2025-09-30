from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid, re, time

router = APIRouter()

# In-memory sessions for now (you can import this in ws_routes later)
SESSIONS: dict[str, dict] = {}

# ---------- Models ----------
class FileSpec(BaseModel):
    name: str
    content: str

class RunReq(BaseModel):
    lang: str                      # e.g., "python" | "javascript"
    entry: str                     # e.g., "main.py"
    args: Optional[List[str]] = Field(default_factory=list)
    files: List[FileSpec]

class RunResp(BaseModel):
    session_id: str
    ws_url: str

# ---------- Validation helpers ----------
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,128}$")  # no slashes/paths, no spaces

def _is_safe_name(name: str) -> bool:
    return bool(SAFE_NAME.match(name))

def _validate_request(req: RunReq) -> None:
    # 1) filenames must be safe
    for f in req.files:
        if not _is_safe_name(f.name):
            raise HTTPException(status_code=400, detail=f"invalid filename: {f.name}")
    if not _is_safe_name(req.entry):
        raise HTTPException(status_code=400, detail=f"invalid entry: {req.entry}")

    # 2) entry must exist among files
    names = {f.name for f in req.files}
    if req.entry not in names:
        raise HTTPException(status_code=400, detail=f"entry file not found: {req.entry}")

    # 3) (optional) simple limits
    MAX_FILES = 50
    MAX_BYTES_PER_FILE = 200_000  # 200 KB/file (tweak as you need)
    if len(req.files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"too many files (>{MAX_FILES})")
    for f in req.files:
        if len(f.content.encode("utf-8", "ignore")) > MAX_BYTES_PER_FILE:
            raise HTTPException(status_code=400, detail=f"file too large: {f.name}")

def _build_ws_url(request: Request, sid: str) -> str:
    # Derive host from the incoming HTTP request; swap scheme http->ws, https->wss
    scheme = "wss" if request.url.scheme == "https" else "ws"
    host = request.headers.get("host") or request.url.netloc
    return f"{scheme}://{host}/ws/run/{sid}"

# ---------- Route ----------
@router.post("/run", response_model=RunResp)
def create_run(request: Request, body: RunReq) -> RunResp:
    _validate_request(body)

    sid = uuid.uuid4().hex
    SESSIONS[sid] = {
        "lang": body.lang,
        "entry": body.entry,
        "args": body.args or [],
        "files": [{"name": f.name, "content": f.content} for f in body.files],
        "state": "new",
        "created_at": time.time(),
    }

    return RunResp(session_id=sid, ws_url=_build_ws_url(request, sid))
