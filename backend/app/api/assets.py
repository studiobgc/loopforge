"""
Assets API Routes

Download and manage audio files.
"""

from pathlib import Path
import subprocess
import zipfile
import tempfile
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..core.database import get_db
from ..core.models import Asset, Session
from ..core.storage import get_storage

router = APIRouter(prefix="/assets", tags=["Assets"])


def _generate_peaks(file_path: Path) -> Optional[Path]:
    """Generate binary peaks (.dat) using audiowaveform. Returns path or None."""
    output_path = file_path.with_suffix(".dat")
    if output_path.exists():
        return output_path
    try:
        subprocess.run(
            ["audiowaveform", "-i", str(file_path), "-o", str(output_path), "-b", "8"],
            check=True,
            capture_output=True,
        )
        return output_path
    except FileNotFoundError:
        return None
    except subprocess.CalledProcessError:
        return None


@router.get("/{asset_id}")
async def get_asset(asset_id: str):
    """Get asset metadata"""
    db = get_db()
    
    with db.session() as session:
        asset = session.query(Asset).filter(Asset.id == asset_id).first()
        if not asset:
            raise HTTPException(404, "Asset not found")
        
        return asset.to_dict()


@router.get("/{asset_id}/download")
async def download_asset(asset_id: str):
    """Download an asset file"""
    db = get_db()
    
    with db.session() as session:
        asset = session.query(Asset).filter(Asset.id == asset_id).first()
        if not asset:
            raise HTTPException(404, "Asset not found")
        
        file_path = Path(asset.file_path)
        if not file_path.exists():
            raise HTTPException(404, "File not found on disk")
        
        return FileResponse(
            file_path,
            media_type="audio/wav",
            filename=asset.filename,
        )


@router.get("/session/{session_id}/stems")
async def list_stems(session_id: str):
    """List all stems for a session"""
    db = get_db()
    
    with db.session() as session:
        assets = session.query(Asset).filter(
            Asset.session_id == session_id,
            Asset.asset_type == "stem"
        ).all()
        
        return {
            "stems": [
                {
                    "id": a.id,
                    "name": a.stem_role.value if a.stem_role else "unknown",
                    "filename": a.filename,
                    "path": a.file_path,
                }
                for a in assets
            ]
        }


@router.get("/session/{session_id}/download/{stem_name}")
async def download_stem(session_id: str, stem_name: str):
    """Download a specific stem by name"""
    db = get_db()
    storage = get_storage()
    
    stems = storage.get_stems(session_id)
    
    if stem_name not in stems:
        raise HTTPException(404, f"Stem '{stem_name}' not found")
    
    file_path = stems[stem_name]
    
    # Get original filename from session
    with db.session() as session:
        sess = session.query(Session).filter(Session.id == session_id).first()
        original_name = sess.source_filename.rsplit(".", 1)[0] if sess and sess.source_filename else "audio"
    
    return FileResponse(
        file_path,
        media_type="audio/wav",
        filename=f"{original_name}_{stem_name}.wav",
    )


@router.get("/session/{session_id}/download-all")
async def download_all_stems(session_id: str):
    """Download all stems as a ZIP file"""
    db = get_db()
    storage = get_storage()
    
    stems = storage.get_stems(session_id)
    
    if not stems:
        raise HTTPException(404, "No stems found")
    
    # Get original filename
    with db.session() as session:
        sess = session.query(Session).filter(Session.id == session_id).first()
        original_name = sess.source_filename.rsplit(".", 1)[0] if sess and sess.source_filename else "audio"
    
    # Create ZIP in temp location
    zip_path = storage.get_cache_path(f"{session_id}_stems", ".zip")
    
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for stem_name, stem_path in stems.items():
            zf.write(stem_path, f"{original_name}_{stem_name}.wav")
    
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{original_name}_stems.zip",
    )


@router.get("/{asset_id}/peaks")
async def get_asset_peaks(asset_id: str):
    """Get or generate waveform peaks for an asset (binary .dat for peaks.js)"""
    db = get_db()
    
    with db.session() as session:
        asset = session.query(Asset).filter(Asset.id == asset_id).first()
        if not asset:
            raise HTTPException(404, "Asset not found")
        
        file_path = Path(asset.file_path)
        if not file_path.exists():
            raise HTTPException(404, "Source file not found")
        
        peaks_path = _generate_peaks(file_path)
        if not peaks_path or not peaks_path.exists():
            raise HTTPException(503, "Peaks generation failed (audiowaveform not installed?)")
        
        return FileResponse(
            peaks_path,
            media_type="application/octet-stream",
            filename=f"{asset.filename}.dat",
        )


@router.get("/session/{session_id}/source/peaks")
async def get_source_peaks(session_id: str):
    """Get or generate waveform peaks for a session's source file"""
    db = get_db()
    
    with db.session() as session:
        asset = session.query(Asset).filter(
            Asset.session_id == session_id,
            Asset.asset_type == "source"
        ).first()
        if not asset:
            raise HTTPException(404, "Source asset not found")
        
        file_path = Path(asset.file_path)
        if not file_path.exists():
            raise HTTPException(404, "Source file not found")
        
        peaks_path = _generate_peaks(file_path)
        if not peaks_path or not peaks_path.exists():
            raise HTTPException(503, "Peaks generation failed")
        
        return FileResponse(
            peaks_path,
            media_type="application/octet-stream",
            filename=f"{asset.filename}.dat",
        )
