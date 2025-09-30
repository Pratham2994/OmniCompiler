from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

@router.websocket("/ws/echo")
async def ws_echo(ws: WebSocket):
    # accept the socket
    await ws.accept()
    # greet client
    await ws.send_json({"type": "welcome", "msg": "WS connected. Send {'type':'in','data':'hello'}"})
    try:
        while True:
            raw = await ws.receive_json()   # expects JSON
            if raw.get("type") == "in":
                # echo back the data
                await ws.send_json({"type": "out", "data": f"echo: {raw.get('data','')}"})
            else:
                await ws.send_json({"type": "err", "data": f"unknown message: {raw}"})
    except WebSocketDisconnect:
        # client closed the connection
        pass
