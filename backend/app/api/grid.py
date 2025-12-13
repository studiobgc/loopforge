"""
Grid Analysis API - Beat and downbeat detection endpoints.

Provides musical grid analysis for tempo-aware slicing and sequencing.
"""

from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
from typing import Optional, Tuple

from ..engines.grid_engine import get_grid_engine, GridAnalysis
from ..core.storage import get_storage

router = APIRouter(prefix="/grid", tags=["grid"])


@router.get("/analyze/{session_id}")
async def analyze_grid(
    session_id: str,
    stem: Optional[str] = Query(None, description="Specific stem to analyze (drums, bass, vocals, other). If None, uses source."),
    time_signature_beats: int = Query(4, description="Beats per bar"),
    time_signature_unit: int = Query(4, description="Beat unit (e.g., 4 for quarter note)"),
) -> dict:
    """
    Analyze audio for beat grid detection.
    
    Returns BPM, beat positions, and downbeat positions.
    Best used on drums stem for most accurate results.
    """
    storage = get_storage()
    
    # Find the audio file
    if stem:
        # Use specific stem
        stem_path = (storage.root / "stems" / session_id / f"{stem}.wav").resolve()
        if not stem_path.exists():
            raise HTTPException(404, f"Stem '{stem}' not found for session")
        audio_path = stem_path
    else:
        # Use source file
        uploads_dir = storage.root / "uploads" / session_id
        if not uploads_dir.exists():
            raise HTTPException(404, "Session not found")
        
        source_files = [p for p in uploads_dir.iterdir() if p.is_file()]
        if not source_files:
            raise HTTPException(404, "Source audio not found")
        audio_path = source_files[0]
    
    # Analyze
    grid_engine = get_grid_engine()
    time_signature = (time_signature_beats, time_signature_unit)
    
    try:
        analysis = grid_engine.analyze(audio_path, time_signature)
        return {
            "session_id": session_id,
            "stem": stem,
            "grid": analysis.to_dict(),
        }
    except Exception as e:
        raise HTTPException(500, f"Grid analysis failed: {str(e)}")


@router.post("/quantize-slices/{slice_bank_id}")
async def quantize_slices_to_grid(
    slice_bank_id: str,
    strength: float = Query(1.0, ge=0.0, le=1.0, description="Quantization strength (0=none, 1=full)"),
    mode: str = Query("nearest", description="Quantization mode: nearest, floor, ceil"),
) -> dict:
    """
    Quantize slice boundaries to the beat grid.
    
    This aligns slice start times to musical beats for tighter sequencing.
    """
    from ..core.database import get_db
    from ..core.models import SliceBankRecord
    
    db = get_db()
    storage = get_storage()
    
    with db.session() as session:
        # Get slice bank
        bank = session.query(SliceBankRecord).filter_by(id=slice_bank_id).first()
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        # Get the source audio for grid analysis
        stems_dir = storage.root / "stems" / bank.session_id
        
        # Try to find the source stem
        stem_role = bank.stem_role.value if bank.stem_role else "drums"
        audio_path = stems_dir / f"{stem_role}.wav"
        
        if not audio_path.exists():
            # Fall back to source
            uploads_dir = storage.root / "uploads" / bank.session_id
            source_files = [p for p in uploads_dir.iterdir() if p.is_file()] if uploads_dir.exists() else []
            if not source_files:
                raise HTTPException(404, "Audio source not found")
            audio_path = source_files[0]
        
        # Analyze grid
        grid_engine = get_grid_engine()
        grid = grid_engine.analyze(audio_path)
        
        # Get current slice data
        slice_data = bank.slice_data or []
        
        # Quantize each slice's start time
        original_times = [s.get('start_time', 0) for s in slice_data]
        quantized_times = grid_engine.quantize_onsets_to_grid(
            original_times, grid, strength=strength, mode=mode
        )
        
        # Update slice data with quantized times
        for i, (s, new_start) in enumerate(zip(slice_data, quantized_times)):
            old_start = s.get('start_time', 0)
            shift = new_start - old_start
            
            s['start_time'] = new_start
            s['end_time'] = s.get('end_time', 0) + shift
            s['start_sample'] = int(new_start * 44100)
            s['end_sample'] = int(s.get('end_time', 0) * 44100)
        
        # Save updated slice bank
        bank.slice_data = slice_data
        session.commit()
        
        return {
            "slice_bank_id": slice_bank_id,
            "quantized_slices": len(slice_data),
            "grid_bpm": grid.bpm,
            "strength": strength,
            "mode": mode,
        }
