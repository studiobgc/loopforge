"""
Slices API Routes

Transient-based slicing and generative sequencing.
The Autechre-inspired core of Loop Forge.
"""

from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.database import get_db
from ..core.models import SliceBankRecord, TriggerSequence, JobType, StemRole
from ..core.queue import get_queue
from ..core.storage import get_storage
from ..engines.slice_engine import SliceEngine, SliceRole
from ..engines.trigger_engine import (
    TriggerEngine, TriggerMode, TriggerEvent,
    GridTriggerSource, EuclideanTriggerSource, ProbabilityTriggerSource,
    TRIGGER_PRESETS, create_trigger_engine
)

router = APIRouter(prefix="/slices", tags=["Slices"])


# =============================================================================
# SCHEMAS
# =============================================================================

class CreateSliceBankRequest(BaseModel):
    session_id: str
    stem_path: str
    role: str = "unknown"
    bpm: Optional[float] = None
    key: Optional[str] = None


class GenerateSequenceRequest(BaseModel):
    session_id: str
    slice_bank_id: str
    duration_beats: float = 16.0
    bpm: float = 120.0
    mode: str = "sequential"
    preset: Optional[str] = None
    
    # Euclidean
    euclidean_hits: Optional[int] = None
    euclidean_steps: Optional[int] = None
    euclidean_rotation: int = 0
    
    # Grid
    subdivision: float = 1.0
    
    # Probability
    probabilities: Optional[List[float]] = None


# =============================================================================
# SLICE BANK ENDPOINTS
# =============================================================================

@router.post("/banks")
async def create_slice_bank(request: CreateSliceBankRequest):
    """
    Create a slice bank from an audio file.
    
    Detects transients and analyzes each slice spectrally.
    """
    storage = get_storage()
    stem_path = Path(request.stem_path)
    if not stem_path.is_absolute():
        stem_path = (storage.root / stem_path).resolve()

    if not stem_path.exists():
        raise HTTPException(404, f"Audio file not found: {stem_path}")
    
    try:
        role = SliceRole(request.role)
    except ValueError:
        role = SliceRole.UNKNOWN
    
    # Create slice bank
    engine = SliceEngine()
    bank = engine.create_slice_bank(
        stem_path,
        role=role,
        bpm=request.bpm,
        key=request.key,
    )
    
    # Persist to database
    db = get_db()
    with db.session() as session:
        # Map SliceRole to StemRole
        try:
            stem_role = StemRole(request.role)
        except ValueError:
            stem_role = StemRole.UNKNOWN
        
        record = SliceBankRecord(
            id=bank.id,
            session_id=request.session_id,
            source_filename=bank.source_filename,
            stem_role=stem_role,
            num_slices=len(bank.slices),
            total_duration=bank.total_duration,
            mean_energy=bank.mean_energy,
            max_energy=bank.max_energy,
            energy_variance=bank.energy_variance,
            slice_data=[s.to_dict() for s in bank.slices],
        )
        session.add(record)
        session.commit()

    return {
        "id": bank.id,
        "source_filename": bank.source_filename,
        "role": bank.role.value,
        "num_slices": len(bank.slices),
        "total_duration": bank.total_duration,
        "slices": [s.to_dict() for s in bank.slices],
        "statistics": {
            "mean_energy": bank.mean_energy,
            "max_energy": bank.max_energy,
            "energy_variance": bank.energy_variance,
        },
    }


@router.get("/banks/{session_id}")
async def list_slice_banks(session_id: str):
    """List all slice banks for a session"""
    db = get_db()
    
    with db.session() as session:
        banks = session.query(SliceBankRecord).filter(
            SliceBankRecord.session_id == session_id
        ).all()
        
        return {
            "banks": [
                {
                    "id": b.id,
                    "source_filename": b.source_filename,
                    "role": b.stem_role.value if b.stem_role else "unknown",
                    "num_slices": b.num_slices,
                    "total_duration": b.total_duration,
                }
                for b in banks
            ]
        }


@router.get("/banks/{session_id}/{bank_id}")
async def get_slice_bank(session_id: str, bank_id: str):
    """Get a slice bank with all slices"""
    db = get_db()
    
    with db.session() as session:
        bank = session.query(SliceBankRecord).filter(
            SliceBankRecord.id == bank_id,
            SliceBankRecord.session_id == session_id,
        ).first()
        
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        return {
            "id": bank.id,
            "source_filename": bank.source_filename,
            "role": bank.stem_role.value if bank.stem_role else "unknown",
            "num_slices": bank.num_slices,
            "total_duration": bank.total_duration,
            "slices": bank.slice_data,
            "statistics": {
                "mean_energy": bank.mean_energy,
                "max_energy": bank.max_energy,
                "energy_variance": bank.energy_variance,
            }
        }


# =============================================================================
# SEQUENCE GENERATION
# =============================================================================

@router.post("/sequences/generate")
async def generate_sequence(request: GenerateSequenceRequest):
    """
    Generate a trigger sequence using the specified mode.
    
    This is the core generative engine.
    """
    db = get_db()
    
    # Load slice bank
    with db.session() as session:
        bank = session.query(SliceBankRecord).filter(
            SliceBankRecord.id == request.slice_bank_id,
        ).first()
        
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        num_slices = bank.num_slices
        slice_data = bank.slice_data
    
    # Create engine
    if request.preset and request.preset in TRIGGER_PRESETS:
        engine = create_trigger_engine(request.preset)
    else:
        try:
            mode = TriggerMode(request.mode)
        except ValueError:
            mode = TriggerMode.SEQUENTIAL
        
        # Build trigger source
        if mode == TriggerMode.EUCLIDEAN:
            trigger_source = EuclideanTriggerSource(
                hits=request.euclidean_hits or 5,
                steps=request.euclidean_steps or 8,
                rotation=request.euclidean_rotation,
            )
        elif mode == TriggerMode.PROBABILITY:
            trigger_source = ProbabilityTriggerSource(
                steps=len(request.probabilities) if request.probabilities else 16,
                probabilities=request.probabilities,
                subdivision=request.subdivision,
            )
        else:
            trigger_source = GridTriggerSource(subdivision=request.subdivision)
        
        engine = TriggerEngine(mode=mode, trigger_source=trigger_source)
    
    # Generate sequence
    events = engine.generate_sequence(
        num_slices=num_slices,
        duration_beats=request.duration_beats,
        bpm=request.bpm,
    )
    
    # Save sequence
    with db.session() as session:
        seq = TriggerSequence(
            session_id=request.session_id,
            slice_bank_id=request.slice_bank_id,
            duration_beats=request.duration_beats,
            bpm=request.bpm,
            mode=engine.mode.value,
            config={
                "subdivision": request.subdivision,
                "euclidean_hits": request.euclidean_hits,
                "euclidean_steps": request.euclidean_steps,
            },
            events=[e.to_dict() for e in events],
            num_events=len(events),
        )
        session.add(seq)
        session.commit()
        sequence_id = seq.id
    
    return {
        "sequence_id": sequence_id,
        "slice_bank_id": request.slice_bank_id,
        "duration_beats": request.duration_beats,
        "bpm": request.bpm,
        "mode": engine.mode.value,
        "num_events": len(events),
        "events": [e.to_dict() for e in events],
    }


@router.get("/presets")
async def list_presets():
    """List available trigger presets"""
    return {
        "presets": [
            {
                "name": name,
                "mode": config['mode'].value,
            }
            for name, config in TRIGGER_PRESETS.items()
        ]
    }


# =============================================================================
# RULE OPTIONS
# =============================================================================

@router.get("/rules/options")
async def get_rule_options():
    """Get available conditions and actions for rules"""
    return {
        "conditions": [
            {"pattern": "consecutive_plays > N", "description": "Same slice played N times in a row"},
            {"pattern": "total_plays > N", "description": "Any slice played more than N times"},
            {"pattern": "total_plays % N", "description": "Every Nth trigger"},
            {"pattern": "slice_index == N", "description": "Specific slice was played"},
        ],
        "actions": [
            {"name": "skip_next", "description": "Skip the next trigger"},
            {"name": "pitch_up_N", "description": "Raise pitch by N semitones"},
            {"name": "pitch_down_N", "description": "Lower pitch by N semitones"},
            {"name": "reverse", "description": "Play slice backwards"},
            {"name": "random_slice", "description": "Pick a random slice"},
            {"name": "half_velocity", "description": "Reduce velocity by half"},
        ],
    }
