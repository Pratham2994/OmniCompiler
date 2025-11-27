import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure subprocess support on Windows (needed for asyncio.create_subprocess_exec)
# Note: On Windows, subprocess support is provided by the Proactor event loop.
# SelectorEventLoop does NOT implement subprocess APIs and will raise NotImplementedError.
try:
    import asyncio  # noqa: E402
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())  # supports subprocess
except Exception:
    # Best-effort; if this fails we fall back to default policy
    pass

# Load environment variables
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None  # fallback if python-dotenv isn't installed

# Resolve .env located alongside this file (server/.env)
_env_path = Path(__file__).resolve().parent / ".env"
if load_dotenv:
    # Prefer explicit path to ensure loading when run from project root
    load_dotenv(dotenv_path=str(_env_path) if _env_path.exists() else None)

# Config from ENV with sensible defaults
FASTAPI_TITLE = os.getenv("FASTAPI_TITLE", "OmniCompiler")
# Comma-separated list, e.g. "http://localhost:5173,http://127.0.0.1:5173"
_allow_origins_raw = os.getenv("ALLOW_ORIGINS", "http://localhost:5173")
ALLOW_ORIGINS = [o.strip() for o in _allow_origins_raw.split(",") if o.strip()]

# Fixed routing imports with compatibility for different run modes
# 1) package-relative (recommended): uvicorn server.main:app --reload (cwd=repo root)
# 2) absolute package: when 'server' is on sys.path
# 3) script mode from server/ directory
try:
    from .routes.detect_routes import router as detect_router
    from .routes.run_routes import router as run_router 
    from .routes.ws_routes import router as ws_router

    from .routes.debug_routes import router as debug_router

except ImportError:
    try:
        from server.routes.detect_routes import router as detect_router
        from server.routes.ws_routes import router as ws_router
        from server.routes.run_routes import router as run_router 
        from server.routes.debug_routes import router as debug_router
    except ImportError:
        from routes.detect_routes import router as detect_router
        from routes.ws_routes import router as ws_router
        from routes.run_routes import router as run_router 
        from routes.debug_routes import router as debug_router

app = FastAPI(title=FASTAPI_TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(detect_router)
app.include_router(run_router) 
app.include_router(ws_router)
app.include_router(debug_router)
