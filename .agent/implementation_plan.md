# Loop Forge: The "Sample Alchemy" Workflow

## 1. The Core Philosophy
Loop Forge is not just a batch processor; it is a **Sample Alchemy Workstation**. Its purpose is to take disparate, raw audio sources and **force them into musical coherence**, creating a unified "Loop Pack" where everything works together.

## 2. The User Workflow

### Phase 1: Ingest & Anchor (The "Crucible")
*   **Action:** User drags in raw audio files (vocals, drums, bass, full tracks).
*   **System Response:**
    *   Instantly analyzes Key, BPM, and spectral characteristics.
    *   Visualizes the "Raw" state.
*   **User Decision:** User selects one track as the **Anchor**.
    *   *This track becomes the "Truth". All other tracks must bend to its will.*

### Phase 2: Transformation (The "Forge")
*   **Action:** User hits "Process" (or it happens auto-magically).
*   **System Response:**
    *   **Time Stretching:** All tracks are warped to match the Anchor's BPM.
    *   **Pitch Shifting:** All tracks are shifted to match the Anchor's Key (using high-quality algorithms like Rubberband/Pedalboard).
    *   **Alignment:** (Future) Transients are aligned to the grid.

### Phase 3: Sculpting & Extraction (The "Anvil")
*   **Action:** User interacts with the *processed* waveforms.
    *   **Visuals:** High-resolution waveforms (not green lines). Spectrogram overlays showing frequency content.
    *   **Looping:** User drags handles to define the "Loop Region" (e.g., bars 1-4).
    *   **Mutation:** User applies "Textures" (DSP chains) or "Evolutions" (AI variations) to specific regions.
    *   **Audition:** User plays tracks in context (Solo/Mute) to ensure the "Pack" sounds cohesive.

### Phase 4: Export (The "Product")
*   **Action:** User downloads the "Pack".
*   **Result:** A ZIP file containing:
    *   Perfectly cut loops (WAV).
    *   Metadata (Key, BPM, Tags).
    *   (Optional) A "Preview" mix of all loops playing together.

## 3. Current Technical Gaps & Fixes

### A. The "Vertical Green Lines" Bug
*   **Diagnosis:** The waveform renderer is likely drawing *transient markers* (vertical lines) but failing to draw the actual *waveform data*. This usually happens when the audio buffer isn't decoded correctly or the canvas scaling is off.
*   **Fix:** Switch to a robust Canvas renderer that ensures the PCM data is visible.

### B. "Advanced Mode" Distraction
*   **Fix:** Remove the toggle. The "Advanced" Timeline View is now the **Default View**.
*   **Refinement:** The "Source Deck" and "Loop Deck" should be integrated. You upload, it analyzes, you see the waveform *immediately*.

### C. Loop Creation Logic
*   **Fix:** The "Crop" handles in the UI must directly map to the `ffmpeg` cut command in the backend. Currently, they might just be visual. We need to ensure the `cropStart` and `cropEnd` are sent to the export endpoint.

## 4. Immediate Action Plan
1.  **Fix Waveform Rendering:** Debug `LoopWaveform.tsx` to ensure PCM data is drawn, not just transient markers.
2.  **Unify UI:** Remove "Simple/Advanced" toggle. Make the Timeline Editor the primary interface.
3.  **Verify Export:** Ensure the "Download Selection" button respects the user's crop handles.
