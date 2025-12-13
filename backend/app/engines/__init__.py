"""
Loop Forge Engine Suite
Advanced audio processing for experimental production.

Engines:
- KeyDetector: Batch key detection with Krumhansl-Schmuckler
- PitchEngine: pYIN pitch detection + auto-tune
- ArtifactEngine: Bladee-style experimental effects
- SpectralEngine: Advanced spectral manipulation
- VocalForge: Main orchestrator
- SliceEngine: Autechre-style sample slicing
- TriggerEngine: Generative sequencing with rules
"""

from .key_detector import KeyDetector
from .pitch_engine import PitchEngine
from .artifact_engine import ArtifactEngine
from .spectral_engine import SpectralEngine
from .vocal_forge import VocalForge
from .slice_engine import SliceEngine, SliceBank, Slice, SliceRole
from .trigger_engine import (
    TriggerEngine, TriggerMode, TriggerEvent, TriggerRule,
    TriggerSource, GridTriggerSource, EuclideanTriggerSource,
    MIDITriggerSource, ProbabilityTriggerSource, TransientFollowSource,
    create_trigger_engine, TRIGGER_PRESETS
)

__all__ = [
    'KeyDetector',
    'PitchEngine', 
    'ArtifactEngine',
    'SpectralEngine',
    'VocalForge',
    'SliceEngine',
    'SliceBank',
    'Slice',
    'SliceRole',
    'TriggerEngine',
    'TriggerMode',
    'TriggerEvent',
    'TriggerRule',
    'TriggerSource',
    'GridTriggerSource',
    'EuclideanTriggerSource',
    'MIDITriggerSource',
    'ProbabilityTriggerSource',
    'TransientFollowSource',
    'create_trigger_engine',
    'TRIGGER_PRESETS',
]
