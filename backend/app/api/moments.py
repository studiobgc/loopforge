"""
Moments API - Octatrack-style region detection for long audio files
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os

from ..services.moments import detect_moments, MomentType
from ..core.storage import STORAGE_ROOT

router = APIRouter(prefix="/moments", tags=["moments"])


class DetectMomentsRequest(BaseModel):
    audio_path: str
    bias: str = "balanced"  # hits, phrases, textures, balanced


class CreateRegionSlicesRequest(BaseModel):
    session_id: str
    audio_path: str
    start_time: float
    end_time: float
    role: str = "unknown"


@router.post("/detect")
async def detect_audio_moments(request: DetectMomentsRequest):
    """
    Detect moments (hits, phrases, textures, changes) in an audio file.
    
    For long voice memos and samples, this finds the interesting regions
    so you can quickly navigate and create slice banks from specific parts.
    """
    # Resolve path relative to storage root
    audio_path = request.audio_path
    if not os.path.isabs(audio_path):
        audio_path = os.path.join(str(STORAGE_ROOT), audio_path)

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail=f"Audio file not found: {request.audio_path}")

    try:
        moments = detect_moments(audio_path, bias=request.bias)
        
        # Group by type for easier frontend consumption
        by_type = {
            "hits": [m for m in moments if m["type"] == "hit"],
            "phrases": [m for m in moments if m["type"] == "phrase"],
            "textures": [m for m in moments if m["type"] == "texture"],
            "changes": [m for m in moments if m["type"] == "change"],
        }
        
        return {
            "audio_path": request.audio_path,
            "bias": request.bias,
            "total_moments": len(moments),
            "moments": moments,
            "by_type": by_type,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to detect moments: {str(e)}")


@router.post("/region-slices")
async def create_region_slices(request: CreateRegionSlicesRequest):
    """
    Create a slice bank from a specific region (Mark In/Out workflow).
    
    This is the Octatrack-style "select a region, send to pads" flow.
    """
    from ..services.slicer import SlicerService
    from ..core.database import get_db
    
    audio_path = request.audio_path
    if not os.path.isabs(audio_path):
        audio_path = os.path.join(str(STORAGE_ROOT), audio_path)

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail=f"Audio file not found: {request.audio_path}")

    try:
        slicer = SlicerService()
        
        # Create slice bank for just this region
        bank = slicer.create_slice_bank(
            session_id=request.session_id,
            audio_path=audio_path,
            role=request.role,
            start_time=request.start_time,
            end_time=request.end_time,
        )
        
        return {
            "id": bank.id,
            "source_path": request.audio_path,
            "role": request.role,
            "region": {
                "start_time": request.start_time,
                "end_time": request.end_time,
                "duration": request.end_time - request.start_time,
            },
            "num_slices": len(bank.slices),
            "slices": [s.to_dict() for s in bank.slices],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create region slices: {str(e)}")
