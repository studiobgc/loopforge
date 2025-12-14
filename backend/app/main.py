"""
StemSplit API - FastAPI backend for audio stem separation.
"""

import asyncio
import uuid
import traceback
from pathlib import Path
from typing import Dict
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .model_manager import get_model_manager, get_separator
from .forge_routes import router as forge_router
from .slice_routes import router as slice_router
from .api import api_router


# Storage paths
UPLOAD_DIR = Path("./uploads")
OUTPUT_DIR = Path("./outputs")

# Active jobs and WebSocket connections
jobs: Dict[str, dict] = {}
connections: Dict[str, WebSocket] = {}

# Thread pool for CPU-bound separation (legacy - use get_executor() from forge_service for new code)
# Keeping this for backward compatibility with main.py endpoints
executor = ThreadPoolExecutor(max_workers=2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize on startup with CTO-level model management."""
    UPLOAD_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)
    
    # Initialize model manager and preload critical models
    print("[STARTUP] Initializing model manager...")
    model_manager = get_model_manager()
    
    # Preload Demucs in background (non-blocking)
    print("[STARTUP] Pre-loading Demucs model (background)...")
    preload_thread = model_manager.preload_critical_models()
    
    # Wait a moment for initial load, but don't block startup
    import asyncio
    await asyncio.sleep(0.5)
    
    print("[STARTUP] Ready! (Models loading in background)")
    
    yield
    
    # Cleanup on shutdown
    print("[SHUTDOWN] Cleaning up models and resources...")
    
    # Cleanup expired sessions
    from .services.session_manager import session_manager
    expired_count = session_manager.cleanup_expired_sessions()
    if expired_count > 0:
        print(f"[SHUTDOWN] Cleaned up {expired_count} expired sessions")
    
    # Cleanup models
    model_manager.cleanup()
    
    # Shutdown thread pools gracefully
    executor.shutdown(wait=True)
    from .services.forge_service import get_executor
    forge_executor = get_executor()
    forge_executor.shutdown(wait=True)
    
    print("[SHUTDOWN] Cleanup complete")


app = FastAPI(
    title="StemSplit API",
    description="Underground stem separation",
    version="1.0.0",
    lifespan=lifespan
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include VocalForge routes
app.include_router(forge_router)

# Include Slice Sequencer routes
app.include_router(slice_router)

# Include unified API routes (sessions, effects, slices, etc.)
app.include_router(api_router)

# Mount static file serving for previews
app.mount("/api/forge/stream", StaticFiles(directory="./forge_outputs"), name="stream")

# Mount storage directory for file serving (uploads, stems, etc.)
from pathlib import Path
storage_dir = Path("./storage")
storage_dir.mkdir(exist_ok=True)
app.mount("/files", StaticFiles(directory=str(storage_dir)), name="files")


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "alive", "message": "UNDERGROUND RESISTANCE"}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Upload audio file and start separation job.
    Returns job_id for WebSocket progress tracking.
    """
    # Validate file type
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    
    ext = Path(file.filename).suffix.lower()
    if ext not in [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aiff"]:
        raise HTTPException(400, f"Unsupported format: {ext}")
    
    # Create job
    job_id = str(uuid.uuid4())
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    # Save uploaded file
    input_path = job_dir / f"input{ext}"
    with open(input_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    # Initialize job state
    jobs[job_id] = {
        "id": job_id,
        "filename": file.filename,
        "input_path": input_path,
        "output_dir": OUTPUT_DIR / job_id,
        "status": "queued",
        "stems": {}
    }
    
    # Start processing in background
    asyncio.create_task(process_job(job_id))
    
    return {"job_id": job_id, "filename": file.filename}


async def send_update(job_id: str, update: dict):
    """Send update to WebSocket client."""
    ws = connections.get(job_id)
    if ws:
        try:
            await ws.send_json({"job_id": job_id, **update})
        except Exception as e:
            print(f"[WS] Send error: {e}")


def run_separation(job_id: str, input_path: Path, output_dir: Path, progress_queue) -> dict:
    """Run separation in thread (blocking)."""
    print(f"[JOB {job_id[:8]}] Starting separation...")
    separator = get_separator()
    
    def progress_callback(stage, pct, msg):
        progress_queue.put({"stage": stage, "progress": pct, "message": msg})
    
    return separator.separate_sync(input_path, output_dir, progress_callback)


async def process_job(job_id: str):
    """Process separation job with progress updates."""
    import queue
    
    job = jobs.get(job_id)
    if not job:
        return
    
    job["status"] = "processing"
    await send_update(job_id, {"stage": "processing", "progress": 0, "message": "Starting..."})
    
    # Thread-safe queue for progress updates
    progress_queue = queue.Queue()
    
    try:
        loop = asyncio.get_event_loop()
        
        # Start separation in thread pool
        future = loop.run_in_executor(
            executor,
            run_separation,
            job_id,
            job["input_path"],
            job["output_dir"],
            progress_queue
        )
        
        # Poll for progress updates while separation runs
        while not future.done():
            try:
                # Check for progress updates (non-blocking)
                while True:
                    try:
                        update = progress_queue.get_nowait()
                        await send_update(job_id, update)
                    except queue.Empty:
                        break
                await asyncio.sleep(0.1)
            except Exception:
                pass
        
        # Get result
        output_paths = await future
        
        # Send any remaining progress updates
        while not progress_queue.empty():
            update = progress_queue.get_nowait()
            await send_update(job_id, update)
        
        # Store stem paths
        job["stems"] = {name: str(path) for name, path in output_paths.items()}
        job["status"] = "complete"
        
        print(f"[JOB {job_id[:8]}] Complete!")
        await send_update(job_id, {
            "stage": "complete",
            "status": "complete",
            "progress": 100,
            "stems": list(output_paths.keys())
        })
            
    except Exception as e:
        print(f"[JOB {job_id[:8]}] Error: {e}")
        traceback.print_exc()
        job["status"] = "error"
        job["error"] = str(e)
        await send_update(job_id, {"stage": "error", "error": str(e)})


@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    """WebSocket for real-time progress updates."""
    await websocket.accept()
    connections[job_id] = websocket
    print(f"[WS] Connected: {job_id[:8]}")
    
    try:
        # Send current state
        job = jobs.get(job_id)
        if job:
            await websocket.send_json({
                "job_id": job_id,
                "status": job.get("status", "unknown"),
                "message": "Connected"
            })
        
        # Keep alive - wait for job completion or disconnect
        while True:
            job = jobs.get(job_id)
            if job and job.get("status") in ("complete", "error"):
                # Job done, can close after a moment
                await asyncio.sleep(2)
                break
            
            # Send ping every 10s
            try:
                await asyncio.sleep(10)
                await websocket.send_json({"ping": True})
            except:
                break
                
    except WebSocketDisconnect:
        print(f"[WS] Disconnected: {job_id[:8]}")
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        connections.pop(job_id, None)


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    """Get job status."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "id": job["id"],
        "status": job["status"],
        "stems": list(job.get("stems", {}).keys())
    }


@app.get("/api/download/{job_id}/{stem}")
async def download_stem(job_id: str, stem: str):
    """Download a separated stem."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    
    if stem not in job.get("stems", {}):
        raise HTTPException(404, f"Stem '{stem}' not found")
    
    stem_path = Path(job["stems"][stem])
    if not stem_path.exists():
        raise HTTPException(404, "Stem file not found")
    
    # Get original filename without extension
    original_name = Path(job["filename"]).stem
    
    return FileResponse(
        stem_path,
        media_type="audio/wav",
        filename=f"{original_name}_{stem}.wav"
    )


@app.get("/api/download/{job_id}")
async def download_all(job_id: str):
    """Download all stems as zip."""
    import zipfile
    import io
    
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    
    if job["status"] != "complete":
        raise HTTPException(400, "Job not complete")
    
    # Create zip in memory
    original_name = Path(job["filename"]).stem
    zip_path = job["output_dir"] / f"{original_name}_stems.zip"
    
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for stem_name, stem_path in job["stems"].items():
            zf.write(stem_path, f"{original_name}_{stem_name}.wav")
    
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{original_name}_stems.zip"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
