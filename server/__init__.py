import os
import asyncio

# Ensure an event loop policy that supports subprocess on Windows.
# This must run as early as possible (package import) so Uvicorn picks it up
# before creating the event loop. On Windows, ProactorEventLoop supports
# asyncio subprocess APIs, while SelectorEventLoop does not.
try:
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
except Exception:
    # Best-effort; if this fails, ws_routes will still fall back to Popen.
    pass

# Optional diagnostic so you can verify which policy is active at import time.
try:
    _pol = type(asyncio.get_event_loop_policy()).__name__
    print(f"[init] asyncio event loop policy: {_pol}")
except Exception:
    pass