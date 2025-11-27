from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Dict
import asyncio, uuid, json, shutil

# adjust this import to match your structure
try:
    from ..oc_docker.dock_inter import start_python_debug_container
except ImportError:
    # Fallback if imported as top-level `routes.debug_routes`
    from oc_docker.dock_inter import start_python_debug_container

router = APIRouter()

DEBUG_SESSIONS: Dict[str, dict] = {}


class DebugStartRequest(BaseModel):
    entrypoint: str
    files: Dict[str, str]


@router.post("/debug/start")
async def start_debug(payload: DebugStartRequest):
    entrypoint = payload.entrypoint
    files = payload.files

    proc, workdir = start_python_debug_container(files, entrypoint)

    sid = str(uuid.uuid4())
    DEBUG_SESSIONS[sid] = {"proc": proc, "workdir": workdir}

    # ws_url is just for testing; frontend will build it itself later
    return {
        "session_id": sid,
        "ws_url": f"ws://localhost:8000/ws/debug/{sid}",
    }


@router.websocket("/ws/debug/{session_id}")
async def ws_debug(ws: WebSocket, session_id: str):
    await ws.accept()

    session = DEBUG_SESSIONS.get(session_id)
    if not session:
        await ws.send_json(
            {"event": "error", "body": {"message": "invalid debug session"}}
        )
        await ws.close()
        return

    proc = session["proc"]
    workdir = session["workdir"]

    loop = asyncio.get_running_loop()

    async def pump_stdout():
        """Read lines from the debugger process and forward them to the client."""
        try:
            while True:
                # blocking readline() in a thread
                line = await loop.run_in_executor(None, proc.stdout.readline)
                if not line:
                    break
                line = line.rstrip("\n")

                # Try to parse debugger JSON events
                try:
                    obj = json.loads(line)
                    await ws.send_json(obj)
                except json.JSONDecodeError:
                    # Treat as plain program output
                    await ws.send_json(
                        {"event": "output", "body": {"text": line}}
                    )
        except Exception as e:
            try:
                await ws.send_json(
                    {"event": "error", "body": {"message": str(e)}}
                )
            except Exception:
                pass

    stdout_task = asyncio.create_task(pump_stdout())

    try:
        # Main loop: forward client commands → debugger stdin
        while True:
            msg = await ws.receive_text()
            if proc.poll() is not None:
                # process already exited
                break
            proc.stdin.write(msg + "\n")
            proc.stdin.flush()
    except WebSocketDisconnect:
        pass
    finally:
        # cleanup
        try:
            if proc.poll() is None:
                proc.terminate()
                await loop.run_in_executor(None, proc.wait)
        except Exception:
            pass

        stdout_task.cancel()
        DEBUG_SESSIONS.pop(session_id, None)
        shutil.rmtree(workdir, ignore_errors=True)

        await ws.close()
