"""
Bounce/Resample API - The addictive "make → commit → remix" loop

Renders pattern audio to a new sample, then auto-slices it back to pads.
This is the Octatrack/Digitakt brain: commit your sketch, slice it, flip it again.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
import uuid
import numpy as np
import soundfile as sf
from pathlib import Path

from ..core.storage import STORAGE_ROOT

router = APIRouter(prefix="/bounce", tags=["bounce"])


class BounceRequest(BaseModel):
    session_id: str
    stem_id: str
    pattern_events: List[dict]  # [{beat, sliceIndex, velocity, microOffset}]
    bpm: float = 120.0
    bars: int = 4
    swing: float = 0.0
    name: Optional[str] = None


class BounceResponse(BaseModel):
    id: str
    path: str
    duration_seconds: float
    sample_rate: int


@router.post("/render", response_model=BounceResponse)
async def bounce_pattern(request: BounceRequest):
    """
    Render a pattern to audio file (offline bounce).
    
    Takes the pattern events and renders them to a new audio file,
    which can then be sliced and mapped back to pads.
    """
    from ..services.slicer import SlicerService
    
    # Calculate duration
    beats_per_bar = 4
    total_beats = beats_per_bar * request.bars
    duration_seconds = (total_beats / request.bpm) * 60
    
    # For now, return a stub - full implementation would:
    # 1. Load the slice bank audio
    # 2. Render each event at the correct time with velocity/swing
    # 3. Mix down to stereo
    # 4. Save to file
    # 5. Return path for auto-slicing
    
    bounce_id = str(uuid.uuid4())
    bounce_dir = Path(STORAGE_ROOT) / "bounces" / request.session_id
    bounce_dir.mkdir(parents=True, exist_ok=True)
    
    name = request.name or f"bounce_{bounce_id[:8]}"
    bounce_path = bounce_dir / f"{name}.wav"
    
    # Create silent audio for now (placeholder)
    sample_rate = 44100
    samples = int(duration_seconds * sample_rate)
    audio = np.zeros((samples, 2), dtype=np.float32)
    
    # TODO: Actually render the pattern events
    # This would involve:
    # - Loading slice buffers
    # - Placing each event at the correct sample position
    # - Applying velocity scaling
    # - Mixing down
    
    sf.write(str(bounce_path), audio, sample_rate)
    
    # Return relative path for frontend
    relative_path = f"bounces/{request.session_id}/{name}.wav"
    
    return BounceResponse(
        id=bounce_id,
        path=relative_path,
        duration_seconds=duration_seconds,
        sample_rate=sample_rate,
    )


@router.post("/render-and-slice")
async def bounce_and_slice(request: BounceRequest):
    """
    Bounce pattern to audio, then auto-slice it back to pads.
    
    This is the full resample ritual:
    1. Render pattern → audio file
    2. Detect transients
    3. Create slice bank
    4. Return slices ready for pad mapping
    """
    from ..services.slicer import SlicerService
    
    # First, render the bounce
    bounce_result = await bounce_pattern(request)
    
    # Then slice it
    slicer = SlicerService()
    bounce_path = Path(STORAGE_ROOT) / bounce_result.path
    
    try:
        bank = slicer.create_slice_bank(
            session_id=request.session_id,
            audio_path=str(bounce_path),
            role="other",  # Bounces are mixed content
        )
        
        return {
            "bounce": {
                "id": bounce_result.id,
                "path": bounce_result.path,
                "duration_seconds": bounce_result.duration_seconds,
            },
            "slice_bank": {
                "id": bank.id,
                "num_slices": len(bank.slices),
                "slices": [s.to_dict() for s in bank.slices],
            },
        }
    except Exception as e:
        # If slicing fails, still return the bounce
        return {
            "bounce": {
                "id": bounce_result.id,
                "path": bounce_result.path,
                "duration_seconds": bounce_result.duration_seconds,
            },
            "slice_bank": None,
            "error": str(e),
        }
