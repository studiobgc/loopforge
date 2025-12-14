# Autechre Production Techniques Research
## Focus: "Latent Quarter" Era (Quaristice, 2008) & Generative Sample Triggering

---

## Executive Summary

**You're essentially correct**: Autechre's approach is fundamentally about **triggering and manipulating slices of audio in non-linear, rule-based ways** — exactly what you're describing. However, they don't use traditional "modular synths" in the hardware Eurorack sense. Instead, they built **custom software modular systems in Max/MSP** that function like modular synths but operate on MIDI data, triggering samples and manipulating parameters in real-time.

The core insight: **Their "instruments" are custom sequencers that decide *when* and *how* to trigger pre-sliced audio segments based on rules, probabilities, and interconnected feedback loops.**

---

## Part I: What Autechre Actually Uses

### Hardware (Historical)

| Era | Key Gear | Role |
|-----|----------|------|
| **Pre-1997** | Roland R-8 drum machine | Pads triggered samplers via MIDI; sequenced other gear |
| **Pre-1997** | Ensoniq EPS sampler | Custom OS for elaborate patch modulation |
| **Pre-1997** | Casio SK-1, SK-5 | Circuit-bent samplers for lo-fi textures |
| **1995+** | Nord Lead / Nord Modular | Rhythmic patches (up to 32 sounds), live manipulation |
| **1996** | Roland PMA-5 | Touchscreen sequencer (used on EP7) |
| **Throughout** | Alesis QuadraVerb | Real-time MIDI-controlled effects |
| **Throughout** | Analogue sequencers (various) | Pattern restart/manipulation, non-linear triggering |

### Software (Post-1997, Dominant Post-2001)

| Tool | Role |
|------|------|
| **Max/MSP** | Primary instrument — custom sequencers, generative systems, MIDI manipulation |
| **Digital Performer** | DAW for recording/arranging |
| **Kyma (Symbolic Sound)** | Advanced sound design |
| **Custom patches** | One-off tools built for specific tracks |

### Key Quote (Sean Booth, 2016):
> "I just use Max/MSP now, because in Max I can generally build the thing I need... So rather than spend money on equipment, I spend money—as time—in learning how to build stuff."

---

## Part II: The "Latent Quarter" / Quaristice Era Technique

### Album Context

**Quaristice (2008)** was described by Sean Booth as:
> "untilted - densely programmed step sequenced kit. quaristice - **looser & sparser live jams with hardware**."

This era represents a return to more **immediate, performance-based recording** after the heavily computed Confield/Draft 7.30 period. Tracks were shorter, more spontaneous, often **first-take recordings of generative systems being manipulated in real-time**.

### Core Technique: Controlled Generative Sequencing

Autechre's approach is NOT random. It's **rule-based generative sequencing** with real-time human control:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTECHRE SEQUENCING MODEL                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │  SAMPLE BANK │────▶│  SLICE MAP   │────▶│  TRIGGER     │   │
│   │  (stems,     │     │  (transients,│     │  ENGINE      │   │
│   │   loops,     │     │   onsets,    │     │  (Max/MSP    │   │
│   │   hits)      │     │   phrases)   │     │   patch)     │   │
│   └──────────────┘     └──────────────┘     └──────┬───────┘   │
│                                                     │           │
│                              ┌──────────────────────┴────┐      │
│                              │                           │      │
│                              ▼                           ▼      │
│                    ┌──────────────┐          ┌──────────────┐   │
│                    │  RULE SET    │◀────────▶│  FADER/KNOB  │   │
│                    │  • if snare  │          │  CONTROL     │   │
│                    │    plays 3x, │          │  (human      │   │
│                    │    then...   │          │   intervention)  │
│                    │  • probability│         │              │   │
│                    │    curves    │          └──────────────┘   │
│                    └──────────────┘                             │
│                              │                                  │
│                              ▼                                  │
│                    ┌──────────────┐                             │
│                    │   OUTPUT     │                             │
│                    │   (audio)    │                             │
│                    └──────────────┘                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Sean Booth's Explanation (Sound on Sound, 2001):

> "When we do generative stuff we work with **real-time manipulation of MIDI faders** that determines what the rhythms sound like. A sequencer is spitting out stuff and we're using our ears and the faders to make the music."

> "We may have **one fader that determines how often a snare does a little roll or skip**, and another thing that listens and says 'If that snare plays that roll three times, then I'll do this.'"

> "We don't use random operators because they're irritating to work with — every time you run the process it sounds different. **How we play the system dictates how the system responds.**"

### The "Restarting Patterns" Technique

This is crucial for understanding their rhythmic complexity:

> "On Confield we also used analogue sequencers and drum machines, because **you can do a lot with restarting patterns**. You can hack things and maybe **use a control voltage to determine what step the drum machine is playing from**. Perhaps you send that control voltage from an analogue sequencer, so the drum machine is skipping around. And then you get another analogue sequencer to drive that analogue sequencer with a different timing."

**Translation for your app**: Instead of playing a sample linearly, you **jump to different slice positions** based on a controlling sequence. The "controlling sequence" can be:
- Another audio file's transients
- A MIDI pattern
- A probability curve
- User gestures

---

## Part III: Implementation for Loop Forge

### Feature: "Generative Slice Sequencer"

This would be the Autechre-inspired feature that lets users "play" their separated stems in generative ways:

#### 1. Slice Detection (Already Partially Built)

Your existing `LoopFactory` with onset detection handles this. Enhance it:

```python
@dataclass
class Slice:
    index: int
    start_sample: int
    end_sample: int
    start_time: float
    end_time: float
    transient_strength: float    # How "hard" the transient is
    spectral_centroid: float     # Brightness — useful for sorting
    rms_energy: float            # Loudness
    duration: float
    zero_crossing_start: int     # For click-free playback
    zero_crossing_end: int

class SliceBank:
    """A bank of slices from a single stem"""
    stem_id: str
    role: str  # drums, bass, vocals, other
    slices: List[Slice]
    total_duration: float
    bpm: float
    key: str
    
    def get_slice(self, index: int) -> Slice:
        """Get slice by index (wraps around)"""
        return self.slices[index % len(self.slices)]
    
    def get_slice_by_time(self, time: float) -> Slice:
        """Get slice that contains this time position"""
        ...
    
    def get_random_slice(self, weighted_by: str = 'energy') -> Slice:
        """Get a slice with probability weighted by attribute"""
        ...
```

#### 2. Trigger Engine (New Component)

The core innovation — a MIDI/event-driven system that triggers slices:

```python
from dataclasses import dataclass
from typing import Callable, Optional, List
from enum import Enum

class TriggerMode(Enum):
    SEQUENTIAL = "sequential"      # Play slices in order
    RANDOM = "random"              # Random selection
    PROBABILITY = "probability"    # Weighted by attribute
    MIDI_MAP = "midi_map"          # MIDI note → slice index
    PATTERN = "pattern"            # Follow a pattern array
    FOLLOW = "follow"              # Follow another stem's transients

@dataclass
class TriggerEvent:
    time: float           # When to trigger (in beats or seconds)
    slice_index: int      # Which slice to play (-1 for "decide at runtime")
    velocity: float       # 0-1, affects volume/filter
    duration: float       # How long to play (can be shorter than slice)
    pitch_shift: int      # Semitones
    reverse: bool         # Play backwards
    
@dataclass 
class TriggerRule:
    """A conditional rule that modifies behavior"""
    condition: str        # e.g., "if slice[drums].plays > 3"
    action: str           # e.g., "skip next slice"
    probability: float    # 0-1, chance of rule firing

class TriggerEngine:
    """
    The Autechre-style generative sequencer.
    
    Takes a SliceBank and a trigger source, produces TriggerEvents.
    """
    
    def __init__(
        self,
        slice_bank: SliceBank,
        mode: TriggerMode = TriggerMode.SEQUENTIAL,
        rules: List[TriggerRule] = None
    ):
        self.slice_bank = slice_bank
        self.mode = mode
        self.rules = rules or []
        self.state = {}  # Track internal state for rules
        
    def generate_sequence(
        self,
        duration_beats: float,
        bpm: float,
        trigger_source: Optional['TriggerSource'] = None
    ) -> List[TriggerEvent]:
        """
        Generate a sequence of trigger events.
        
        If trigger_source is provided (e.g., a MIDI pattern or another
        stem's transients), use that to determine timing.
        Otherwise, use internal timing based on mode.
        """
        events = []
        
        if trigger_source:
            # Follow external trigger timing
            for trigger_time in trigger_source.get_trigger_times():
                slice_idx = self._select_slice(trigger_time)
                events.append(TriggerEvent(
                    time=trigger_time,
                    slice_index=slice_idx,
                    velocity=trigger_source.get_velocity(trigger_time),
                    duration=self._calculate_duration(slice_idx),
                    pitch_shift=0,
                    reverse=False
                ))
        else:
            # Self-driven sequencing
            current_time = 0
            while current_time < duration_beats:
                slice_idx = self._select_slice(current_time)
                slice_duration = self.slice_bank.get_slice(slice_idx).duration
                
                events.append(TriggerEvent(
                    time=current_time,
                    slice_index=slice_idx,
                    velocity=1.0,
                    duration=slice_duration,
                    pitch_shift=0,
                    reverse=False
                ))
                
                current_time += slice_duration * (bpm / 60)
        
        # Apply rules
        events = self._apply_rules(events)
        
        return events
    
    def _select_slice(self, time: float) -> int:
        """Select which slice to play based on mode"""
        if self.mode == TriggerMode.SEQUENTIAL:
            # Use time to determine position in sequence
            return int(time) % len(self.slice_bank.slices)
        
        elif self.mode == TriggerMode.RANDOM:
            import random
            return random.randint(0, len(self.slice_bank.slices) - 1)
        
        elif self.mode == TriggerMode.PROBABILITY:
            # Weight by transient strength
            weights = [s.transient_strength for s in self.slice_bank.slices]
            # ... weighted random selection
            pass
        
        # ... other modes
    
    def _apply_rules(self, events: List[TriggerEvent]) -> List[TriggerEvent]:
        """Apply conditional rules to modify the sequence"""
        # Track state and apply rules
        # e.g., "if the same slice plays 3 times, skip the next one"
        return events
```

#### 3. Trigger Sources

Multiple ways to drive the sequencer:

```python
class TriggerSource(ABC):
    """Abstract base for things that can trigger slices"""
    
    @abstractmethod
    def get_trigger_times(self) -> List[float]:
        """Return list of times (in beats) when triggers should fire"""
        pass
    
    @abstractmethod
    def get_velocity(self, time: float) -> float:
        """Return velocity/intensity at a given time"""
        pass

class MIDITriggerSource(TriggerSource):
    """Use a MIDI file/pattern to trigger slices"""
    
    def __init__(self, midi_data: bytes, target_note_range: tuple = (36, 84)):
        self.midi_data = midi_data
        self.note_range = target_note_range
        self._parse_midi()
    
    def get_trigger_times(self) -> List[float]:
        return [note.time for note in self.notes]
    
    def get_velocity(self, time: float) -> float:
        # Find note at this time
        for note in self.notes:
            if abs(note.time - time) < 0.001:
                return note.velocity / 127
        return 1.0

class TransientFollowSource(TriggerSource):
    """
    Use another audio stem's transients as trigger source.
    
    This is the Autechre technique of having one pattern "drive" another.
    """
    
    def __init__(self, driver_stem: SliceBank):
        self.driver = driver_stem
    
    def get_trigger_times(self) -> List[float]:
        return [slice.start_time for slice in self.driver.slices]
    
    def get_velocity(self, time: float) -> float:
        for slice in self.driver.slices:
            if abs(slice.start_time - time) < 0.001:
                return slice.transient_strength
        return 1.0

class EuclideanTriggerSource(TriggerSource):
    """
    Generate triggers using Euclidean rhythms.
    
    Euclidean rhythms distribute N hits as evenly as possible
    over M steps — creates interesting polyrhythms.
    """
    
    def __init__(self, hits: int, steps: int, rotation: int = 0):
        self.hits = hits
        self.steps = steps
        self.rotation = rotation
        self._generate_pattern()
    
    def _generate_pattern(self):
        """Bjorklund's algorithm for Euclidean rhythms"""
        # ... implementation
        pass

class ProbabilityTriggerSource(TriggerSource):
    """
    Probability-based triggering — like Elektron-style parameter locks.
    
    Each step has a probability of firing.
    """
    
    def __init__(
        self,
        steps: int,
        base_probability: float = 1.0,
        probability_curve: List[float] = None
    ):
        self.steps = steps
        self.base_prob = base_probability
        self.curve = probability_curve or [base_probability] * steps
```

#### 4. Frontend: Slice Sequencer UI

```typescript
interface SliceSequencerProps {
  sliceBank: SliceBank;
  onSequenceChange: (events: TriggerEvent[]) => void;
}

// Modes the user can select
type SequencerMode = 
  | 'linear'        // Play slices in order (like normal playback)
  | 'midi'          // MIDI file drives slice selection
  | 'follow'        // Follow another stem's rhythm
  | 'euclidean'     // Euclidean rhythm generator
  | 'probability'   // Each slice has a play probability
  | 'chaos'         // Full Autechre mode — rules + probability + feedback

interface SliceSequencerState {
  mode: SequencerMode;
  triggerSource: TriggerSource | null;
  rules: TriggerRule[];
  
  // Visual state
  activeSliceIndex: number;
  isPlaying: boolean;
}
```

---

## Part IV: UI/UX for the Slice Sequencer

### The "Ableton Simpler" Comparison

You mentioned Ableton's sample slicer. Here's the comparison:

| Ableton Simpler/Sampler | Loop Forge Slice Sequencer |
|------------------------|---------------------------|
| Manual slice markers OR auto-transient | Auto-transient with AI-assisted phrase detection |
| MIDI note → slice (chromatic mapping) | MIDI note → slice + probability + rules |
| Static mapping | Dynamic mapping that can change mid-sequence |
| Single stem | Multi-stem (slices from drums can trigger slices in bass) |
| No rule engine | Conditional rules ("if X then Y") |

### Visual Concept: "The Slice Grid"

```
┌─────────────────────────────────────────────────────────────────────┐
│  SLICE SEQUENCER                                    [▶ PLAY] [⬜]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SOURCE: drums_separated.wav                                        │
│  ──────────────────────────────────────────────────────────────     │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  WAVEFORM WITH SLICE MARKERS                                 │   │
│  │  |▓▓▓|▓▓|▓▓▓▓▓|▓▓|▓▓▓|▓▓▓▓|▓▓|▓▓▓▓▓▓|▓▓▓|▓▓|▓▓▓▓|▓▓▓▓▓|     │   │
│  │   1   2    3    4   5    6   7    8     9  10   11    12     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  TRIGGER MODE: [Euclidean ▼]   HITS: [5]  STEPS: [8]  ROTATE: [0]  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SEQUENCE GRID (8 steps)                                     │   │
│  │                                                              │   │
│  │  Step:    1     2     3     4     5     6     7     8        │   │
│  │           ●     ○     ●     ○     ●     ●     ○     ●        │   │
│  │                                                              │   │
│  │  Slice:  [1]   [ ]   [3]   [ ]   [5]   [6]   [ ]   [8]       │   │
│  │  Prob:   100%  --    80%   --    100%  60%   --    100%      │   │
│  │  Vel:    ███   --    ██░   --    ███   █░░   --    ███       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  RULES:                                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  [+] Add Rule                                                │   │
│  │                                                              │   │
│  │  IF slice 1 plays 3x consecutive → THEN skip next trigger    │   │
│  │  IF velocity > 0.8              → THEN add +2st pitch        │   │
│  │  IF step is even                → THEN 50% chance reverse    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  CROSS-STEM LINK: [Link to: bass ▼]  [Delay: 1/16 ▼]               │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  [EXPORT SEQUENCE AS MIDI]        [RENDER TO AUDIO]                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part V: Implementation Phases

### Phase 1: Basic Slice Playback (MVP)
- [ ] Enhance onset detection to create clean slice boundaries (zero-crossings)
- [ ] Build `SliceBank` data structure
- [ ] Frontend: Display slices on waveform, allow clicking to preview
- [ ] MIDI input: Map notes to slices (Ableton-style)

### Phase 2: Trigger Sources
- [ ] MIDI file import → `MIDITriggerSource`
- [ ] Euclidean rhythm generator → `EuclideanTriggerSource`
- [ ] Cross-stem following → `TransientFollowSource`

### Phase 3: Rule Engine (Autechre Mode)
- [ ] Define rule grammar (IF condition THEN action)
- [ ] Build rule parser and executor
- [ ] State tracking for conditional logic
- [ ] Frontend: Rule builder UI

### Phase 4: Real-Time Control
- [ ] MIDI CC input for live parameter control
- [ ] "Fader" control for probability weighting
- [ ] Live recording of parameter changes

---

## Appendix: Key Autechre Quotes for Inspiration

**On "randomness":**
> "For me it's just messing around with a lot of analogue sequencers and drum machines. It's like saying, 'I want this to go from this beat to that beat over this amount of time, with this curve, which is shaped according to this equation.'"

**On generative music:**
> "It just gets massively overblown because people think it's dead interesting, but it's not is it? To me it's just like a bunch of arpeggiators plugged into each other."

**On the learning curve:**
> "You need to have the bottle to build the skills you need. A lot of people build skills for just one environment... Whereas I'm a bit of a mutant."

**On visual interfaces:**
> "The worst things are the timeline sequencers where you can see on the screen what's coming up. That really f**ks with your head when you're listening."

---

*This document serves as both research reference and implementation guide for adding Autechre-inspired generative sequencing to Loop Forge.*
