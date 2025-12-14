# Loop Forge: The "Sample Alchemy" Workstation
**Vision Document & Technical Blueprint**

## 1. Core Philosophy
**"Not a Generator, But a Transformer."**
Loop Forge is a professional-grade audio workstation designed for sample-based producers. It does not generate music from prompts. Instead, it takes the user's raw, disparate audio sources and forces them into musical coherence through advanced DSP, AI analysis, and precise user control.

## 2. The Workflow (The "Oval" Process)

### Phase 1: Ingest & Separation (The Raw Material)
*   **Input:** User uploads long audio files (full songs, 5min jams, voice memos).
*   **Action:** System automatically separates sources into stems (Drums, Vocals, Bass, Melody) using Demucs v4.
*   **Analysis:** Immediate extraction of Key, BPM, and Spectral Profile for every stem.

### Phase 2: The "Anchor" (The Source of Truth)
*   **Concept:** One track is designated as the **Anchor**.
*   **Rule:** All other tracks must bend to the Anchor's will.
    *   **Time:** All tracks stretch/compress to match the Anchor's BPM.
    *   **Pitch:** All tracks shift to match the Anchor's Key (using high-fidelity algorithms like Rubberband/Pedalboard).
*   **User Control:** User explicitly selects the Anchor.

### Phase 3: Smart Looping & Chopping (The "Loop Factory")
*   **Drums:**
    *   **Tech:** Transient Detection (Onset detection).
    *   **Logic:** Auto-slice loops based on transient markers. Ensure start/end points snap perfectly to zero-crossings or transients to prevent clicks.
*   **Vocals/Melody:**
    *   **Tech:** Saliency Detection (Vocal Activity + "Catchiness" heuristics).
    *   **Logic:** Identify high-energy or melodic sections. Create loops (2, 4, 8 bars) that capture complete phrases.
*   **Grid Snapping:** All crops align to the detected beat grid of the original sample.

### Phase 4: Evolution & Alchemy (The "Forge")
*   **Concept:** Non-destructive effects chains applied to specific loops.
*   **Tools:**
    *   **Bitcrush/Distortion:** For drums/bass.
    *   **Spectral Gating:** For cleaning up noise.
    *   **Formant Shifting:** For altering vocal character without changing pitch.
    *   **Granular Scattering:** For creating textures from melodic elements.
*   **User Control:** Toggle effects, adjust "Texture" presets (e.g., "Shadow", "Sparkle", "Grit").

### Phase 5: The Workstation (UI/UX)
*   **Aesthetic:** Dark, Industrial, Hardware-inspired. High contrast, precision lines.
*   **Visualization:**
    *   Real PCM Waveforms (not just markers).
    *   Spectrogram overlays.
    *   Transient markers visible and editable.
*   **Interaction:**
    *   **Manual Crop:** Drag handles to adjust loop start/end.
    *   **Snap-to-Grid/Transient:** Handles snap magnetically to detected beats or transients.
    *   **Contextual Preview:** Solo/Mute tracks to hear how they layer.
*   **No "One-Click" Magic:** The user is in control. The AI suggests; the user decides.

### Phase 6: Export
*   **Output:** A ZIP file containing the processed, perfectly cut loops.
*   **Format:** High-quality WAV.
*   **Metadata:** Files tagged with Key, BPM, and Source Role.

## 3. Technical Requirements & Stack

### Backend (Python/FastAPI)
*   **Audio Processing:** `librosa` (analysis), `torchaudio` (loading), `pedalboard` (VST-like effects), `rubberband` (time/pitch).
*   **AI Models:** `Demucs v4` (separation), `Silero VAD` (vocal detection).
*   **Loop Logic:** Custom `LoopFactory` engine that uses onset strength and beat tracking to find optimal loop points.

### Frontend (React/Vite)
*   **State Management:** Complex state for tracking multiple layers of undo/redo and parameter changes.
*   **Audio Engine:** `Tone.js` for real-time preview and effects (mirroring backend).
*   **Visualization:** Canvas-based waveform renderer (custom or heavily customized `wavesurfer.js`/`peaks.js`).

## 4. Forbidden Patterns
*   **No Generative AI:** Do not use MusicGen or similar "text-to-audio" models.
*   **No "Dream" Terminology:** Rename `DreamFactory` to `AlchemyEngine` or `EvolutionEngine`.
*   **No Hidden Logic:** Show the user exactly *why* a decision was made (e.g., "Shifted +2st to match C Minor").
