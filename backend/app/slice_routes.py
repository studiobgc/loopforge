"""
Slice Sequencer API Routes

Endpoints for:
- Creating slice banks from separated stems
- Generating trigger sequences
- Real-time slice playback coordination
- Rule management
"""

import asyncio
import uuid
import json
from pathlib import Path
from typing import Optional, List
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .engines.slice_engine import SliceEngine, SliceBank, SliceRole, slice_audio
from .engines.trigger_engine import (
    TriggerEngine, TriggerMode, TriggerEvent, TriggerRule,
    TriggerSource, GridTriggerSource, EuclideanTriggerSource,
    MIDITriggerSource, ProbabilityTriggerSource, TransientFollowSource,
    create_trigger_engine, TRIGGER_PRESETS
)
from .services.session_manager import session_manager

# Router
router = APIRouter(prefix="/api/slice", tags=["SliceSequencer"])

# Storage
SLICE_DATA_DIR = Path("./slice_data")
SLICE_DATA_DIR.mkdir(exist_ok=True)

# Thread pool for CPU-bound operations
_executor = ThreadPoolExecutor(max_workers=4)

# In-memory cache for slice banks (keyed by session_id + stem_role)
_slice_bank_cache: dict = {}


# =============================================================================
# MODELS
# =============================================================================

class CreateSliceBankRequest(BaseModel):
    session_id: str
    stem_path: str
    role: str = "unknown"  # drums, bass, vocals, other, unknown
    bpm: Optional[float] = None
    key: Optional[str] = None


class GenerateSequenceRequest(BaseModel):
    session_id: str
    slice_bank_id: str
    duration_beats: float = 16.0
    bpm: float = 120.0
    mode: str = "sequential"  # sequential, random, probability, euclidean, chaos
    preset: Optional[str] = None  # Use a preset configuration
    
    # Euclidean parameters
    euclidean_hits: Optional[int] = None
    euclidean_steps: Optional[int] = None
    euclidean_rotation: Optional[int] = 0
    
    # Grid parameters
    subdivision: Optional[float] = 1.0
    
    # Probability parameters
    probabilities: Optional[List[float]] = None
    
    # Follow mode
    follow_bank_id: Optional[str] = None
    follow_delay_beats: Optional[float] = 0.0


class AddRuleRequest(BaseModel):
    session_id: str
    slice_bank_id: str
    name: str
    condition: str
    action: str
    probability: float = 1.0


class TriggerSourceConfig(BaseModel):
    type: str  # grid, euclidean, probability, midi
    params: dict = Field(default_factory=dict)


class UpdateEngineRequest(BaseModel):
    session_id: str
    slice_bank_id: str
    mode: Optional[str] = None
    trigger_source: Optional[TriggerSourceConfig] = None
    rules: Optional[List[dict]] = None


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def _get_cache_key(session_id: str, identifier: str) -> str:
    return f"{session_id}:{identifier}"


def _save_slice_bank(bank: SliceBank, session_id: str) -> Path:
    """Save slice bank to disk and cache"""
    output_dir = SLICE_DATA_DIR / session_id
    output_dir.mkdir(parents=True, exist_ok=True)
    
    output_path = output_dir / f"{bank.id}.json"
    bank.save(output_path)
    
    # Cache it
    cache_key = _get_cache_key(session_id, bank.id)
    _slice_bank_cache[cache_key] = bank
    
    return output_path


def _get_slice_bank(session_id: str, bank_id: str) -> Optional[SliceBank]:
    """Get slice bank from cache or disk"""
    cache_key = _get_cache_key(session_id, bank_id)
    
    # Check cache
    if cache_key in _slice_bank_cache:
        return _slice_bank_cache[cache_key]
    
    # Try loading from disk
    bank_path = SLICE_DATA_DIR / session_id / f"{bank_id}.json"
    if bank_path.exists():
        bank = SliceBank.load(bank_path)
        _slice_bank_cache[cache_key] = bank
        return bank
    
    return None


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/create-bank")
async def create_slice_bank(request: CreateSliceBankRequest):
    """
    Create a SliceBank from an audio file.
    
    This analyzes the audio, detects transients, and creates
    slices with spectral analysis for intelligent triggering.
    """
    stem_path = Path(request.stem_path)
    if not stem_path.exists():
        raise HTTPException(404, f"Audio file not found: {request.stem_path}")
    
    # Map role string to enum
    try:
        role = SliceRole(request.role)
    except ValueError:
        role = SliceRole.UNKNOWN
    
    # Create slice bank in thread pool (CPU-bound)
    loop = asyncio.get_event_loop()
    
    def _create_bank():
        engine = SliceEngine()
        return engine.create_slice_bank(
            stem_path,
            role=role,
            bpm=request.bpm,
            key=request.key,
        )
    
    bank = await loop.run_in_executor(_executor, _create_bank)
    
    # Save and cache
    _save_slice_bank(bank, request.session_id)
    
    return {
        "slice_bank_id": bank.id,
        "num_slices": len(bank.slices),
        "total_duration": bank.total_duration,
        "role": bank.role.value,
        "slices": [
            {
                "index": s.index,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "duration": s.duration,
                "energy": s.rms_energy,
                "transient_strength": s.transient_strength,
                "brightness": s.spectral_centroid,
            }
            for s in bank.slices
        ],
        "statistics": {
            "mean_energy": bank.mean_energy,
            "max_energy": bank.max_energy,
            "energy_variance": bank.energy_variance,
        }
    }


@router.get("/bank/{session_id}/{bank_id}")
async def get_slice_bank(session_id: str, bank_id: str):
    """Get a slice bank by ID"""
    bank = _get_slice_bank(session_id, bank_id)
    if not bank:
        raise HTTPException(404, "Slice bank not found")
    
    return {
        "slice_bank_id": bank.id,
        "source_filename": bank.source_filename,
        "num_slices": len(bank.slices),
        "total_duration": bank.total_duration,
        "role": bank.role.value,
        "bpm": bank.bpm,
        "key": bank.key,
        "slices": [s.to_dict() for s in bank.slices],
    }


@router.get("/banks/{session_id}")
async def list_slice_banks(session_id: str):
    """List all slice banks for a session"""
    session_dir = SLICE_DATA_DIR / session_id
    if not session_dir.exists():
        return {"banks": []}
    
    banks = []
    for bank_file in session_dir.glob("*.json"):
        try:
            bank = SliceBank.load(bank_file)
            banks.append({
                "id": bank.id,
                "source_filename": bank.source_filename,
                "role": bank.role.value,
                "num_slices": len(bank.slices),
                "total_duration": bank.total_duration,
            })
        except Exception as e:
            print(f"Error loading bank {bank_file}: {e}")
    
    return {"banks": banks}


@router.post("/generate-sequence")
async def generate_sequence(request: GenerateSequenceRequest):
    """
    Generate a trigger sequence for a slice bank.
    
    This is the core of the Autechre-style generative sequencing.
    """
    bank = _get_slice_bank(request.session_id, request.slice_bank_id)
    if not bank:
        raise HTTPException(404, "Slice bank not found")
    
    # Use preset if specified
    if request.preset and request.preset in TRIGGER_PRESETS:
        engine = create_trigger_engine(request.preset)
    else:
        # Build trigger source based on mode
        try:
            mode = TriggerMode(request.mode)
        except ValueError:
            mode = TriggerMode.SEQUENTIAL
        
        trigger_source = None
        
        if mode == TriggerMode.EUCLIDEAN:
            trigger_source = EuclideanTriggerSource(
                hits=request.euclidean_hits or 5,
                steps=request.euclidean_steps or 8,
                rotation=request.euclidean_rotation or 0,
            )
        elif mode == TriggerMode.PROBABILITY:
            trigger_source = ProbabilityTriggerSource(
                steps=len(request.probabilities) if request.probabilities else 16,
                probabilities=request.probabilities,
                subdivision=request.subdivision or 1.0,
            )
        elif mode == TriggerMode.FOLLOW and request.follow_bank_id:
            follow_bank = _get_slice_bank(request.session_id, request.follow_bank_id)
            if follow_bank:
                trigger_source = TransientFollowSource(delay_beats=request.follow_delay_beats or 0.0)
                trigger_source.set_from_slice_bank(follow_bank, request.bpm)
        else:
            trigger_source = GridTriggerSource(subdivision=request.subdivision or 1.0)
        
        engine = TriggerEngine(mode=mode, trigger_source=trigger_source)
    
    # Generate sequence
    events = engine.generate_sequence(
        num_slices=len(bank.slices),
        duration_beats=request.duration_beats,
        bpm=request.bpm,
        slice_bank=bank,
    )
    
    return {
        "slice_bank_id": bank.id,
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
                "description": _get_preset_description(name),
            }
            for name, config in TRIGGER_PRESETS.items()
        ]
    }


def _get_preset_description(name: str) -> str:
    """Get human-readable description for presets"""
    descriptions = {
        'linear': 'Play slices in order, one per beat',
        'sixteenth_notes': 'Play slices in order, four per beat (16th notes)',
        'euclidean_5_8': 'Euclidean rhythm: 5 hits distributed over 8 steps',
        'euclidean_7_16': 'Euclidean rhythm: 7 hits distributed over 16 steps',
        'autechre_basic': 'Generative mode with skip rules (Autechre-style)',
        'autechre_glitch': 'Glitchy generative mode with probability and pitch rules',
    }
    return descriptions.get(name, 'No description available')


@router.post("/add-rule")
async def add_rule(request: AddRuleRequest):
    """Add a conditional rule to a slice bank's trigger engine"""
    rule = TriggerRule(
        id=str(uuid.uuid4()),
        name=request.name,
        condition=request.condition,
        action=request.action,
        probability=request.probability,
    )
    
    # Store rule (in production, this would be persisted)
    # For now, we return the rule for client-side management
    return {
        "rule": rule.to_dict(),
        "message": "Rule created. Add to generate-sequence request to apply.",
    }


@router.get("/rule-options")
async def get_rule_options():
    """Get available conditions and actions for rules"""
    return {
        "conditions": [
            {"pattern": "consecutive_plays > N", "description": "Same slice played N times in a row"},
            {"pattern": "consecutive_plays >= N", "description": "Same slice played at least N times"},
            {"pattern": "total_plays > N", "description": "Any slice played more than N times total"},
            {"pattern": "total_plays % N", "description": "Every Nth trigger (modulo)"},
            {"pattern": "slice_index == N", "description": "Specific slice index was played"},
            {"pattern": "slice_index != N", "description": "Slice index is not N"},
        ],
        "actions": [
            {"name": "skip_next", "description": "Skip the next trigger"},
            {"name": "pitch_up_N", "description": "Raise pitch by N semitones (e.g., pitch_up_2)"},
            {"name": "pitch_down_N", "description": "Lower pitch by N semitones"},
            {"name": "reverse", "description": "Play slice backwards"},
            {"name": "random_slice", "description": "Pick a random slice instead"},
            {"name": "reset_sequence", "description": "Reset to beginning of sequence"},
            {"name": "half_velocity", "description": "Reduce velocity by half"},
            {"name": "double_velocity", "description": "Double velocity (capped at 1.0)"},
        ],
    }


@router.post("/export-slice/{session_id}/{bank_id}/{slice_index}")
async def export_slice(session_id: str, bank_id: str, slice_index: int):
    """Export a single slice to a file"""
    bank = _get_slice_bank(session_id, bank_id)
    if not bank:
        raise HTTPException(404, "Slice bank not found")
    
    if slice_index < 0 or slice_index >= len(bank.slices):
        raise HTTPException(400, f"Invalid slice index: {slice_index}")
    
    slice_obj = bank.slices[slice_index]
    
    # Export slice
    output_dir = SLICE_DATA_DIR / session_id / "exports"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    output_filename = f"{bank.source_filename.rsplit('.', 1)[0]}_slice_{slice_index}.wav"
    output_path = output_dir / output_filename
    
    loop = asyncio.get_event_loop()
    
    def _export():
        engine = SliceEngine()
        return engine.export_slice(
            Path(bank.source_path),
            slice_obj,
            output_path,
        )
    
    await loop.run_in_executor(_executor, _export)
    
    return FileResponse(
        output_path,
        media_type="audio/wav",
        filename=output_filename,
    )


# =============================================================================
# WEBSOCKET FOR REAL-TIME TRIGGERING
# =============================================================================

class SequencerState:
    """Manages state for a real-time sequencer session"""
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.is_playing = False
        self.current_beat = 0.0
        self.bpm = 120.0
        self.events: List[TriggerEvent] = []
        self.current_event_index = 0


_sequencer_states: dict[str, SequencerState] = {}


@router.websocket("/ws/{session_id}")
async def sequencer_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket for real-time sequencer control and sync.
    
    Messages:
    - {"type": "load_sequence", "events": [...], "bpm": 120}
    - {"type": "play"}
    - {"type": "stop"}
    - {"type": "seek", "beat": 4.0}
    - {"type": "set_bpm", "bpm": 140}
    
    Server sends:
    - {"type": "trigger", "event": {...}, "beat": 4.0}
    - {"type": "beat", "beat": 4.0}
    - {"type": "state", "is_playing": true, "beat": 4.0}
    """
    await websocket.accept()
    
    state = SequencerState(session_id)
    _sequencer_states[session_id] = state
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "load_sequence":
                state.events = [TriggerEvent.from_dict(e) for e in data.get("events", [])]
                state.bpm = data.get("bpm", 120.0)
                state.current_event_index = 0
                state.current_beat = 0.0
                await websocket.send_json({
                    "type": "loaded",
                    "num_events": len(state.events),
                })
            
            elif msg_type == "play":
                state.is_playing = True
                await websocket.send_json({
                    "type": "state",
                    "is_playing": True,
                    "beat": state.current_beat,
                })
                # Start playback loop
                asyncio.create_task(_playback_loop(websocket, state))
            
            elif msg_type == "stop":
                state.is_playing = False
                await websocket.send_json({
                    "type": "state",
                    "is_playing": False,
                    "beat": state.current_beat,
                })
            
            elif msg_type == "seek":
                state.current_beat = data.get("beat", 0.0)
                # Find the right event index
                state.current_event_index = 0
                for i, event in enumerate(state.events):
                    if event.time > state.current_beat:
                        break
                    state.current_event_index = i
                await websocket.send_json({
                    "type": "state",
                    "is_playing": state.is_playing,
                    "beat": state.current_beat,
                })
            
            elif msg_type == "set_bpm":
                state.bpm = data.get("bpm", 120.0)
            
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        state.is_playing = False
        if session_id in _sequencer_states:
            del _sequencer_states[session_id]


async def _playback_loop(websocket: WebSocket, state: SequencerState):
    """Background loop that sends trigger events in time"""
    beat_duration = 60.0 / state.bpm
    tick_interval = beat_duration / 24  # 24 ticks per beat (like MIDI)
    
    while state.is_playing:
        # Check for events to trigger
        while (state.current_event_index < len(state.events) and 
               state.events[state.current_event_index].time <= state.current_beat):
            event = state.events[state.current_event_index]
            try:
                await websocket.send_json({
                    "type": "trigger",
                    "event": event.to_dict(),
                    "beat": state.current_beat,
                })
            except:
                state.is_playing = False
                return
            state.current_event_index += 1
        
        # Send beat updates (every beat)
        if state.current_beat % 1.0 < tick_interval:
            try:
                await websocket.send_json({
                    "type": "beat",
                    "beat": int(state.current_beat),
                })
            except:
                state.is_playing = False
                return
        
        # Advance time
        await asyncio.sleep(tick_interval)
        state.current_beat += tick_interval / beat_duration
        
        # Loop back if we've played all events
        if state.current_event_index >= len(state.events):
            state.current_event_index = 0
            state.current_beat = 0.0
