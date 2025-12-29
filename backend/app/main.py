"""
Loop Forge API - v2

Clean architecture with:
- Persistent SQLite state
- Background job queue
- Event-driven WebSocket updates
- Unified API routes
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .core.database import init_db
from .core.queue import get_queue, Worker
from .core.storage import get_storage
from .core import workers  # Import to register workers
from .api import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle management.
    
    Startup:
    - Initialize database
    - Initialize storage directories
    - Start job queue
    - Register workers
    
    Shutdown:
    - Gracefully stop job queue
    - Cleanup resources
    """
    import asyncio
    print("[STARTUP] Initializing Loop Forge...")
    
    # Store main event loop for cross-thread event publishing
    from .core.events import get_event_bus
    event_bus = get_event_bus()
    event_bus.set_main_loop(asyncio.get_running_loop())
    
    # Initialize core systems
    db = init_db()
    storage = get_storage()
    queue = get_queue()
    
    # Register job processors
    Worker.register_all(queue)
    
    # Start background queue
    await queue.start()
    
    # Skip preloading - load on first request to avoid startup deadlocks
    # from .model_manager import get_model_manager
    # model_manager = get_model_manager()
    # print("[STARTUP] Pre-loading Demucs model (background)...")
    # model_manager.preload_critical_models()
    print("[STARTUP] Model loading deferred to first request")
    
    print("[STARTUP] Ready!")
    
    yield
    
    # Shutdown
    print("[SHUTDOWN] Stopping job queue...")
    await queue.stop()
    
    print("[SHUTDOWN] Complete")


# Create FastAPI app
app = FastAPI(
    title="Loop Forge API",
    description="Generative sample laboratory",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS - allow all for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include unified API routes
app.include_router(api_router)

# Mount static files for audio streaming
storage = get_storage()
if storage.root.exists():
    app.mount("/files", StaticFiles(directory=str(storage.root)), name="files")


# Health check
@app.get("/health")
async def health():
    """Comprehensive health check with subsystem status"""
    from .core.database import get_db
    from .core.queue import get_queue
    from .core.events import EventBus
    
    status = "ok"
    checks = {}
    
    # Database check
    try:
        from sqlalchemy import text
        db = get_db()
        with db.session() as session:
            session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {str(e)[:50]}"
        status = "degraded"
    
    # Queue check
    try:
        queue = get_queue()
        checks["queue"] = "ok" if queue._running else "stopped"
        checks["active_jobs"] = len(queue._active_jobs)
    except Exception as e:
        checks["queue"] = f"error: {str(e)[:50]}"
        status = "degraded"
    
    # Event loop check
    checks["event_loop"] = "ok" if EventBus._main_loop and EventBus._main_loop.is_running() else "not set"
    
    return {
        "status": status,
        "version": "2.0.0",
        "message": "How we play the system dictates how the system responds",
        "checks": checks,
    }


# Root redirect to health
@app.get("/")
async def root():
    return {"message": "Loop Forge API", "docs": "/docs"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
