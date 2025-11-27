from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import importlib.util
import json
from pathlib import Path
import sys
import uuid

# Import with fallbacks so the module works whether loaded as a package or script
start_python_debug_container = None

if start_python_debug_container is None:
    try:
        from ..docker.dock_inter import start_python_debug_container  # type: ignore
    except ImportError:
        pass

if start_python_debug_container is None:
    try:
        from server.docker.dock_inter import start_python_debug_container  # type: ignore
    except ImportError:
        pass

if start_python_debug_container is None:
    # Last-resort: load by file path to avoid clashing with the docker PyPI package
    docker_path = Path(__file__).resolve().parent.parent / "docker" / "dock_inter.py"
    if docker_path.exists():
        spec = importlib.util.spec_from_file_location("omni_dock_inter", docker_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            sys.modules["omni_dock_inter"] = module
            spec.loader.exec_module(module)
            start_python_debug_container = module.start_python_debug_container

# Fail loudly if still not found (helps catch packaging errors early)
if start_python_debug_container is None:
    raise ImportError("Could not import start_python_debug_container from docker.dock_inter")

router = APIRouter()
DEBUG_S
@router.websocket("/ws/debug/{session_id}")
async def ws_debug(websocket: WebSocket, session_id: str):
    await websocket.accept()

    session = DEBUG_SESSIONS.get(session_id)
    if not session:
        await websocket.send_text(json.dumps({"error": "Invalid session"}))
        await websocket.close()
        return

    proc = session["proc"]

    try:
        # Read container stdout in background
        async def pump_stdout():
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                await websocket.send_text(line)

        import asyncio
        asyncio.create_task(pump_stdout())

        # Handle commands from user -> container stdin
        while True:
            msg = await websocket.receive_text()
            proc.stdin.write(msg + "\n")
            proc.stdin.flush()

    except WebSocketDisconnect:
        pass
    finally:
        proc.terminate()
        DEBUG_SESSIONS.pop(session_id, None)

e()
        DEBUG_SESSIONS.pop(session_id, None)

@router.post("/debug/start")
async def start_debug(files: dict, entrypoint: str):
    """
    files: { filename: code }
    entrypoint: "main.py"
    """
    session_id = str(uuid.uuid4())

    proc, workdir = start_python_debug_container(files, entrypoint)

    DEBUG_SESSIONS[session_id] = {
        "proc": proc,
        "workdir": workdir
    }

    return {
        "session_id": session_id,
        "ws_url": f"ws://localhost:8000/ws/debug/{session_id}"
    }
