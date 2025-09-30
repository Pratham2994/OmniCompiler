from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio, json, tempfile, os, textwrap, shutil


from .run_routes import SESSIONS

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




USE_DOCKER = True



DOCKER_IMAGES = {
    "python": "omni-runner:python",
    "cpp": "omni-runner:cpp",
}

def _write_files(files, workdir):
    for f in files:
        path = os.path.join(workdir, f["name"])
        with open(path, "w", encoding="utf-8") as fp:
            fp.write(textwrap.dedent(f["content"]))

async def _start_process(lang, entry, args, workdir):
    """
    Start either a local process (dev mode) or a dockerized one (prod mode).
    """
    if USE_DOCKER:
        image = DOCKER_IMAGES.get(lang)
        if not image:
            raise ValueError(f"Unsupported lang for docker: {lang}")

        mount = f"{workdir}:/work:ro"

        if lang == "python":
            cmd = [
                "docker", "run", "--rm", "-i",
                "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
                "-v", mount, "-w", "/work",
                image,
                "python", entry, *args
            ]

        elif lang == "cpp":
            cmd = [
                "docker", "run", "--rm", "-i",
                "--network", "none", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
                "-v", mount, "-w", "/work",
                image,
                "/bin/sh", "-lc", f"g++ -O2 {entry} -o app && ./app {' '.join(args)}"
            ]

    else:
        # local fallback for dev/testing
        if lang == "python":
            cmd = ["python3", entry, *args]
        elif lang == "cpp":
            cmd = ["g++", entry, "-o", "app", "&&", "./app", *args]
        else:
            raise ValueError(f"Unsupported lang for local run: {lang}")

    return await asyncio.create_subprocess_exec(
        *cmd,
        cwd=workdir,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

@router.websocket("/ws/run/{sid}")
async def ws_run(ws: WebSocket, sid: str):
    await ws.accept()

    sess = SESSIONS.get(sid)
    if not sess:
        await ws.send_json({"type":"err","data":"invalid session_id"})
        return await ws.close()

    lang, entry, args, files = sess["lang"], sess["entry"], sess["args"], sess["files"]

    # create a temp folder and write files into it
    workdir = tempfile.mkdtemp(prefix=f"oc-{lang}-")
    _write_files(files, workdir)

    if not os.path.exists(os.path.join(workdir, entry)):
        await ws.send_json({"type":"err","data":f"entry not found: {entry}"})
        shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    try:
        proc = await _start_process(lang, entry, args, workdir)
    except Exception as e:
        await ws.send_json({"type":"err","data":str(e)})
        shutil.rmtree(workdir, ignore_errors=True)
        return await ws.close()

    await ws.send_json({"type":"status","phase":"running"})

    async def pump(reader, kind):
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                await ws.send_json({"type": kind, "data": line.decode(errors="ignore")})
        except Exception:
            pass

    t_out = asyncio.create_task(pump(proc.stdout, "out"))
    t_err = asyncio.create_task(pump(proc.stderr, "err"))

    WALL = 20
    async def watchdog():
        await asyncio.sleep(WALL)
        if proc.returncode is None:
            proc.kill()
    t_wd = asyncio.create_task(watchdog())

    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "in":
                data = msg.get("data", "")
                if proc.stdin and not proc.stdin.is_closing():
                    proc.stdin.write(data.encode())
                    await proc.stdin.drain()
            elif msg.get("type") == "close":
                proc.terminate()
            else:
                await ws.send_json({"type":"err","data": f"unknown msg: {msg}"})
    except WebSocketDisconnect:
        if proc.returncode is None:
            proc.kill()
    finally:
        rc = -1
        try:
            rc = await proc.wait()
        except Exception:
            pass
        for t in (t_out, t_err, t_wd):
            t.cancel()
        try:
            await ws.send_json({"type":"exit","code": rc})
        except Exception:
            pass
        await ws.close()
        shutil.rmtree(workdir, ignore_errors=True)
