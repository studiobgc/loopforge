"""
Effects API Routes

Optional audio processing effects including the Advanced Harmonic Filterbank.
Inspired by Harmonium (Trevor Treglia's SuperCollider instrument).
"""

from pathlib import Path
from typing import Optional, List
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core.database import get_db
from ..core.models import Asset, Session
from ..core.storage import get_storage
from ..engines.harmonic_filter import get_harmonic_filterbank, HarmonicFilterbank

router = APIRouter(prefix="/effects", tags=["Effects"])


# =============================================================================
# SCHEMAS
# =============================================================================

class HarmonicFilterRequest(BaseModel):
    """Request to apply advanced harmonic filterbank to audio."""
    session_id: str
    stem_path: str
    root_note: str = Field(..., description="Target root note (e.g., 'C', 'F#', 'Bb')")
    mode: str = Field(default="major", description="Scale: major, minor, chromatic, pentatonic, dorian")
    
    # Basic parameters
    num_harmonics: int = Field(default=16, ge=4, le=32, description="Number of harmonics")
    resonance: float = Field(default=0.5, ge=0.0, le=1.0, description="Filter resonance")
    mix: float = Field(default=1.0, ge=0.0, le=1.0, description="Dry/wet mix")
    
    # Advanced parameters (Harmonium-inspired)
    spectral_tilt: float = Field(default=0.0, ge=-12.0, le=12.0, description="dB/octave tilt (-=darker, +=brighter)")
    voicing: str = Field(default="natural", description="Voicing: natural, odd_only, fifth, spread, dense")
    motion: str = Field(default="static", description="Motion: static, breathe, pulse, shimmer, drift, follow, transient")
    motion_rate: float = Field(default=0.1, ge=0.0, le=10.0, description="LFO rate in Hz")
    motion_depth: float = Field(default=0.3, ge=0.0, le=1.0, description="Modulation depth")
    
    # Preset (overrides other params if set)
    preset: Optional[str] = Field(default=None, description="Preset: drone, crystalline, hollow, warm, ethereal")


class HarmonicFilterResponse(BaseModel):
    """Response from harmonic filterbank processing."""
    success: bool
    output_path: str
    output_url: str
    root_note: str
    mode: str
    num_harmonics: int
    resonance: float
    voicing: str
    motion: str
    spectral_tilt: float
    preset_used: Optional[str] = None


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/harmonic-filter", response_model=HarmonicFilterResponse)
async def apply_harmonic_filter(request: HarmonicFilterRequest):
    """
    Apply advanced harmonic filterbank to a stem.
    
    Inspired by Harmonium (Trevor Treglia's SuperCollider instrument).
    
    Features:
    - Time-varying resonant filters at harmonic intervals
    - Per-partial amplitude control (spectral tilt)
    - LFO modulation (breathe, pulse, shimmer, drift)
    - Multiple voicing modes (natural, odd_only, fifth, spread, dense)
    - Presets for quick creative results
    
    Non-destructive - creates a new processed file.
    """
    db = get_db()
    storage = get_storage()
    
    # Validate session
    with db.session() as session:
        sess = session.query(Session).filter(Session.id == request.session_id).first()
        if not sess:
            raise HTTPException(404, "Session not found")
    
    # Resolve input path
    input_path = storage.root / request.stem_path
    if not input_path.exists():
        raise HTTPException(404, f"Stem file not found: {request.stem_path}")
    
    # Validate root note
    valid_notes = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']
    if request.root_note not in valid_notes:
        raise HTTPException(400, f"Invalid root note")
    
    # Validate mode
    valid_modes = list(HarmonicFilterbank.SCALE_INTERVALS.keys())
    if request.mode not in valid_modes:
        raise HTTPException(400, f"Invalid mode. Options: {', '.join(valid_modes)}")
    
    # Validate voicing
    valid_voicings = ['natural', 'odd_only', 'fifth', 'spread', 'dense']
    if request.voicing not in valid_voicings:
        raise HTTPException(400, f"Invalid voicing. Options: {', '.join(valid_voicings)}")
    
    # Validate motion
    valid_motions = ['static', 'breathe', 'pulse', 'shimmer', 'drift', 'follow', 'transient']
    if request.motion not in valid_motions:
        raise HTTPException(400, f"Invalid motion. Options: {', '.join(valid_motions)}")
    
    # Validate preset if provided
    valid_presets = list(HarmonicFilterbank.PRESETS.keys())
    if request.preset and request.preset not in valid_presets:
        raise HTTPException(400, f"Invalid preset. Options: {', '.join(valid_presets)}")
    
    # Generate output filename
    stem_name = input_path.stem
    preset_suffix = f"_{request.preset}" if request.preset else ""
    output_filename = f"{stem_name}_harmonic_{request.root_note}_{request.mode}{preset_suffix}.wav"
    effects_dir = storage.root / "stems" / request.session_id / "effects"
    effects_dir.mkdir(parents=True, exist_ok=True)
    output_path = effects_dir / output_filename
    
    # Apply filterbank
    try:
        filterbank = get_harmonic_filterbank()
        result = filterbank.process_file(
            input_path=input_path,
            output_path=output_path,
            root_note=request.root_note,
            mode=request.mode,
            num_harmonics=request.num_harmonics,
            resonance=request.resonance,
            spectral_tilt=request.spectral_tilt,
            voicing=request.voicing,
            motion=request.motion,
            motion_rate=request.motion_rate,
            motion_depth=request.motion_depth,
            mix=request.mix,
            preset=request.preset,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Harmonic filter failed: {str(e)}")
    
    # Relative path for URL
    try:
        rel_path = str(output_path.resolve().relative_to(storage.root.resolve()))
    except Exception:
        rel_path = str(output_path)
    
    # Create asset record
    with db.session() as session:
        asset = Asset(
            session_id=request.session_id,
            filename=output_filename,
            file_path=str(output_path),
            asset_type="effect",
        )
        session.add(asset)
        session.commit()
    
    return HarmonicFilterResponse(
        success=True,
        output_path=rel_path,
        output_url=f"/files/{rel_path}",
        root_note=result.root_note,
        mode=result.mode,
        num_harmonics=result.num_harmonics,
        resonance=result.resonance,
        voicing=result.voicing,
        motion=result.motion,
        spectral_tilt=result.spectral_tilt,
        preset_used=request.preset,
    )


@router.get("/harmonic-filter/preview-frequencies")
async def preview_harmonic_frequencies(
    root_note: str,
    mode: str = "major",
    num_harmonics: int = 16
):
    """
    Preview the harmonic frequencies that will be used for filtering.
    Useful for understanding what the filterbank will extract.
    """
    valid_notes = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']
    if root_note not in valid_notes:
        raise HTTPException(400, f"Invalid root note")
    
    valid_modes = ['major', 'minor', 'chromatic']
    if mode not in valid_modes:
        raise HTTPException(400, f"Invalid mode")
    
    filterbank = get_harmonic_filterbank()
    frequencies = filterbank.get_harmonic_frequencies(root_note, mode, num_harmonics)
    
    return {
        "root_note": root_note,
        "mode": mode,
        "num_harmonics": num_harmonics,
        "frequencies": [round(f, 2) for f in frequencies],
        "frequency_count": len(frequencies),
    }
