import os
import sys
import asyncio
import uvicorn


def main():
    # Ensure Proactor loop is set BEFORE uvicorn creates any event loop (Windows only)
    if os.name == "nt":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            print("[run] asyncio policy: WindowsProactorEventLoopPolicy", file=sys.stderr)
        except Exception as e:
            print(f"[run] failed to set policy: {e}", file=sys.stderr)

    # Important for Windows:
    # Uvicorn's --reload path can force a Selector event loop internally on Windows,
    # which breaks asyncio subprocess. To guarantee Proactor-based loop for workers,
    # run without reload here. Use a separate terminal for client dev auto-reload.
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", "8000")),
        reload=False,  # guarantee Proactor loop in workers on Windows
        log_level="info",
    )


if __name__ == "__main__":
    main()