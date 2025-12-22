# Footwork Production Techniques

## Overview

This document describes the footwork production capabilities added to LoopForge, based on Chicago footwork's core techniques: polyrhythmic layering, micro-timing offsets, TR-808 style synthesis, and saturation-as-texture processing.

## Core Concepts

### Polyrhythmic Layering

Footwork's signature sound comes from layering multiple time signatures simultaneously. Instead of a single 4/4 pattern, footwork producers layer:
- Kick on 4/4
- Snare on 3/4
- Hi-hats on 5/8
- Additional layers on other time signatures

This creates perceived "chaos" that's actually rigorously structured polyrhythmic complexity.

**Usage in LoopForge:**
- Use `PolyrhythmicTriggerSource` to define multiple layers
- Each layer has its own `hits`, `steps`, `subdivision`, and `offset`
- Layers are merged and sorted by time to create the final pattern

### Micro-Timing Offsets

MPC-style manual timing adjustments create human feel. Instead of quantizing everything to the grid, footwork producers intentionally place hits slightly ahead or behind the beat.

**Usage in LoopForge:**
- `MicroTimingTriggerSource` wraps any trigger source
- Apply per-step offsets or random offsets within a range
- Offsets are in beats (tempo-independent)
- Example: `-0.05` = 5% of a beat behind, `0.1` = 10% ahead

### TR-808 Style Synthesis

The TR-808 kick drum's signature sound comes from a pitch envelope sweep: the frequency starts high (60Hz) and decays exponentially to low (20Hz). This creates the "thump" that defines footwork's low-end.

**Usage in LoopForge:**
- `FootworkDrumEngine` synthesizes TR-808 style drums
- Kick: Sine wave with exponential pitch decay
- Snare: Noise burst + short sine tail
- Hi-hat: Filtered noise with short decay
- Envelope sweep parameter controls pitch decay amount

### Saturation-as-Texture

In footwork, distortion isn't just an effect—it's a compositional tool. Heavy saturation creates the "grit" that defines the genre. This is saturation-as-texture, not saturation-to-fix.

**Usage in LoopForge:**
- `saturation_amount` parameter (0-1) on trigger events
- EvolutionEngine includes footwork-specific saturation presets
- Applied per-layer or per-event for granular control

## Implementation Details

### TriggerEvent Extensions

The `TriggerEvent` dataclass now includes footwork-specific fields:

```python
micro_offset: float = 0.0        # Timing offset in beats
envelope_sweep: Optional[float]  # TR-808 pitch sweep (0-1)
saturation_amount: float = 0.0   # Saturation level (0-1)
swing_amount: float = 0.0        # Swing/triplet feel (0-1)
```

### TriggerSource Types

#### PolyrhythmicTriggerSource

Generates triggers across multiple simultaneous time signatures:

```python
source = PolyrhythmicTriggerSource(
    layers=[
        {'hits': 4, 'steps': 4, 'subdivision': 1.0, 'offset': 0.0},  # Kick
        {'hits': 3, 'steps': 4, 'subdivision': 1.0, 'offset': 0.0},  # Snare
        {'hits': 5, 'steps': 8, 'subdivision': 2.0, 'offset': 0.0},  # Hats
    ]
)
```

#### MicroTimingTriggerSource

Wraps another source and adds timing offsets:

```python
source = MicroTimingTriggerSource(
    base_source=GridTriggerSource(subdivision=4.0),
    offset_range=(-0.1, 0.1),  # Min/max offset in beats
    randomize=True,  # Or use offset_pattern for per-step offsets
)
```

#### JukePatternTriggerSource

Predefined juke/footwork patterns:

```python
source = JukePatternTriggerSource(
    pattern_name='juke_basic',  # or 'ghetto_house', 'footwork_poly'
    loop_length=4.0,
)
```

#### OffbeatTriggerSource

Offbeat timing (1/3 notes off grid):

```python
source = OffbeatTriggerSource(
    base_subdivision=4.0,  # 16th notes
    offbeat_ratio=1.0 / 3.0,  # Triplet feel
    swing_amount=0.6,
    pattern=[False, True, False, True, ...],  # Which steps get offset
)
```

### FOOTWORK Mode

The `TriggerMode.FOOTWORK` mode combines:
- Polyrhythmic layering
- Probability weighting by slice transient strength
- Automatic micro-timing offsets
- Saturation application

### Presets

Available footwork presets in `TRIGGER_PRESETS`:

- `footwork_basic`: Classic polyrhythmic pattern (4/4 kick, 3/4 snare, 5/8 hats)
- `juke_pattern`: Juke-style rhythm pattern
- `ghetto_house`: Offbeat swing pattern
- `footwork_poly`: Complex multi-layer polyrhythmic pattern

## API Endpoints

### POST /api/footwork/synthesize-drum

Synthesize a TR-808 style drum hit:

```json
{
  "drum_type": "kick",
  "freq_start": 60.0,
  "freq_end": 20.0,
  "decay": 0.5,
  "saturation": 0.3,
  "duration": 0.5
}
```

Returns base64-encoded WAV audio data.

### POST /api/footwork/generate-pattern

Generate a footwork pattern sequence:

```json
{
  "preset": "footwork_basic",
  "duration_beats": 4.0,
  "bpm": 160.0,
  "num_slices": 16
}
```

Returns a list of trigger events with footwork parameters.

### GET /api/footwork/presets

List all available footwork presets.

## Frontend Components

### FootworkSequencer

Full-featured footwork pattern sequencer:
- Polyrhythmic layer management
- Micro-timing offset editor (MPC-style)
- Saturation controls per layer
- Preset selector

### DrumSynthesizer

TR-808 style drum synthesis UI:
- Kick/Snare/Hat tabs
- Frequency/Decay/Saturation controls
- Real-time preview
- Export to slice bank

### SliceSequencer Extensions

The existing `SliceSequencer` component now includes:
- Footwork mode in mode selector
- Footwork-specific controls (saturation, swing)
- Integration with footwork presets

## Audio Engine Integration

The `LoopForgeAudioEngine` now handles:

1. **Micro-timing offsets**: Applied to trigger time (converted from beats to seconds)
2. **Envelope sweeps**: Modulates playback rate for TR-808 style pitch decay
3. **Saturation**: WaveShaper node with soft clipping curve

All footwork parameters are applied in the audio thread for sample-accurate timing.

## Classic Footwork Patterns

### Juke Basic

```
Kick: 1, 2.5, 4, 4.5
Snare: 1.5, 3, 4.5
Hats: 2, 3.5
```

### Ghetto House

```
Kick: 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5
Snare: 1.5, 3.5
Hats: Every 1/4 note with swing
```

### Footwork Poly

Complex polyrhythmic layering with multiple time signatures running simultaneously.

## Best Practices

1. **Start with presets**: Use `footwork_basic` or `juke_pattern` as starting points
2. **Layer gradually**: Add one polyrhythmic layer at a time
3. **Micro-timing sparingly**: Too much offset sounds sloppy; subtle is better
4. **Saturation in moderation**: 0.3-0.5 is usually enough; higher for aggressive tracks
5. **Envelope sweeps for kicks**: Use `envelope_sweep` 0.5-0.8 for TR-808 style kicks

## References

- RP Boo - Pioneer of footwork production
- DJ Rashad - Classic footwork patterns
- Traxman - Polyrhythmic complexity
- DJ Deeon - Ghetto house foundation

## Technical Notes

- All timing is in beats (tempo-independent)
- Micro-offsets are applied in the audio engine for sample accuracy
- Saturation uses WaveShaper with 4x oversampling for quality
- Envelope sweeps use exponential decay for authentic TR-808 feel

