# The Chimera Protocol: Split-Anchor Synthesis
**Status:** Proposed
**Objective:** Enable "Dual-Anchor" workflow where Rhythm and Harmony are derived from separate sources.

## 1. The Concept
The current "Dictator" model (Single Anchor) is limited. We introduce the **Chimera Model**:
- **Rhythm Anchor (The Skeleton):** Dictates BPM, Grid, and Swing.
- **Harmonic Anchor (The Flesh):** Dictates Key, Scale, and Formant Character.

## 2. The Algorithm
For a session with $N$ tracks, let:
- $T_r$ be the Rhythm Anchor Track (BPM $B_r$).
- $T_h$ be the Harmonic Anchor Track (Key $K_h$).

For every track $T_i$ (with BPM $B_i$, Key $K_i$):
1.  **Time Stretch Rate ($R_i$):** $R_i = B_r / B_i$
    - If $T_i == T_r$, $R_i = 1.0$.
    - If $T_i == T_h$, $R_i = B_r / B_h$.
2.  **Pitch Shift ($S_i$):** $S_i = \text{distance}(K_i, K_h)$
    - If $T_i == T_h$, $S_i = 0$.
    - If $T_i == T_r$, $S_i = \text{distance}(K_r, K_h)$.

## 3. Implementation Plan

### Phase 1: Engine Verification (Completed)
- Validated `TimeStretchEngine` can stretch vocals (120->160bpm) while preserving pitch.
- Validated `PitchEngine` can shift drums (C->F#) while preserving timing.

### Phase 2: API Upgrade (`ForgeService`)
- Update `process_session` signature to accept `chimera_config`:
  ```python
  @dataclass
  class ChimeraConfig:
      rhythm_source_id: str
      harmonic_source_id: str
  ```
- Refactor the "Analysis" step to extract Global Targets *before* processing individual tracks.

### Phase 3: Frontend "Chimera UI"
- **"DNA Splicer" Interface:**
    - Drag "BPM" from Track A to the "Master Clock".
    - Drag "Key" from Track B to the "Master Key".
- **Visual Feedback:**
    - Show "Elasticity" (How much a track is being stretched).
    - Show "Tension" (How much a track is being shifted).

## 4. "Mind-Blowing" Extensions
- **Groove Extraction:** Don't just match BPM. Extract the *micro-timing* (swing/shuffle) of the Rhythm Anchor and warp the other tracks to match the *groove*, not just the grid.
- **Formant Morphing:** When shifting vocals to match the key, optionally shift formants to match the *timbre* of the Harmonic Anchor (e.g., if Harmonic Anchor is a deep bass, slightly lower vocal formants).
