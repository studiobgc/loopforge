"""
Trigger Engine - Autechre-inspired generative sequencing.

Determines WHEN and WHICH slices to trigger based on:
- Sequential playback
- MIDI patterns
- Euclidean rhythms
- Following another stem's transients
- Probability-weighted selection
- Rule-based conditional logic

"We may have one fader that determines how often a snare does a little roll or skip,
and another thing that listens and says 'If that snare plays that roll three times,
then I'll do this.'" - Sean Booth
"""

import numpy as np
from typing import List, Dict, Optional, Callable, Tuple, Any
from dataclasses import dataclass, field, asdict
from enum import Enum
from abc import ABC, abstractmethod
import random
import json


class TriggerMode(Enum):
    """How the sequencer selects slices"""
    SEQUENTIAL = "sequential"        # Play slices in order
    RANDOM = "random"                # Pure random selection
    PROBABILITY = "probability"      # Weighted by slice attributes
    MIDI_MAP = "midi_map"            # MIDI note → slice index
    PATTERN = "pattern"              # Follow a pattern array
    FOLLOW = "follow"                # Follow another stem's transients
    EUCLIDEAN = "euclidean"          # Euclidean rhythm generator
    CHAOS = "chaos"                  # Full generative mode with rules
    FOOTWORK = "footwork"            # Footwork-specific sequencing


@dataclass
class TriggerEvent:
    """
    A single trigger event in a sequence.
    
    Represents "play slice X at time T with these parameters"
    """
    time: float                      # Time in beats (or seconds, depending on context)
    slice_index: int                 # Which slice to play (-1 = decide at runtime)
    velocity: float = 1.0            # 0-1, affects volume/filter
    duration: Optional[float] = None # How long to play (None = full slice)
    pitch_shift: int = 0             # Semitones
    reverse: bool = False            # Play backwards
    pan: float = 0.0                 # -1 to 1 (left to right)
    filter_cutoff: Optional[float] = None  # Hz, for lowpass filter
    
    # Footwork-specific parameters
    micro_offset: float = 0.0        # Intentional timing offset in beats (e.g., 0.1 = ahead, -0.05 = behind)
    envelope_sweep: Optional[float] = None  # TR-808 style pitch sweep (0-1, controls pitch decay)
    saturation_amount: float = 0.0   # Saturation/distortion level (0-1, for saturation-as-texture)
    swing_amount: float = 0.0        # Swing/triplet feel (0-1, for offbeat timing)
    
    # Metadata
    triggered_by: Optional[str] = None  # What caused this trigger
    rule_modified: bool = False         # Was this modified by a rule?
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'TriggerEvent':
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class TriggerRule:
    """
    A conditional rule that modifies sequence behavior.
    
    Example: "IF slice 1 plays 3x consecutive THEN skip next trigger"
    """
    id: str
    name: str
    condition: str                   # e.g., "consecutive_plays > 3"
    action: str                      # e.g., "skip_next"
    probability: float = 1.0         # Chance of rule firing (0-1)
    enabled: bool = True
    
    # Supported conditions:
    # - "consecutive_plays > N" - same slice played N times in a row
    # - "total_plays > N" - any slice played N times total
    # - "slice_index == N" - specific slice was just played
    # - "velocity > X" - velocity above threshold
    # - "time_since_last > X" - beats since last trigger
    
    # Supported actions:
    # - "skip_next" - don't trigger next event
    # - "double_trigger" - trigger twice
    # - "pitch_up_N" - raise pitch by N semitones
    # - "pitch_down_N" - lower pitch by N semitones
    # - "reverse" - play slice backwards
    # - "random_slice" - pick random slice instead
    # - "reset_sequence" - go back to start
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'TriggerRule':
        return cls(**data)


class TriggerSource(ABC):
    """
    Abstract base for things that generate trigger timings.
    
    Subclasses determine WHEN triggers should fire.
    """
    
    @abstractmethod
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        """Return list of times (in beats) when triggers should fire"""
        pass
    
    @abstractmethod
    def get_velocity(self, time: float) -> float:
        """Return velocity/intensity at a given time"""
        pass
    
    def to_dict(self) -> Dict:
        return {'type': self.__class__.__name__}
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'TriggerSource':
        """
        Factory method to create TriggerSource from dict.
        
        Handles all TriggerSource subclasses including footwork-specific types.
        """
        if not data:
            return GridTriggerSource()
        
        source_type = data.get('type', 'GridTriggerSource')
        
        # Map source types to their from_dict methods
        source_map = {
            'EuclideanTriggerSource': EuclideanTriggerSource.from_dict,
            'MIDITriggerSource': MIDITriggerSource.from_dict,
            'TransientFollowSource': TransientFollowSource.from_dict,
            'ProbabilityTriggerSource': ProbabilityTriggerSource.from_dict,
            'PolyrhythmicTriggerSource': PolyrhythmicTriggerSource.from_dict,
            'MicroTimingTriggerSource': MicroTimingTriggerSource.from_dict,
            'JukePatternTriggerSource': JukePatternTriggerSource.from_dict,
            'OffbeatTriggerSource': OffbeatTriggerSource.from_dict,
        }
        
        factory = source_map.get(source_type)
        if factory:
            return factory(data)
        
        # Default to GridTriggerSource
        return GridTriggerSource.from_dict(data)


class GridTriggerSource(TriggerSource):
    """
    Simple grid-based triggering at regular intervals.
    """
    
    def __init__(self, subdivision: float = 1.0, offset: float = 0.0):
        """
        Args:
            subdivision: Triggers per beat (1=quarter, 2=eighth, 4=sixteenth)
            offset: Phase offset in beats
        """
        self.subdivision = subdivision
        self.offset = offset
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        step = 1.0 / self.subdivision
        times = []
        t = self.offset
        while t < duration_beats:
            times.append(t)
            t += step
        return times
    
    def get_velocity(self, time: float) -> float:
        return 1.0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'GridTriggerSource',
            'subdivision': self.subdivision,
            'offset': self.offset,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'GridTriggerSource':
        return cls(
            subdivision=data.get('subdivision', 1.0),
            offset=data.get('offset', 0.0),
        )


class EuclideanTriggerSource(TriggerSource):
    """
    Generate triggers using Euclidean rhythms.
    
    Euclidean rhythms distribute N hits as evenly as possible
    over M steps - creates interesting polyrhythms found in
    many world music traditions.
    """
    
    def __init__(self, hits: int, steps: int, rotation: int = 0):
        """
        Args:
            hits: Number of triggers
            steps: Number of steps in the pattern
            rotation: Rotate pattern by this many steps
        """
        self.hits = min(hits, steps)
        self.steps = steps
        self.rotation = rotation % steps if steps > 0 else 0
        self._pattern = self._generate_pattern()
    
    def _generate_pattern(self) -> List[bool]:
        """
        Bjorklund's algorithm for Euclidean rhythms.
        
        Distributes hits as evenly as possible across steps.
        """
        if self.steps == 0:
            return []
        if self.hits == 0:
            return [False] * self.steps
        if self.hits >= self.steps:
            return [True] * self.steps
        
        # Bjorklund's algorithm
        pattern = []
        counts = []
        remainders = []
        
        divisor = self.steps - self.hits
        remainders.append(self.hits)
        level = 0
        
        while remainders[level] > 1:
            counts.append(divisor // remainders[level])
            remainders.append(divisor % remainders[level])
            divisor = remainders[level]
            level += 1
        
        counts.append(divisor)
        
        def build(level: int) -> List[bool]:
            if level == -1:
                return [True]
            elif level == -2:
                return [False]
            else:
                pattern = []
                for _ in range(counts[level]):
                    pattern.extend(build(level - 1))
                if remainders[level] != 0:
                    pattern.extend(build(level - 2))
                return pattern
        
        pattern = build(level)
        
        # Apply rotation
        if self.rotation > 0:
            pattern = pattern[self.rotation:] + pattern[:self.rotation]
        
        return pattern
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        if not self._pattern:
            return []
        
        step_duration = duration_beats / self.steps
        times = []
        
        # Repeat pattern as needed to fill duration
        pattern_duration = len(self._pattern) * step_duration
        num_repeats = int(np.ceil(duration_beats / pattern_duration))
        
        for repeat in range(num_repeats):
            for i, hit in enumerate(self._pattern):
                if hit:
                    time = repeat * pattern_duration + i * step_duration
                    if time < duration_beats:
                        times.append(time)
        
        return times
    
    def get_velocity(self, time: float) -> float:
        # Could implement accent patterns here
        return 1.0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'EuclideanTriggerSource',
            'hits': self.hits,
            'steps': self.steps,
            'rotation': self.rotation,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'EuclideanTriggerSource':
        return cls(
            hits=data.get('hits', 4),
            steps=data.get('steps', 16),
            rotation=data.get('rotation', 0),
        )


class MIDITriggerSource(TriggerSource):
    """
    Use MIDI note data to trigger slices.
    
    Maps MIDI notes to slice indices:
    - Note 36 (C1) → Slice 0
    - Note 37 (C#1) → Slice 1
    - etc.
    """
    
    def __init__(
        self, 
        notes: List[Dict] = None,  # [{'time': 0, 'note': 36, 'velocity': 100}, ...]
        base_note: int = 36,       # MIDI note that maps to slice 0
    ):
        self.notes = notes or []
        self.base_note = base_note
        self._times_cache = None
    
    def add_note(self, time: float, note: int, velocity: int = 100):
        """Add a MIDI note to the pattern"""
        self.notes.append({'time': time, 'note': note, 'velocity': velocity})
        self.notes.sort(key=lambda x: x['time'])
        self._times_cache = None
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        return [n['time'] for n in self.notes if n['time'] < duration_beats]
    
    def get_velocity(self, time: float) -> float:
        for note in self.notes:
            if abs(note['time'] - time) < 0.001:
                return note['velocity'] / 127.0
        return 1.0
    
    def get_slice_index(self, time: float) -> int:
        """Get the slice index for a trigger at this time"""
        for note in self.notes:
            if abs(note['time'] - time) < 0.001:
                return note['note'] - self.base_note
        return 0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'MIDITriggerSource',
            'notes': self.notes,
            'base_note': self.base_note,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'MIDITriggerSource':
        return cls(
            notes=data.get('notes', []),
            base_note=data.get('base_note', 36),
        )


class TransientFollowSource(TriggerSource):
    """
    Use another audio stem's transients as trigger source.
    
    This is the Autechre technique of having one pattern "drive" another.
    For example, using drum transients to trigger vocal slices.
    """
    
    def __init__(
        self, 
        transient_times: List[float] = None,  # Times in beats
        transient_strengths: List[float] = None,  # Corresponding strengths
        delay_beats: float = 0.0,  # Offset (can be negative for anticipation)
    ):
        self.transient_times = transient_times or []
        self.transient_strengths = transient_strengths or [1.0] * len(self.transient_times)
        self.delay_beats = delay_beats
    
    def set_from_slice_bank(self, bank: 'SliceBank', bpm: float):
        """Set transient times from a SliceBank"""
        self.transient_times = []
        self.transient_strengths = []
        
        for slice_obj in bank.slices:
            # Convert time to beats
            time_beats = slice_obj.start_time * bpm / 60.0
            self.transient_times.append(time_beats + self.delay_beats)
            self.transient_strengths.append(slice_obj.transient_strength)
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        return [t for t in self.transient_times if 0 <= t < duration_beats]
    
    def get_velocity(self, time: float) -> float:
        for i, t in enumerate(self.transient_times):
            if abs(t - time) < 0.001:
                return self.transient_strengths[i] if i < len(self.transient_strengths) else 1.0
        return 1.0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'TransientFollowSource',
            'transient_times': self.transient_times,
            'transient_strengths': self.transient_strengths,
            'delay_beats': self.delay_beats,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'TransientFollowSource':
        return cls(
            transient_times=data.get('transient_times', []),
            transient_strengths=data.get('transient_strengths', []),
            delay_beats=data.get('delay_beats', 0.0),
        )


class ProbabilityTriggerSource(TriggerSource):
    """
    Probability-based triggering - each step has a chance of firing.
    
    Like Elektron-style parameter locks, but for trigger probability.
    """
    
    def __init__(
        self,
        steps: int = 16,
        probabilities: List[float] = None,  # Probability for each step (0-1)
        subdivision: float = 1.0,  # Steps per beat
    ):
        self.steps = steps
        self.probabilities = probabilities or [1.0] * steps
        self.subdivision = subdivision
        
        # Ensure probabilities list matches steps
        while len(self.probabilities) < steps:
            self.probabilities.append(1.0)
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        step_duration = 1.0 / self.subdivision
        times = []
        
        step = 0
        time = 0.0
        while time < duration_beats:
            prob = self.probabilities[step % len(self.probabilities)]
            if random.random() < prob:
                times.append(time)
            time += step_duration
            step += 1
        
        return times
    
    def get_velocity(self, time: float) -> float:
        return 1.0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'ProbabilityTriggerSource',
            'steps': self.steps,
            'probabilities': self.probabilities,
            'subdivision': self.subdivision,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'ProbabilityTriggerSource':
        return cls(
            steps=data.get('steps', 16),
            probabilities=data.get('probabilities'),
            subdivision=data.get('subdivision', 1.0),
        )


class PolyrhythmicTriggerSource(TriggerSource):
    """
    Generate triggers across multiple simultaneous time signatures.
    
    Footwork technique: layers drums on different time signatures simultaneously
    (e.g., kick on 4/4, snare on 3/4, hats on 5/8).
    """
    
    def __init__(
        self,
        layers: List[Dict] = None,  # Each layer: {'hits': int, 'steps': int, 'subdivision': float, 'offset': float}
    ):
        """
        Args:
            layers: List of layer configs. Each layer has:
                - hits: Number of triggers in the pattern
                - steps: Number of steps in the pattern
                - subdivision: Steps per beat (1.0 = quarter notes, 4.0 = sixteenths)
                - offset: Phase offset in beats
        """
        self.layers = layers or [
            {'hits': 4, 'steps': 4, 'subdivision': 1.0, 'offset': 0.0}  # Default: 4/4
        ]
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        all_times = []
        
        if not self.layers:
            return []
        
        for layer in self.layers:
            hits = max(1, layer.get('hits', 4))
            steps = max(1, layer.get('steps', 4))
            subdivision = max(0.25, layer.get('subdivision', 1.0))  # Prevent division by zero
            offset = layer.get('offset', 0.0)
            
            # Use Euclidean pattern for each layer
            euclidean = EuclideanTriggerSource(hits=min(hits, steps), steps=steps)
            layer_times = euclidean.get_trigger_times(duration_beats, bpm)
            
            # Apply subdivision and offset
            step_duration = 1.0 / subdivision
            for time in layer_times:
                adjusted_time = (time * step_duration) + offset
                if 0 <= adjusted_time < duration_beats:
                    all_times.append(adjusted_time)
        
        # Merge and sort all trigger times
        all_times = sorted(set(all_times))
        return all_times
    
    def get_velocity(self, time: float) -> float:
        # Could vary velocity by layer, but default to 1.0
        return 1.0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'PolyrhythmicTriggerSource',
            'layers': self.layers,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'PolyrhythmicTriggerSource':
        return cls(layers=data.get('layers'))


class MicroTimingTriggerSource(TriggerSource):
    """
    Apply intentional micro-timing offsets (MPC-style manual adjustments).
    
    Wraps an existing TriggerSource and adds humanized timing offsets.
    """
    
    def __init__(
        self,
        base_source: TriggerSource,
        offset_range: Tuple[float, float] = (-0.1, 0.1),  # Min/max offset in beats
        offset_pattern: Optional[List[float]] = None,  # Per-step offsets for human feel
        randomize: bool = True,  # If True, use random offsets; if False, use pattern
    ):
        """
        Args:
            base_source: The underlying trigger source to wrap
            offset_range: (min, max) offset in beats
            offset_pattern: Optional list of offsets to apply cyclically
            randomize: If True, use random offsets within range; if False, use pattern
        """
        self.base_source = base_source
        self.offset_range = offset_range
        self.offset_pattern = offset_pattern or []
        self.randomize = randomize
        self._rng = random.Random()
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        base_times = self.base_source.get_trigger_times(duration_beats, bpm)
        offset_times = []
        
        for i, time in enumerate(base_times):
            if self.randomize:
                # Random offset within range
                offset = self._rng.uniform(self.offset_range[0], self.offset_range[1])
            else:
                # Use pattern (cyclically)
                if self.offset_pattern:
                    offset = self.offset_pattern[i % len(self.offset_pattern)]
                else:
                    offset = 0.0
            
            offset_time = time + offset
            if 0 <= offset_time < duration_beats:
                offset_times.append(offset_time)
        
        return sorted(offset_times)
    
    def get_velocity(self, time: float) -> float:
        return self.base_source.get_velocity(time)
    
    def to_dict(self) -> Dict:
        return {
            'type': 'MicroTimingTriggerSource',
            'base_source': self.base_source.to_dict(),
            'offset_range': list(self.offset_range),
            'offset_pattern': self.offset_pattern,
            'randomize': self.randomize,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'MicroTimingTriggerSource':
        base_source_data = data.get('base_source', {})
        base_source = TriggerSource.from_dict(base_source_data)
        offset_range = tuple(data.get('offset_range', [-0.1, 0.1]))
        return cls(
            base_source=base_source,
            offset_range=offset_range,
            offset_pattern=data.get('offset_pattern'),
            randomize=data.get('randomize', True),
        )


class JukePatternTriggerSource(TriggerSource):
    """
    Footwork-specific rhythmic patterns (juke/ghetto house).
    
    Predefined patterns derived from classic juke/footwork tracks.
    """
    
    # Classic juke/footwork patterns
    PATTERNS = {
        'juke_basic': [
            (0.0, 1.0),    # Kick on 1
            (0.5, 0.8),    # Snare on 1.5
            (1.0, 0.6),    # Hat on 2
            (1.5, 0.9),    # Kick on 2.5
            (2.0, 0.7),    # Snare on 3
            (2.5, 0.5),    # Hat on 3.5
            (3.0, 1.0),    # Kick on 4
            (3.5, 0.8),    # Snare on 4.5
        ],
        'ghetto_house': [
            (0.0, 1.0),    # Kick
            (0.25, 0.4),   # Hat
            (0.5, 0.9),    # Snare
            (0.75, 0.3),   # Hat
            (1.0, 0.8),    # Kick
            (1.25, 0.5),   # Hat
            (1.5, 0.9),    # Snare
            (1.75, 0.4),   # Hat
            (2.0, 1.0),    # Kick
            (2.25, 0.3),   # Hat
            (2.5, 0.9),    # Snare
            (2.75, 0.5),   # Hat
            (3.0, 0.8),    # Kick
            (3.25, 0.4),   # Hat
            (3.5, 0.9),    # Snare
            (3.75, 0.3),   # Hat
        ],
        'footwork_poly': [
            (0.0, 1.0),    # Kick
            (0.33, 0.7),   # Offbeat 1/3
            (0.67, 0.5),   # Offbeat 2/3
            (1.0, 0.9),    # Snare
            (1.33, 0.6),   # Offbeat
            (1.67, 0.4),   # Offbeat
            (2.0, 1.0),    # Kick
            (2.33, 0.8),   # Offbeat
            (2.67, 0.5),   # Offbeat
            (3.0, 0.9),    # Snare
            (3.33, 0.7),   # Offbeat
            (3.67, 0.4),   # Offbeat
        ],
    }
    
    def __init__(
        self,
        pattern_name: str = 'juke_basic',
        pattern: Optional[List[Tuple[float, float]]] = None,  # Custom pattern: [(time, velocity), ...]
        loop_length: float = 4.0,  # Pattern length in beats
    ):
        """
        Args:
            pattern_name: Name of predefined pattern, or 'custom' to use pattern arg
            pattern: Custom pattern as list of (time_offset, velocity) tuples
            loop_length: Length of pattern loop in beats
        """
        self.pattern_name = pattern_name
        self.loop_length = loop_length
        
        if pattern_name == 'custom' and pattern:
            self.pattern = pattern
        elif pattern_name in self.PATTERNS:
            self.pattern = self.PATTERNS[pattern_name]
        else:
            self.pattern = self.PATTERNS['juke_basic']
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        times = []
        num_loops = int(np.ceil(duration_beats / self.loop_length))
        
        for loop in range(num_loops):
            for time_offset, velocity in self.pattern:
                time = loop * self.loop_length + time_offset
                if time < duration_beats:
                    times.append(time)
        
        return sorted(times)
    
    def get_velocity(self, time: float) -> float:
        # Find which pattern step this time corresponds to
        time_in_loop = time % self.loop_length
        
        for time_offset, velocity in self.pattern:
            if abs(time_in_loop - time_offset) < 0.01:
                return velocity
        
        return 1.0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'JukePatternTriggerSource',
            'pattern_name': self.pattern_name,
            'pattern': self.pattern,
            'loop_length': self.loop_length,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'JukePatternTriggerSource':
        return cls(
            pattern_name=data.get('pattern_name', 'juke_basic'),
            pattern=data.get('pattern'),
            loop_length=data.get('loop_length', 4.0),
        )


class OffbeatTriggerSource(TriggerSource):
    """
    Offbeat timing (1/3 notes off grid, MPC-style).
    
    Creates swing/triplet feel by offsetting triggers from the base grid.
    """
    
    def __init__(
        self,
        base_subdivision: float = 4.0,  # Base grid (e.g., 4.0 for 16th notes)
        offbeat_ratio: float = 1.0 / 3.0,  # Offset ratio (1/3, 2/3 for triplet feel)
        swing_amount: float = 0.5,  # Amount of swing (0-1)
        pattern: Optional[List[bool]] = None,  # Which steps get offset (True = offset, False = on-grid)
    ):
        """
        Args:
            base_subdivision: Base grid subdivision (4.0 = 16th notes)
            offbeat_ratio: How far off-grid (1/3 = triplet feel)
            swing_amount: How much swing to apply (0 = none, 1 = full)
            pattern: Optional pattern of which steps to offset
        """
        self.base_subdivision = base_subdivision
        self.offbeat_ratio = offbeat_ratio
        self.swing_amount = swing_amount
        self.pattern = pattern or [False] * 16  # Default: all on-grid
    
    def get_trigger_times(self, duration_beats: float, bpm: float) -> List[float]:
        step_duration = 1.0 / self.base_subdivision
        times = []
        
        step = 0
        time = 0.0
        while time < duration_beats:
            # Determine if this step should be offset
            should_offset = self.pattern[step % len(self.pattern)] if self.pattern else False
            
            if should_offset:
                # Apply swing offset
                offset = step_duration * self.offbeat_ratio * self.swing_amount
                trigger_time = time + offset
            else:
                trigger_time = time
            
            if 0 <= trigger_time < duration_beats:
                times.append(trigger_time)
            
            time += step_duration
            step += 1
        
        return times
    
    def get_velocity(self, time: float) -> float:
        return 1.0
    
    def to_dict(self) -> Dict:
        return {
            'type': 'OffbeatTriggerSource',
            'base_subdivision': self.base_subdivision,
            'offbeat_ratio': self.offbeat_ratio,
            'swing_amount': self.swing_amount,
            'pattern': self.pattern,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'OffbeatTriggerSource':
        return cls(
            base_subdivision=data.get('base_subdivision', 4.0),
            offbeat_ratio=data.get('offbeat_ratio', 1.0 / 3.0),
            swing_amount=data.get('swing_amount', 0.5),
            pattern=data.get('pattern'),
        )


class TriggerEngine:
    """
    The Autechre-style generative sequencer.
    
    Takes a SliceBank and a trigger source, produces TriggerEvents.
    Applies rules for conditional behavior.
    
    Supports seeded RNG for reproducible generative jams:
    - Same seed + same parameters = identical sequence every time
    - Perfect for recalling a "lucky" generative take
    """
    
    def __init__(
        self,
        mode: TriggerMode = TriggerMode.SEQUENTIAL,
        trigger_source: Optional[TriggerSource] = None,
        rules: List[TriggerRule] = None,
        seed: Optional[int] = None,
    ):
        self.mode = mode
        self.trigger_source = trigger_source or GridTriggerSource()
        self.rules = rules or []
        self._seed = seed
        self._rng = random.Random(seed)  # Isolated RNG instance for reproducibility
        
        # State tracking for rules
        self.state = {
            'last_slice_index': -1,
            'consecutive_plays': 0,
            'total_plays': 0,
            'play_history': [],  # Last N slice indices
            'last_trigger_time': 0.0,
        }
    
    def reset_state(self):
        """Reset internal state for a new sequence"""
        self.state = {
            'last_slice_index': -1,
            'consecutive_plays': 0,
            'total_plays': 0,
            'play_history': [],
            'last_trigger_time': 0.0,
        }
    
    def _select_slice(
        self, 
        num_slices: int, 
        time: float,
        slice_bank: Optional['SliceBank'] = None,
    ) -> int:
        """Select which slice to play based on mode"""
        
        if self.mode == TriggerMode.SEQUENTIAL:
            return self.state['total_plays'] % num_slices
        
        elif self.mode == TriggerMode.RANDOM:
            return self._rng.randint(0, num_slices - 1)
        
        elif self.mode == TriggerMode.PROBABILITY:
            if slice_bank:
                slice_obj = slice_bank.get_random_weighted(weight_by='energy', rng=self._rng)
                return slice_obj.index
            return self._rng.randint(0, num_slices - 1)
        
        elif self.mode == TriggerMode.MIDI_MAP:
            if isinstance(self.trigger_source, MIDITriggerSource):
                idx = self.trigger_source.get_slice_index(time)
                return max(0, min(idx, num_slices - 1))
            return 0
        
        elif self.mode == TriggerMode.PATTERN:
            # Pattern mode uses a predefined pattern
            # The pattern is stored in trigger_source if it's the right type
            return self.state['total_plays'] % num_slices
        
        elif self.mode == TriggerMode.FOLLOW:
            # In follow mode, slice selection can follow energy or sequential
            return self.state['total_plays'] % num_slices
        
        elif self.mode == TriggerMode.EUCLIDEAN:
            return self.state['total_plays'] % num_slices
        
        elif self.mode == TriggerMode.CHAOS:
            # Chaos mode: weighted random with occasional sequential runs
            if self._rng.random() < 0.3:
                # 30% chance of continuing from last slice
                return (self.state['last_slice_index'] + 1) % num_slices
            elif slice_bank:
                return slice_bank.get_random_weighted(weight_by='transient', rng=self._rng).index
            else:
                return self._rng.randint(0, num_slices - 1)
        
        elif self.mode == TriggerMode.FOOTWORK:
            # Footwork mode: combines polyrhythmic layering with probability weighting
            # Uses slice energy/transient strength for selection
            if slice_bank:
                # Weight by transient strength (footwork emphasizes rhythmic precision)
                return slice_bank.get_random_weighted(weight_by='transient', rng=self._rng).index
            else:
                # Fallback to weighted random
                return self._rng.randint(0, num_slices - 1)
        
        return 0
    
    def _evaluate_condition(self, condition: str) -> bool:
        """
        Evaluate a rule condition against current state.
        
        Supported conditions:
        - "consecutive_plays > N"
        - "total_plays > N"
        - "slice_index == N"
        - "velocity > X"
        - "time_since_last > X"
        """
        try:
            if "consecutive_plays" in condition:
                parts = condition.replace("consecutive_plays", "").strip().split()
                if len(parts) >= 2:
                    op, value = parts[0], int(parts[1])
                    if op == '>':
                        return self.state['consecutive_plays'] > value
                    elif op == '>=':
                        return self.state['consecutive_plays'] >= value
                    elif op == '==':
                        return self.state['consecutive_plays'] == value
            
            elif "total_plays" in condition:
                parts = condition.replace("total_plays", "").strip().split()
                if len(parts) >= 2:
                    op, value = parts[0], int(parts[1])
                    if op == '>':
                        return self.state['total_plays'] > value
                    elif op == '%':
                        # Modulo - fires every N plays
                        return self.state['total_plays'] % value == 0
            
            elif "slice_index" in condition:
                parts = condition.replace("slice_index", "").strip().split()
                if len(parts) >= 2:
                    op, value = parts[0], int(parts[1])
                    if op == '==':
                        return self.state['last_slice_index'] == value
                    elif op == '!=':
                        return self.state['last_slice_index'] != value
            
        except (ValueError, IndexError):
            pass
        
        return False
    
    def _apply_action(self, action: str, event: TriggerEvent, num_slices: int) -> Tuple[TriggerEvent, bool]:
        """
        Apply a rule action to an event.
        
        Returns (modified_event, should_skip)
        """
        should_skip = False
        
        if action == "skip_next":
            should_skip = True
        
        elif action == "double_trigger":
            # This would need to insert another event - handled at sequence level
            pass
        
        elif action.startswith("pitch_up_"):
            try:
                semitones = int(action.replace("pitch_up_", ""))
                event.pitch_shift += semitones
            except ValueError:
                pass
        
        elif action.startswith("pitch_down_"):
            try:
                semitones = int(action.replace("pitch_down_", ""))
                event.pitch_shift -= semitones
            except ValueError:
                pass
        
        elif action == "reverse":
            event.reverse = not event.reverse
        
        elif action == "random_slice":
            event.slice_index = self._rng.randint(0, num_slices - 1)
        
        elif action == "reset_sequence":
            self.reset_state()
        
        elif action == "half_velocity":
            event.velocity *= 0.5
        
        elif action == "double_velocity":
            event.velocity = min(1.0, event.velocity * 2)
        
        event.rule_modified = True
        return event, should_skip
    
    def generate_sequence(
        self,
        num_slices: int,
        duration_beats: float,
        bpm: float,
        slice_bank: Optional['SliceBank'] = None,
    ) -> List[TriggerEvent]:
        """
        Generate a sequence of trigger events.
        
        Args:
            num_slices: Number of slices available
            duration_beats: Length of sequence in beats
            bpm: Tempo
            slice_bank: Optional SliceBank for weighted selection
        
        Returns:
            List of TriggerEvents
        """
        self.reset_state()
        events = []
        
        # Get trigger times from source
        trigger_times = self.trigger_source.get_trigger_times(duration_beats, bpm)
        
        skip_next = False
        
        for time in trigger_times:
            if skip_next:
                skip_next = False
                continue
            
            # Select slice
            slice_index = self._select_slice(num_slices, time, slice_bank)
            
            # Get velocity from source
            velocity = self.trigger_source.get_velocity(time)
            
            # Create event
            event = TriggerEvent(
                time=time,
                slice_index=slice_index,
                velocity=velocity,
                triggered_by=self.mode.value,
            )
            
            # Apply footwork-specific parameters if in FOOTWORK mode
            if self.mode == TriggerMode.FOOTWORK:
                # Apply micro-timing offsets if using MicroTimingTriggerSource
                # Note: MicroTimingTriggerSource already applies offsets in get_trigger_times,
                # but we can add a small additional random offset for humanization
                if isinstance(self.trigger_source, MicroTimingTriggerSource):
                    # Small additional random offset for extra humanization
                    event.micro_offset = self._rng.uniform(-0.02, 0.02)
                else:
                    # Default small random offset for footwork feel
                    event.micro_offset = self._rng.uniform(-0.03, 0.03)
                
                # Apply saturation for footwork style (saturation-as-texture)
                event.saturation_amount = 0.3 + (velocity * 0.4)  # 0.3-0.7 based on velocity
                
                # Apply swing if using OffbeatTriggerSource
                if isinstance(self.trigger_source, OffbeatTriggerSource):
                    event.swing_amount = self.trigger_source.swing_amount
                
                # Apply envelope sweep for drum-like slices (if slice_bank available)
                if slice_bank and slice_index < len(slice_bank.slices):
                    slice_obj = slice_bank.slices[slice_index]
                    # If it's a drum slice (short duration, high transient), add envelope sweep
                    if slice_obj.duration < 0.5 and slice_obj.transient_strength > 0.7:
                        event.envelope_sweep = 0.5 + (velocity * 0.3)  # 0.5-0.8
            
            # Update state for rule evaluation
            if slice_index == self.state['last_slice_index']:
                self.state['consecutive_plays'] += 1
            else:
                self.state['consecutive_plays'] = 1
            
            self.state['last_slice_index'] = slice_index
            self.state['total_plays'] += 1
            self.state['play_history'].append(slice_index)
            if len(self.state['play_history']) > 16:
                self.state['play_history'].pop(0)
            
            # Apply rules
            for rule in self.rules:
                if not rule.enabled:
                    continue
                
                if self._evaluate_condition(rule.condition):
                    if random.random() < rule.probability:
                        event, should_skip = self._apply_action(rule.action, event, num_slices)
                        if should_skip:
                            skip_next = True
            
            events.append(event)
            self.state['last_trigger_time'] = time
        
        return events
    
    def to_dict(self) -> Dict:
        return {
            'mode': self.mode.value,
            'trigger_source': self.trigger_source.to_dict() if self.trigger_source else None,
            'rules': [r.to_dict() for r in self.rules],
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'TriggerEngine':
        mode = TriggerMode(data.get('mode', 'sequential'))
        source_data = data.get('trigger_source')
        trigger_source = TriggerSource.from_dict(source_data) if source_data else None
        rules = [TriggerRule.from_dict(r) for r in data.get('rules', [])]
        return cls(mode=mode, trigger_source=trigger_source, rules=rules)


# Preset configurations
TRIGGER_PRESETS = {
    'linear': {
        'mode': TriggerMode.SEQUENTIAL,
        'trigger_source': GridTriggerSource(subdivision=1.0),
        'rules': [],
    },
    'sixteenth_notes': {
        'mode': TriggerMode.SEQUENTIAL,
        'trigger_source': GridTriggerSource(subdivision=4.0),
        'rules': [],
    },
    'euclidean_5_8': {
        'mode': TriggerMode.EUCLIDEAN,
        'trigger_source': EuclideanTriggerSource(hits=5, steps=8),
        'rules': [],
    },
    'euclidean_7_16': {
        'mode': TriggerMode.EUCLIDEAN,
        'trigger_source': EuclideanTriggerSource(hits=7, steps=16),
        'rules': [],
    },
    'autechre_basic': {
        'mode': TriggerMode.CHAOS,
        'trigger_source': EuclideanTriggerSource(hits=5, steps=8),
        'rules': [
            TriggerRule(
                id='skip_triple',
                name='Skip after triple',
                condition='consecutive_plays > 3',
                action='skip_next',
                probability=0.7,
            ),
            TriggerRule(
                id='random_on_even',
                name='Random on even plays',
                condition='total_plays % 8',
                action='random_slice',
                probability=0.5,
            ),
        ],
    },
    'autechre_glitch': {
        'mode': TriggerMode.CHAOS,
        'trigger_source': ProbabilityTriggerSource(
            steps=16,
            probabilities=[1, 0.5, 0.8, 0.3, 1, 0.5, 0.7, 0.2, 1, 0.4, 0.9, 0.3, 1, 0.6, 0.8, 0.4],
            subdivision=4.0,
        ),
        'rules': [
            TriggerRule(
                id='pitch_streak',
                name='Pitch up on streak',
                condition='consecutive_plays > 2',
                action='pitch_up_2',
                probability=0.6,
            ),
            TriggerRule(
                id='reverse_random',
                name='Occasional reverse',
                condition='total_plays % 4',
                action='reverse',
                probability=0.3,
            ),
        ],
    },
    # Footwork presets
    'footwork_basic': {
        'mode': TriggerMode.FOOTWORK,
        'trigger_source': PolyrhythmicTriggerSource(
            layers=[
                {'hits': 4, 'steps': 4, 'subdivision': 1.0, 'offset': 0.0},  # Kick on 4/4
                {'hits': 3, 'steps': 4, 'subdivision': 1.0, 'offset': 0.0},  # Snare on 3/4
                {'hits': 5, 'steps': 8, 'subdivision': 2.0, 'offset': 0.0},  # Hats on 5/8
            ]
        ),
        'rules': [],
    },
    'juke_pattern': {
        'mode': TriggerMode.FOOTWORK,
        'trigger_source': JukePatternTriggerSource(
            pattern_name='juke_basic',
            loop_length=4.0,
        ),
        'rules': [],
    },
    'ghetto_house': {
        'mode': TriggerMode.FOOTWORK,
        'trigger_source': OffbeatTriggerSource(
            base_subdivision=4.0,
            offbeat_ratio=1.0 / 3.0,
            swing_amount=0.6,
            pattern=[False, True, False, True, False, True, False, True] * 2,  # Every other step offset
        ),
        'rules': [],
    },
    'footwork_poly': {
        'mode': TriggerMode.FOOTWORK,
        'trigger_source': PolyrhythmicTriggerSource(
            layers=[
                {'hits': 4, 'steps': 4, 'subdivision': 1.0, 'offset': 0.0},    # Kick
                {'hits': 3, 'steps': 4, 'subdivision': 1.0, 'offset': 0.5},    # Snare offset
                {'hits': 5, 'steps': 8, 'subdivision': 2.0, 'offset': 0.0},    # Hats
                {'hits': 7, 'steps': 12, 'subdivision': 3.0, 'offset': 0.0},  # Extra layer
            ]
        ),
        'rules': [],
    },
}


def create_trigger_engine(preset: str = 'linear') -> TriggerEngine:
    """Create a TriggerEngine from a preset name"""
    config = TRIGGER_PRESETS.get(preset, TRIGGER_PRESETS['linear'])
    return TriggerEngine(
        mode=config['mode'],
        trigger_source=config['trigger_source'],
        rules=config.get('rules', []),
    )
