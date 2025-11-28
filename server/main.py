import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

                                                                                  
                                                                              
                                                                                          
try:
    import asyncio              
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())                       
except Exception:
                                                               
    pass

                            
try:
    from dotenv import load_dotenv                
except Exception:
    load_dotenv = None                                             

                                                        
_env_path = Path(__file__).resolve().parent / ".env"
if load_dotenv:
                                                                       
    load_dotenv(dotenv_path=str(_env_path) if _env_path.exists() else None)

                                        
FASTAPI_TITLE = os.getenv("FASTAPI_TITLE", "OmniCompiler")
                                                                          
_allow_origins_raw = os.getenv("ALLOW_ORIGINS", "http://localhost:5173")
ALLOW_ORIGINS = [o.strip() for o in _allow_origins_raw.split(",") if o.strip()]

                                                                  
                                                                                     
                                                   
                                       
try:
    from .routes.detect_routes import router as detect_router
    from .routes.run_routes import router as run_router
    from .routes.ws_routes import router as ws_router
    from .routes.translate_routes import router as translate_router
    from .routes.cfg_routes import router as cfg_router
    from .routes.insight_routes import router as insight_router
    from .routes.breakpoint_routes import router as breakpoint_router

except ImportError:
    try:
        from server.routes.detect_routes import router as detect_router
        from server.routes.ws_routes import router as ws_router
        from server.routes.run_routes import router as run_router
        from server.routes.translate_routes import router as translate_router
        from server.routes.cfg_routes import router as cfg_router
        from server.routes.insight_routes import router as insight_router
        from server.routes.breakpoint_routes import router as breakpoint_router
        from server.routes.run_routes import router as run_router 
    except ImportError:
        from routes.detect_routes import router as detect_router
        from routes.ws_routes import router as ws_router
        from routes.run_routes import router as run_router
        from routes.translate_routes import router as translate_router
        from routes.cfg_routes import router as cfg_router
        from routes.insight_routes import router as insight_router
        from routes.breakpoint_routes import router as breakpoint_router
        from routes.run_routes import router as run_router 

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
app.include_router(translate_router)
app.include_router(cfg_router)
app.include_router(insight_router)
app.include_router(breakpoint_router)
