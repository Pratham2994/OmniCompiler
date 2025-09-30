from fastapi import FastAPI
from .routes.detect_routes import router as detect_router
 
app = FastAPI(title="OmniCompiler")
 
@app.get("/health")
def health():
    return {"ok": True}
 
app.include_router(detect_router)
