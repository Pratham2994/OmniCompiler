from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.detect_routes import router as detect_router
from .routes.ws_routes import router as ws_router   

app = FastAPI(title="OmniCompiler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(detect_router)
app.include_router(ws_router)
