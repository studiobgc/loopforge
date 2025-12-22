"""
Footwork Production API - Drum synthesis and pattern generation endpoints.

Provides TR-808 style drum synthesis and footwork pattern generation.
"""

from fastapi import APIRouter, HTTPException, Query, Body
from pathlib import Path
from typing import Optional, List, Dict, Any
import numpy as np
import soundfile as sf
import io
import base64

from ..engines.footwork_drum_engine import FootworkDrumEngine
from ..engines.trigger_engine import (
    TriggerEngine, TriggerMode, TRIGGER_PRESETS,
    PolyrhythmicTriggerSource, JukePatternTriggerSource,
    OffbeatTriggerSource, MicroTimingTriggerSource,
    TriggerSource,
)
from ..core.storage import get_storage

router = APIRouter(prefix="/footwork", tags=["footwork"])

# Initialize drum engine
_drum_engine = FootworkDrumEngine(sample_rate=44100)


@router.post("/synthesize-drum")
async def synthesize_drum(
    drum_type: str = Body(..., description="Drum type: 'kick', 'snare', or 'hat'"),
    freq_start: Optional[float] = Body(60.0, description="Kick start frequency (Hz)"),
    freq_end: Optional[float] = Body(20.0, description="Kick end frequency (Hz)"),
    decay: Optional[float] = Body(0.5, description="Decay time (seconds)"),
    saturation: Optional[float] = Body(0.0, description="Saturation amount (0-1)"),
    duration: Optional[float] = Body(0.5, description="Duration (seconds)"),
) -> dict:
    """
    Synthesize a TR-808 style drum hit.
    
    Returns base64-encoded WAV audio data.
    """
    try:
        # Validate parameters
        if drum_type not in ['kick', 'snare', 'hat']:
            raise HTTPException(400, f"Invalid drum_type: {drum_type}. Must be 'kick', 'snare', or 'hat'")
        
        if freq_start is not None and (freq_start < 10 or freq_start > 500):
            raise HTTPException(400, f"freq_start must be between 10 and 500 Hz, got {freq_start}")
        
        if freq_end is not None and (freq_end < 10 or freq_end > 500):
            raise HTTPException(400, f"freq_end must be between 10 and 500 Hz, got {freq_end}")
        
        if decay is not None and (decay <= 0 or decay > 5.0):
            raise HTTPException(400, f"decay must be between 0 and 5.0 seconds, got {decay}")
        
        if saturation is not None and (saturation < 0 or saturation > 1):
            raise HTTPException(400, f"saturation must be between 0 and 1, got {saturation}")
        
        if duration is not None and (duration <= 0 or duration > 5.0):
            raise HTTPException(400, f"duration must be between 0 and 5.0 seconds, got {duration}")
        
        if drum_type == 'kick':
            audio = _drum_engine.synthesize_kick(
                freq_start=freq_start or 60.0,
                freq_end=freq_end or 20.0,
                decay=decay or 0.5,
                saturation=saturation or 0.0,
                duration=duration or 0.5,
            )
        elif drum_type == 'snare':
            audio = _drum_engine.synthesize_snare(
                decay=decay or 0.2,
                saturation=saturation or 0.0,
                duration=duration or 0.3,
            )
        elif drum_type == 'hat':
            audio = _drum_engine.synthesize_hat(
                decay=decay or 0.1,
                duration=duration or 0.15,
            )
        
        # Convert to stereo
        if audio.ndim == 1:
            audio = np.stack([audio, audio])
        
        # Write to in-memory WAV
        buffer = io.BytesIO()
        sf.write(buffer, audio.T, 44100, format='WAV')
        buffer.seek(0)
        audio_data = buffer.read()
        
        # Encode as base64
        audio_b64 = base64.b64encode(audio_data).decode('utf-8')
        
        return {
            "drum_type": drum_type,
            "audio_data": audio_b64,
            "sample_rate": 44100,
            "duration": duration,
        }
    
    except Exception as e:
        raise HTTPException(500, f"Error synthesizing drum: {str(e)}")


@router.post("/generate-pattern")
async def generate_pattern(
    preset: Optional[str] = Body(None, description="Preset name (footwork_basic, juke_pattern, ghetto_house, footwork_poly)"),
    mode: Optional[str] = Body("footwork", description="Trigger mode"),
    pattern_config: Optional[Dict[str, Any]] = Body(None, description="Custom pattern configuration"),
    duration_beats: float = Body(4.0, description="Pattern length in beats"),
    bpm: float = Body(160.0, description="Tempo in BPM"),
    num_slices: int = Body(16, description="Number of slices available"),
) -> dict:
    """
    Generate a footwork pattern sequence.
    
    Returns a list of trigger events with footwork-specific parameters.
    """
    try:
        # Validate parameters
        if duration_beats <= 0 or duration_beats > 64:
            raise HTTPException(400, f"duration_beats must be between 0 and 64, got {duration_beats}")
        
        if bpm <= 0 or bpm > 300:
            raise HTTPException(400, f"bpm must be between 0 and 300, got {bpm}")
        
        if num_slices <= 0 or num_slices > 256:
            raise HTTPException(400, f"num_slices must be between 0 and 256, got {num_slices}")
        
        # Use preset if provided
        if preset and preset in TRIGGER_PRESETS:
            config = TRIGGER_PRESETS[preset]
            engine = TriggerEngine(
                mode=config['mode'],
                trigger_source=config['trigger_source'],
                rules=config.get('rules', []),
            )
        elif pattern_config:
            # Build custom pattern from config
            source_type = pattern_config.get('type', 'polyrhythmic')
            
            if source_type == 'polyrhythmic':
                trigger_source = PolyrhythmicTriggerSource(
                    layers=pattern_config.get('layers', [])
                )
            elif source_type == 'juke':
                trigger_source = JukePatternTriggerSource(
                    pattern_name=pattern_config.get('pattern_name', 'juke_basic'),
                    loop_length=pattern_config.get('loop_length', 4.0),
                )
            elif source_type == 'offbeat':
                trigger_source = OffbeatTriggerSource(
                    base_subdivision=pattern_config.get('base_subdivision', 4.0),
                    offbeat_ratio=pattern_config.get('offbeat_ratio', 1.0 / 3.0),
                    swing_amount=pattern_config.get('swing_amount', 0.5),
                    pattern=pattern_config.get('pattern'),
                )
            elif source_type == 'micro_timing':
                # Wrap another source with micro-timing
                base_source_config = pattern_config.get('base_source', {})
                if not base_source_config:
                    raise HTTPException(400, "micro_timing pattern type requires 'base_source' in pattern_config")
                try:
                    base_source = TriggerSource.from_dict(base_source_config)
                except Exception as e:
                    raise HTTPException(400, f"Invalid base_source configuration: {str(e)}")
                
                offset_range = pattern_config.get('offset_range', [-0.1, 0.1])
                if len(offset_range) != 2:
                    raise HTTPException(400, "offset_range must be a list of 2 values [min, max]")
                
                trigger_source = MicroTimingTriggerSource(
                    base_source=base_source,
                    offset_range=tuple(offset_range),
                    offset_pattern=pattern_config.get('offset_pattern'),
                    randomize=pattern_config.get('randomize', True),
                )
            else:
                raise HTTPException(400, f"Unknown pattern type: {source_type}. Must be 'polyrhythmic', 'juke', 'offbeat', or 'micro_timing'")
            
            try:
                trigger_mode = TriggerMode(mode)
            except ValueError:
                raise HTTPException(400, f"Invalid mode: {mode}. Must be one of: {[m.value for m in TriggerMode]}")
            
            engine = TriggerEngine(
                mode=trigger_mode,
                trigger_source=trigger_source,
            )
        else:
            # Default to footwork_basic
            config = TRIGGER_PRESETS['footwork_basic']
            engine = TriggerEngine(
                mode=config['mode'],
                trigger_source=config['trigger_source'],
                rules=config.get('rules', []),
            )
        
        # Generate sequence
        events = engine.generate_sequence(
            num_slices=num_slices,
            duration_beats=duration_beats,
            bpm=bpm,
        )
        
        # Convert events to dict format
        events_dict = [e.to_dict() for e in events]
        
        return {
            "preset": preset or "custom",
            "mode": engine.mode.value,
            "duration_beats": duration_beats,
            "bpm": bpm,
            "num_events": len(events_dict),
            "events": events_dict,
        }
    
    except Exception as e:
        raise HTTPException(500, f"Error generating pattern: {str(e)}")


@router.get("/presets")
async def list_presets() -> dict:
    """
    List all available footwork presets.
    """
    footwork_presets = {
        name: {
            "mode": config['mode'].value,
            "trigger_source_type": config['trigger_source'].__class__.__name__,
        }
        for name, config in TRIGGER_PRESETS.items()
        if name.startswith('footwork') or name in ['juke_pattern', 'ghetto_house']
    }
    
    return {
        "presets": footwork_presets,
        "count": len(footwork_presets),
    }


@router.post("/synthesize-pattern")
async def synthesize_pattern(
    pattern: List[Dict[str, Any]] = Body(..., description="Pattern: [(time_beats, drum_type, params_dict), ...]"),
    bpm: float = Body(160.0, description="Tempo in BPM"),
    duration_beats: float = Body(4.0, description="Pattern length in beats"),
) -> dict:
    """
    Synthesize a complete drum pattern.
    
    Pattern format: [
        {"time": 0.0, "type": "kick", "params": {"freq_start": 60, "decay": 0.5, "saturation": 0.3}},
        {"time": 1.0, "type": "snare", "params": {"decay": 0.2, "saturation": 0.4}},
        ...
    ]
    """
    try:
        # Convert pattern format
        pattern_list = []
        for item in pattern:
            time = item.get('time', 0.0)
            drum_type = item.get('type', 'kick')
            params = item.get('params', {})
            pattern_list.append((time, drum_type, params))
        
        # Synthesize
        audio = _drum_engine.synthesize_pattern(
            pattern=pattern_list,
            bpm=bpm,
            duration_beats=duration_beats,
        )
        
        # Write to in-memory WAV
        buffer = io.BytesIO()
        sf.write(buffer, audio.T, 44100, format='WAV')
        buffer.seek(0)
        audio_data = buffer.read()
        
        # Encode as base64
        audio_b64 = base64.b64encode(audio_data).decode('utf-8')
        
        return {
            "audio_data": audio_b64,
            "sample_rate": 44100,
            "duration_beats": duration_beats,
            "bpm": bpm,
            "num_hits": len(pattern_list),
        }
    
    except Exception as e:
        raise HTTPException(500, f"Error synthesizing pattern: {str(e)}")

