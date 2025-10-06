# dock_inter.py
import docker
import tarfile
import io
import threading
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()

IMAGE_PY = "omni-runner:python"
IMAGE_CPP = "omni-runner:cpp"
HOST_FOLDER = "./test_code"
IN_CONTAINER_DIR = "/work"

client = docker.from_env()

def make_tar_bytes(folder_path: str, arcname: str) -> bytes:
    bio = io.BytesIO()
    with tarfile.open(fileobj=bio, mode='w') as tar:
        tar.add(folder_path, arcname=arcname)
    bio.seek(0)
    return bio.read()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # optional: pass ?lang=cpp to try C++
    await websocket.accept()
    lang = websocket.query_params.get("lang", "py").lower()

    if lang == "cpp":
        image = IMAGE_CPP
        command = "sh -c 'g++ /work/test_code/hello.cpp -o /work/test_code/hello && /work/test_code/hello'"
    else:
        image = IMAGE_PY
        command = "python -u /work/test_code/hello.py"

    # 1) Create container (interactive)
    container = client.containers.create(
        image=image,
        command=command,
        working_dir=IN_CONTAINER_DIR,
        stdin_open=True,
        tty=True,
        detach=True,
        # recommended in prod:
        # mem_limit="512m", nano_cpus=1_000_000_000, network_disabled=True, user="1000:1000"
    )

    try:
        # 2) Copy code BEFORE start
        tar_bytes = make_tar_bytes(HOST_FOLDER, arcname="test_code")
        container.put_archive(IN_CONTAINER_DIR, tar_bytes)

        # 3) Start container
        container.start()

        # 4) Attach a bidirectional socket (Windows => NpipeSocket; no ._sock)
        sock = container.attach_socket(params={
            "stdin": 1, "stdout": 1, "stderr": 1, "stream": 1, "logs": 1
        })
        if hasattr(sock, "setblocking"):
            sock.setblocking(True)

        # Bridge from blocking socket -> async websocket using a thread + queue
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[bytes] = asyncio.Queue()
        stop_flag = {"stop": False}

        def reader_thread():
            try:
                while not stop_flag["stop"]:
                    chunk = sock.recv(65536)
                    if not chunk:
                        break
                    # hand off to async loop
                    loop.call_soon_threadsafe(q.put_nowait, chunk)
            except Exception:
                pass
            finally:
                loop.call_soon_threadsafe(q.put_nowait, b"\n[process closed]\n")

        t = threading.Thread(target=reader_thread, daemon=True)
        t.start()

        # 5) Two async tasks: one to send container output, one to receive input
        async def pump_container_stdout():
            try:
                while True:
                    data = await q.get()
                    if not data:
                        break
                    await websocket.send_text(data.decode(errors="ignore"))
            except WebSocketDisconnect:
                # client closed; stop reading
                pass

        async def pump_client_stdin():
            try:
                while True:
                    msg = await websocket.receive_text()
                    # send to container stdin
                    try:
                        sock.sendall((msg + "\n").encode())
                    except BrokenPipeError:
                        break
            except WebSocketDisconnect:
                # client closed
                pass

        sender = asyncio.create_task(pump_container_stdout())
        receiver = asyncio.create_task(pump_client_stdin())

        # Wait for either side to complete
        done, pending = await asyncio.wait(
            {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()

    finally:
        # signal thread to stop and cleanup container
        try:
            stop_flag["stop"] = True
        except Exception:
            pass
        try:
            container.wait(timeout=2)
        except Exception:
            pass
        try:
            container.stop(timeout=1)
        except Exception:
            pass
        try:
            container.remove(force=True)
        except Exception:
            pass
