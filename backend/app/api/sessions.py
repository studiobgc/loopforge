"""
Session API Routes

Sessions are the top-level container for a user's work.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from ..core.database import get_db
from ..core.models import Session, Job, JobType, JobStatus, Asset
from ..core.storage import get_storage
from ..core.queue import get_queue

router = APIRouter(prefix="/sessions", tags=["Sessions"])


# =============================================================================
# SCHEMAS
# =============================================================================

class SessionCreate(BaseModel):
    name: Optional[str] = None


class SessionResponse(BaseModel):
    id: str
    name: Optional[str]
    source_filename: Optional[str]
    bpm: Optional[float]
    key: Optional[str]
    duration_seconds: Optional[float]
    created_at: datetime
    stems: list[dict] = []
    jobs: list[dict] = []


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("", response_model=SessionResponse)
async def create_session(data: SessionCreate = SessionCreate()):
    """Create a new empty session"""
    db = get_db()
    
    with db.session() as session:
        new_session = Session(
            name=data.name,
            expires_at=datetime.utcnow() + timedelta(hours=24),
        )
        session.add(new_session)
        session.commit()
        session.refresh(new_session)
        
        return SessionResponse(
            id=new_session.id,
            name=new_session.name,
            source_filename=None,
            bpm=None,
            key=None,
            duration_seconds=None,
            created_at=new_session.created_at,
            stems=[],
            jobs=[],
        )


@router.post("/upload")
async def upload_and_process(
    file: UploadFile = File(...),
    auto_separate: bool = Form(True),
    auto_analyze: bool = Form(True),
    preview_duration: Optional[float] = Form(None),
):
    """
    Upload an audio file and optionally start processing.
    
    This is the main entry point - creates a session, saves the file,
    and queues separation/analysis jobs.
    """
    # Validate file
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    
    ext = Path(file.filename).suffix.lower()
    if ext not in [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aiff"]:
        raise HTTPException(400, f"Unsupported format: {ext}")
    
    db = get_db()
    storage = get_storage()
    queue = get_queue()
    
    # Create session
    with db.session() as session:
        new_session = Session(
            name=file.filename,
            source_filename=file.filename,
            expires_at=datetime.utcnow() + timedelta(hours=24),
        )
        session.add(new_session)
        session.commit()
        session.refresh(new_session)
        session_id = new_session.id
    
    # Save file (run blocking I/O in thread pool)
    import asyncio
    loop = asyncio.get_running_loop()
    file_path, content_hash = await loop.run_in_executor(
        None,  # Use default executor
        lambda: storage.save_upload(session_id, file.filename, file.file)
    )
    
    # Create source asset
    asset_id: Optional[str] = None
    with db.session() as session:
        asset = Asset(
            session_id=session_id,
            filename=file.filename,
            file_path=str(file_path),
            content_hash=content_hash,
            asset_type="source",
        )
        session.add(asset)
        session.commit()
        session.refresh(asset)
        asset_id = asset.id
    
    jobs = []
    
    # Queue separation job
    if auto_separate:
        sep_config = {}
        if preview_duration and preview_duration > 0:
            sep_config["preview_duration"] = preview_duration
        sep_job = queue.submit(
            session_id=session_id,
            job_type=JobType.SEPARATION,
            input_path=str(file_path),
            config=sep_config if sep_config else None,
        )
        jobs.append({"id": sep_job.id, "type": "separation", "preview": bool(preview_duration)})
    
    # Queue analysis job
    if auto_analyze:
        analysis_job = queue.submit(
            session_id=session_id,
            job_type=JobType.ANALYSIS,
            input_path=str(file_path),
        )
        jobs.append({"id": analysis_job.id, "type": "analysis"})

    # Queue moments detection (fast - runs in parallel with separation)
    moments_job = queue.submit(
        session_id=session_id,
        job_type=JobType.MOMENTS,
        input_path=str(file_path),
        config={"bias": "balanced"},
    )
    jobs.append({"id": moments_job.id, "type": "moments"})

    # Queue peaks generation (fast - for instant waveform rendering)
    peaks_job = queue.submit(
        session_id=session_id,
        job_type=JobType.PEAKS,
        input_path=str(file_path),
    )
    jobs.append({"id": peaks_job.id, "type": "peaks"})

    # Compute a relative path under storage root so the frontend can build a stable /files URL.
    rel_path: str
    try:
        rel_path = str(Path(str(file_path)).resolve().relative_to(storage.root.resolve()))
    except Exception:
        rel_path = str(file_path)

    return {
        "session_id": session_id,
        "filename": file.filename,
        "source": {
            "asset_id": asset_id,
            "path": rel_path,
            "url": f"/files/{rel_path}",
            "content_hash": content_hash,
        },
        "jobs": jobs,
    }


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    """Get session details including stems and jobs"""
    db = get_db()
    storage = get_storage()
    
    with db.session() as session:
        sess = session.query(Session).filter(Session.id == session_id).first()
        if not sess:
            raise HTTPException(404, "Session not found")
        
        # Get stems
        stems = []
        for asset in sess.assets:
            if asset.asset_type == "stem":
                rel_path: str
                try:
                    rel_path = str(Path(asset.file_path).resolve().relative_to(storage.root.resolve()))
                except Exception:
                    rel_path = asset.file_path
                stems.append({
                    "id": asset.id,
                    "name": asset.stem_role.value if asset.stem_role else "unknown",
                    "filename": asset.filename,
                    "path": rel_path,
                    # Per-stem analysis
                    "detected_key": asset.detected_key,
                    "detected_bpm": asset.detected_bpm,
                    "key_confidence": asset.key_confidence,
                })
        
        # Get jobs
        jobs = [job.to_dict() for job in sess.jobs]
        
        return SessionResponse(
            id=sess.id,
            name=sess.name,
            source_filename=sess.source_filename,
            bpm=sess.bpm,
            key=sess.key,
            duration_seconds=sess.duration_seconds,
            created_at=sess.created_at,
            stems=stems,
            jobs=jobs,
        )


@router.delete("/{session_id}")
async def delete_session(session_id: str):
    """Delete a session and all its data"""
    db = get_db()
    storage = get_storage()
    
    with db.session() as session:
        sess = session.query(Session).filter(Session.id == session_id).first()
        if not sess:
            raise HTTPException(404, "Session not found")
        
        session.delete(sess)
        session.commit()
    
    # Delete files
    storage.delete_session(session_id)
    
    return {"deleted": session_id}


@router.get("")
async def list_sessions(limit: int = 20, offset: int = 0):
    """List recent sessions"""
    db = get_db()
    
    with db.session() as session:
        sessions = session.query(Session).order_by(
            Session.created_at.desc()
        ).offset(offset).limit(limit).all()
        
        return {
            "sessions": [s.to_dict() for s in sessions],
            "limit": limit,
            "offset": offset,
        }
