"""
Loop Forge API

Clean, unified API routes.
All endpoints follow RESTful conventions.
"""

from fastapi import APIRouter

from .sessions import router as sessions_router
from .jobs import router as jobs_router
from .assets import router as assets_router
from .slices import router as slices_router
from .moments import router as moments_router
from .bounce import router as bounce_router
from .capabilities import router as capabilities_router
from .websocket import router as ws_router
from .grid import router as grid_router
from .embeddings import router as embeddings_router
from .effects import router as effects_router
from .filebrowser import router as filebrowser_router

# Main API router
api_router = APIRouter(prefix="/api")

# Health check endpoint
@api_router.get("/health")
async def health_check():
    """Health check endpoint for frontend connectivity."""
    return {"status": "ok", "service": "loopforge"}

# Include all sub-routers
api_router.include_router(sessions_router)
api_router.include_router(jobs_router)
api_router.include_router(assets_router)
api_router.include_router(slices_router)
api_router.include_router(moments_router)
api_router.include_router(bounce_router)
api_router.include_router(capabilities_router)
api_router.include_router(ws_router)
api_router.include_router(grid_router)
api_router.include_router(embeddings_router)
api_router.include_router(effects_router)
api_router.include_router(filebrowser_router)

__all__ = ['api_router']
