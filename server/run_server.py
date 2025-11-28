import os
import sys
import asyncio
import uvicorn


def main():
                                                                                      
    if os.name == "nt":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            print("[run] asyncio policy: WindowsProactorEventLoopPolicy", file=sys.stderr)
        except Exception as e:
            print(f"[run] failed to set policy: {e}", file=sys.stderr)

                            
                                                                                    
                                                                                    
                                                                                  
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", "8000")),
        reload=False,                                                 
        log_level="info",
    )


if __name__ == "__main__":
    main()