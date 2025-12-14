# Loop Forge Progress & Future Ideas

## Completed
- [x] Backend v2 alignment (startup, endpoints, stem URLs)
- [x] Real slice banks + real slice playback
- [x] MPC-style 4-bar loop recording (overdub/replace)
- [x] 1/32-1/64 grid with microtiming + swing
- [x] Clip Editor with Ableton shortcuts (Cmd+C/X/V/D)
- [x] Performance pass (memoization, throttled updates, stable scheduling)

### CTO-Level Pipeline Improvements (Dec 2024)
- [x] **`GET /api/capabilities`** - Backend-driven feature flags + limits
- [x] **Enhanced upload response** - Returns raw file URL + source asset ID for instant preview
- [x] **Polling fallback** - If WebSocket drops, frontend auto-polls `/api/jobs` (never stuck)
- [x] **Cancel Processing button** - Cancel running jobs and restart cleanly
- [x] **Peaks endpoints** - `GET /api/assets/{id}/peaks` + `GET /api/assets/session/{id}/source/peaks`
- [x] **PeaksWaveform on loading screen** - Instant visual waveform without full browser decode
- [x] **MOMENTS job type** - Auto-queued on upload, detects hits/phrases/textures/changes
- [x] **PEAKS job type** - Auto-queued on upload for fast waveform rendering
- [x] **Moments display on loading screen** - Shows detected moments while stems process
- [x] **Moments passed to workspace** - MomentsTimeline receives pre-detected moments
- [x] **Auto-kit** - After separation, auto-creates slice bank from drums, loads best 16 slices to pads
- [x] **Keyboard shortcuts help** - Press `?` to see all shortcuts overlay

## In Progress
- [ ] "Instant Gratification" pipeline
  - [x] Playable while processing (raw preview + peaks waveform)
  - [x] Auto-kit: best 16 slices → pads (by transient strength + energy)
  - [x] One-button "Start Sketch" (ensures slices ready, arms recording, starts playback)
- [ ] "Moments" system (Octatrack brain)
  - [x] Backend: detect hits/phrases/textures/energy changes
  - [x] Frontend: moments timeline with clickable regions
  - [x] Mark In/Out → Send region to pads

## Future Polish (High Priority)
### Resample Ritual
- Bounce 4 bars → New Sample → Auto-slice → Pads
- Creates the addictive "make → commit → remix your own output" loop

### Feel Presets
- "Dilla Loose" / "Tight" / "Drunk" / "Machine"
- Per-preset: swing curve, velocity randomization, microtiming limits, note length

### Macros (Big Knobs)
- "Crunch" / "Space" / "Blur" / "Air" / "Pitch Drift" / "Tape Wobble"
- Single controls that instantly create vibe

### Pad Pages / Programs
- Page A/B/C/D like MPC banks
- Page A = best 16, Page B = alternates, Page C = textures, Page D = weirdness

### Velocity Curves
- MPC-style velocity response presets
- Adjustable sensitivity

## Future Polish (Medium Priority)
### Vocal + FX Pipeline
- Per-stem FX rack: bitcrush, filter, distortion, delay/reverb
- Vocal pitch/time tools (monophonic Melodyne-like)
- Automation lanes

### Clip Lanes / Scene Launching
- Each stem has a lane of 4-bar clips
- Scene launching for arrangement
- Variations per scene

### Crate / Library System
- Tag uploads: Drums, Textures, Voices, Melodies, Weird
- "Give me a kit from Textures + Voices"

### Auto-Kit Suggestions
- From long file, generate:
  - Drum kit (kicks/snares/hats candidates)
  - Texture pad bank (long slices, loopable)
  - Vocal phrase bank

## Technical Debt
- [ ] Error handling + reconnection
- [ ] Basic tests/fixtures
- [ ] Virtualized waveform rendering for huge files
- [ ] Web Worker audio analysis
