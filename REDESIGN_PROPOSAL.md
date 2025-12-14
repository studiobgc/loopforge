# Loop Forge: Complete Architecture & UX Redesign
## Codename: **CHIMERA v2** — "Precision Engineering Meets Cinematic Design"

---

## Executive Summary

The current codebase suffers from:
1. **Backend fragility**: 1600+ line monolithic route files, entangled services, no job queue, brittle session management
2. **Frontend dissonance**: Dated VST aesthetics that don't match the aspirational workflow
3. **Buried UX**: The core value prop (bulk upload → separate → download + experimentation) is obscured by complexity

This redesign proposes:
- **Modular, testable backend** with proper separation of concerns
- **Cinematic UI** inspired by Arrival (alien linguistics), Sneakers (heist precision), Google (clarity), MIT (rigor)
- **Two-track UX**: "Quick Export" mode (lalal.ai competitor) + "Laboratory" mode (samplebase experimentation)

---

## Part I: Backend Architecture Redesign

### Current Problems

```
forge_routes.py (1612 lines) ← MONOLITH
├── Upload logic
├── Session management  
├── Analysis orchestration
├── Processing pipelines
├── WebSocket handlers
├── File serving
└── Everything else mixed together
```

### Proposed Architecture

```
backend/
├── app/
│   ├── core/                    # Foundation layer
│   │   ├── config.py            # Environment, constants
│   │   ├── exceptions.py        # Custom exceptions
│   │   └── logging.py           # Structured logging
│   │
│   ├── domain/                  # Business logic (PURE, NO I/O)
│   │   ├── models.py            # Pydantic models, dataclasses
│   │   ├── audio_analysis.py    # Key, BPM, transient detection logic
│   │   ├── separation.py        # Stem separation orchestration
│   │   └── transformation.py    # Pitch shift, time stretch rules
│   │
│   ├── services/                # Application services
│   │   ├── job_queue.py         # Redis-backed job queue (or in-memory for dev)
│   │   ├── session_service.py   # Session lifecycle management
│   │   ├── upload_service.py    # File validation, chunked uploads
│   │   ├── separation_service.py # Demucs orchestration
│   │   ├── analysis_service.py  # Batch analysis coordination
│   │   └── export_service.py    # ZIP generation, metadata
│   │
│   ├── engines/                 # Low-level audio processing (KEEP)
│   │   ├── demucs_engine.py     # Demucs wrapper
│   │   ├── key_detector.py      # Pitch detection
│   │   ├── time_stretch.py      # Rubberband wrapper
│   │   └── ...existing engines
│   │
│   ├── api/                     # HTTP layer
│   │   ├── deps.py              # Dependency injection
│   │   ├── middleware.py        # CORS, error handling, request ID
│   │   ├── v1/
│   │   │   ├── upload.py        # POST /upload, chunked upload
│   │   │   ├── sessions.py      # Session CRUD
│   │   │   ├── separation.py    # Separation endpoints
│   │   │   ├── analysis.py      # Analysis endpoints
│   │   │   ├── export.py        # Download endpoints
│   │   │   └── ws.py            # WebSocket progress
│   │   └── router.py            # Route aggregation
│   │
│   ├── workers/                 # Background task handlers
│   │   ├── separation_worker.py
│   │   ├── analysis_worker.py
│   │   └── cleanup_worker.py
│   │
│   └── main.py                  # FastAPI app factory (< 100 lines)
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
└── requirements.txt
```

### Key Principles

1. **Domain Layer is Pure**: No file I/O, no network calls. Just business logic that can be unit tested in milliseconds.

2. **Job Queue**: Every separation job goes through a queue. This enables:
   - Graceful handling of multiple concurrent uploads
   - Retry logic for failed jobs
   - Progress tracking that survives server restarts
   - Rate limiting to prevent GPU overload

3. **Session as First-Class Entity**:
```python
@dataclass
class Session:
    id: str
    created_at: datetime
    expires_at: datetime
    state: SessionState  # CREATED | UPLOADING | ANALYZING | PROCESSING | COMPLETE | ERROR
    files: List[UploadedFile]
    results: Optional[ProcessingResults]
    error: Optional[str]
    
    def can_transition_to(self, new_state: SessionState) -> bool:
        """State machine validation"""
        valid_transitions = {
            SessionState.CREATED: {SessionState.UPLOADING},
            SessionState.UPLOADING: {SessionState.ANALYZING, SessionState.ERROR},
            # ...
        }
        return new_state in valid_transitions.get(self.state, set())
```

4. **Explicit Error Boundaries**:
```python
class SeparationError(ChimeraException):
    """Demucs failed to separate stems"""
    
class AnalysisError(ChimeraException):
    """Key/BPM detection failed"""
    
class ExportError(ChimeraException):
    """Failed to generate export package"""
```

---

## Part II: Frontend Architecture Redesign

### Current Problems

- `DualDeckWorkstation.tsx` is 530 lines of mixed concerns
- VST aesthetic is dated and doesn't convey "cutting-edge"
- No state management beyond useState spaghetti
- Processing feedback is buried in logs

### Proposed Architecture

```
frontend/
├── src/
│   ├── app/                     # Next.js 14 App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx             # Landing / Quick Export mode
│   │   ├── lab/
│   │   │   └── page.tsx         # Laboratory mode
│   │   └── api/                 # BFF routes if needed
│   │
│   ├── components/
│   │   ├── ui/                  # Primitive components (shadcn/ui base)
│   │   │   ├── button.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── dialog.tsx
│   │   │   └── ...
│   │   │
│   │   ├── upload/
│   │   │   ├── DropZone.tsx     # The main upload interface
│   │   │   ├── FileList.tsx     # Uploaded files with status
│   │   │   └── UploadProgress.tsx
│   │   │
│   │   ├── separation/
│   │   │   ├── StemVisualizer.tsx    # Waveform + spectrogram
│   │   │   ├── StemCard.tsx          # Individual stem preview
│   │   │   └── SeparationProgress.tsx
│   │   │
│   │   ├── player/
│   │   │   ├── Transport.tsx    # Play/stop/scrub
│   │   │   ├── MixerStrip.tsx   # Single channel
│   │   │   ├── MasterBus.tsx    # Master output
│   │   │   └── Waveform.tsx     # Canvas-based waveform
│   │   │
│   │   └── lab/                 # Laboratory mode components
│   │       ├── AnchorSelector.tsx
│   │       ├── TransformationPanel.tsx
│   │       └── EffectsRack.tsx
│   │
│   ├── stores/                  # Zustand stores
│   │   ├── upload.ts            # Upload state
│   │   ├── session.ts           # Session state
│   │   ├── player.ts            # Audio playback state
│   │   └── lab.ts               # Laboratory mode state
│   │
│   ├── hooks/
│   │   ├── useAudioContext.ts
│   │   ├── useWebSocket.ts
│   │   └── useUpload.ts
│   │
│   ├── lib/
│   │   ├── api.ts               # API client
│   │   ├── audio.ts             # Web Audio utilities
│   │   └── utils.ts
│   │
│   └── styles/
│       ├── globals.css          # Tailwind + custom properties
│       └── themes/
│           └── chimera.css      # Design system tokens
```

---

## Part III: UI/UX Design System — "Chimera Design Language"

### Aesthetic References

| Film/Brand | What to Extract |
|------------|-----------------|
| **Arrival** | Alien linguistics glyphs, circular motifs, muted earth tones with amber accents, typography as visual language |
| **Sneakers** | Terminal green-on-black, matrix-like data visualizations, "hacker aesthetic" without being cheesy, sense of mission briefing |
| **Google** | Clarity, negative space, functional minimalism, instant comprehension |
| **MIT** | Technical rigor, engineering diagrams, precision without coldness |

### Color System

```css
:root {
  /* Base - Deep space with warmth */
  --bg-primary: #0A0A0F;           /* Near-black with slight blue */
  --bg-secondary: #12121A;         /* Panel backgrounds */
  --bg-tertiary: #1A1A24;          /* Elevated surfaces */
  
  /* Accent - Arrival amber meets terminal green */
  --accent-primary: #F5A623;       /* Warm amber - primary actions */
  --accent-secondary: #4ADE80;     /* Matrix green - success/active */
  --accent-tertiary: #60A5FA;      /* Cool blue - information */
  
  /* Semantic */
  --success: #4ADE80;
  --warning: #FBBF24;
  --error: #F87171;
  --info: #60A5FA;
  
  /* Text */
  --text-primary: #F8FAFC;         /* High contrast */
  --text-secondary: #94A3B8;       /* Muted */
  --text-tertiary: #475569;        /* Disabled/hints */
  
  /* Special - Waveform visualization */
  --waveform-fill: linear-gradient(180deg, #F5A623 0%, #F59E0B 50%, #D97706 100%);
  --waveform-stroke: #FCD34D;
  --grid-line: rgba(148, 163, 184, 0.1);
  
  /* Typography */
  --font-display: 'Space Grotesk', system-ui;    /* Headings - geometric, MIT-like */
  --font-body: 'Inter', system-ui;               /* Body - Google clarity */
  --font-mono: 'JetBrains Mono', monospace;      /* Data - terminal precision */
}
```

### Typography Scale

```css
/* Display - For hero moments */
.text-display-lg { font: 700 48px/1.1 var(--font-display); letter-spacing: -0.02em; }
.text-display-md { font: 700 32px/1.2 var(--font-display); letter-spacing: -0.01em; }
.text-display-sm { font: 600 24px/1.3 var(--font-display); }

/* Headings - For sections */
.text-heading-lg { font: 600 20px/1.4 var(--font-body); }
.text-heading-md { font: 600 16px/1.4 var(--font-body); }
.text-heading-sm { font: 600 14px/1.4 var(--font-body); }

/* Body - For content */
.text-body-lg { font: 400 16px/1.6 var(--font-body); }
.text-body-md { font: 400 14px/1.6 var(--font-body); }
.text-body-sm { font: 400 12px/1.5 var(--font-body); }

/* Mono - For data, metrics, code */
.text-mono-lg { font: 500 14px/1.4 var(--font-mono); letter-spacing: 0.02em; }
.text-mono-md { font: 500 12px/1.4 var(--font-mono); letter-spacing: 0.02em; }
.text-mono-sm { font: 500 10px/1.4 var(--font-mono); letter-spacing: 0.03em; }
```

### Component Patterns

#### 1. The "Glyph" Pattern (Arrival-inspired)
Circular progress indicators and status badges with segmented rings:

```tsx
// Conceptual - Segmented ring progress
<GlyphProgress 
  value={75} 
  segments={12}        // 12 segments like a clock
  variant="amber"      // Color theme
  size="lg"            // sm | md | lg
  showValue            // Display percentage in center
/>
```

#### 2. The "Terminal" Pattern (Sneakers-inspired)
Data readouts with scanline aesthetics:

```tsx
<Terminal>
  <Terminal.Header>STEM ANALYSIS</Terminal.Header>
  <Terminal.Line label="KEY" value="C Minor" status="detected" />
  <Terminal.Line label="BPM" value="128.4" status="confirmed" />
  <Terminal.Line label="DURATION" value="03:42" />
  <Terminal.Divider />
  <Terminal.Progress value={67} label="SEPARATING" />
</Terminal>
```

#### 3. The "Schematic" Pattern (MIT-inspired)
Technical diagrams for audio routing:

```tsx
<Schematic>
  <Schematic.Node id="input" label="SOURCE" type="input" />
  <Schematic.Node id="demucs" label="DEMUCS v4" type="processor" />
  <Schematic.Node id="drums" label="DRUMS" type="output" />
  <Schematic.Node id="vocals" label="VOCALS" type="output" />
  <Schematic.Edge from="input" to="demucs" />
  <Schematic.Edge from="demucs" to="drums" />
  <Schematic.Edge from="demucs" to="vocals" />
</Schematic>
```

---

## Part IV: User Experience Flows

### Flow 1: Quick Export (lalal.ai Competitor)

**Goal**: Upload → Separate → Download in 3 clicks, faster than lalal.ai

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                                                          │  │
│   │              DROP AUDIO FILES HERE                       │  │
│   │                                                          │  │
│   │          ◯ ◯ ◯ ◯ ◯ ◯ ◯ ◯ ◯ ◯ ◯ ◯                         │  │
│   │          (Glyph ring - idle state)                       │  │
│   │                                                          │  │
│   │              .mp3  .wav  .flac  .m4a                      │  │
│   │                                                          │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│   Drag files or click to browse                                 │
│   Supports batch upload - process 100+ files simultaneously     │
│                                                                 │
│   ─────────────────────────────────────────────────────────────  │
│                                                                 │
│   Recent Sessions:                                              │
│   • session_a8f3... (5 files, 2 min ago)     [Resume] [Delete]  │
│   • session_c2d1... (12 files, yesterday)    [Resume] [Delete]  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**After Upload:**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   PROCESSING 3 FILES                                            │
│   ═══════════════════════════════════════════════════════════   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ track_01.mp3                                    ████░░░ │   │
│   │ KEY: C min  BPM: 128  DURATION: 3:42           67%      │   │
│   │ Status: Separating vocals...                            │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ track_02.mp3                                    ██████░ │   │
│   │ KEY: G maj  BPM: 95   DURATION: 4:12           89%      │   │
│   │ Status: Finalizing stems...                             │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ track_03.mp3                                    ░░░░░░░ │   │
│   │ KEY: ---   BPM: ---   DURATION: ---            Queued   │   │
│   │ Status: Waiting...                                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ─────────────────────────────────────────────────────────────  │
│                                                                 │
│   Estimated time remaining: 2:34                                │
│   [Cancel All]                                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**After Complete:**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ✓ SEPARATION COMPLETE                                         │
│   ═══════════════════════════════════════════════════════════   │
│                                                                 │
│   3 files processed • 12 stems generated • Total: 247 MB        │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                                                         │   │
│   │   [████████████████████████████] DOWNLOAD ALL (.zip)    │   │
│   │                                                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   Or download individually:                                     │
│                                                                 │
│   track_01.mp3                                                  │
│   ├── drums.wav      [▶] [↓]   12.3 MB                          │
│   ├── bass.wav       [▶] [↓]   11.8 MB                          │
│   ├── vocals.wav     [▶] [↓]   14.2 MB                          │
│   └── other.wav      [▶] [↓]   10.1 MB                          │
│                                                                 │
│   track_02.mp3                                                  │
│   ├── drums.wav      [▶] [↓]   ...                              │
│   └── ...                                                       │
│                                                                 │
│   ─────────────────────────────────────────────────────────────  │
│                                                                 │
│   [← New Session]              [Open in Laboratory →]           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 2: Laboratory Mode (samplebase Experimentation)

**Goal**: Creative exploration with anchor system, effects, and real-time mixing

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ CHIMERA LABORATORY                                            [Quick Export →] │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│ ┌───────────────────────────────────┐  ┌──────────────────────────────────────┐ │
│ │ STEMS LIBRARY                     │  │ ARRANGEMENT                          │ │
│ │                                   │  │                                      │ │
│ │ ▼ track_01.mp3                    │  │  ┌────────────────────────────────┐  │ │
│ │   ├ 🥁 drums    [+ Add] ◉ RHYTHM  │  │  │ ░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░ │  │ │
│ │   ├ 🎸 bass     [+ Add]           │  │  │ drums (rhythm anchor)           │  │ │
│ │   ├ 🎤 vocals   [+ Add] ◉ HARMONY │  │  └────────────────────────────────┘  │ │
│ │   └ 🎹 other    [+ Add]           │  │  ┌────────────────────────────────┐  │ │
│ │                                   │  │  │ ░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░ │  │ │
│ │ ▼ track_02.mp3                    │  │  │ vocals (harmonic anchor)        │  │ │
│ │   ├ 🥁 drums    [+ Add]           │  │  └────────────────────────────────┘  │ │
│ │   ├ 🎸 bass     [+ Add]           │  │  ┌────────────────────────────────┐  │ │
│ │   ├ 🎤 vocals   [+ Add]           │  │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  │ │
│ │   └ 🎹 other    [+ Add]           │  │  │ bass (shifted +5st to match)    │  │ │
│ │                                   │  │  └────────────────────────────────┘  │ │
│ │ ─────────────────────────────     │  │                                      │ │
│ │ [Upload More]                     │  │  ◀◀  ▶ PLAY  ▶▶   ⬜ STOP           │ │
│ │                                   │  │  ▂▄▆█▇▅▃▁▂▄▆█▇▅▃ 00:12 / 03:42      │ │
│ └───────────────────────────────────┘  └──────────────────────────────────────┘ │
│                                                                                 │
│ ┌───────────────────────────────────────────────────────────────────────────┐   │
│ │ MIXER                                                                     │   │
│ │                                                                           │   │
│ │  MASTER │ DRUMS  │ VOCALS │ BASS   │ OTHER  │                             │   │
│ │  ══════ │ ══════ │ ══════ │ ══════ │ ══════ │                             │   │
│ │    ▓    │   ▓    │   ▓    │   ▓    │   ▓    │                             │   │
│ │    ▓    │   ▓    │   ▓    │   ▓    │   ░    │                             │   │
│ │    ▓    │   ▓    │   ▓    │   ░    │   ░    │                             │   │
│ │    ▓    │   ▓    │   ░    │   ░    │   ░    │                             │   │
│ │    ▓    │   ░    │   ░    │   ░    │   ░    │                             │   │
│ │  ━━━━━  │ ━━━━━  │ ━━━━━  │ ━━━━━  │ ━━━━━  │                             │   │
│ │   0dB   │  -3dB  │  -6dB  │ -12dB  │ -18dB  │                             │   │
│ │  [M][S] │ [M][S] │ [M][S] │ [M][S] │ [M][S] │                             │   │
│ │         │  🥁    │  🎤    │  🎸    │  🎹    │                             │   │
│ └───────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│ ┌───────────────────────────────────────────────────────────────────────────┐   │
│ │ TRANSFORMATION MATRIX                                 [Export Session →]  │   │
│ │                                                                           │   │
│ │  RHYTHM ANCHOR: drums (track_01)     BPM: 128                             │   │
│ │  HARMONIC ANCHOR: vocals (track_01)  KEY: C minor                         │   │
│ │                                                                           │   │
│ │  Track Transformations:                                                   │   │
│ │  ┌────────────┬──────────┬───────────┬────────────────────────────────┐   │   │
│ │  │ Stem       │ Original │ Target    │ Transformation                 │   │   │
│ │  ├────────────┼──────────┼───────────┼────────────────────────────────┤   │   │
│ │  │ drums      │ 128 BPM  │ 128 BPM   │ (anchor - no change)           │   │   │
│ │  │ vocals     │ C min    │ C min     │ (anchor - no change)           │   │   │
│ │  │ bass       │ G maj    │ C min     │ Pitch: -7st, Time: 1.00x       │   │   │
│ │  │ other      │ 120 BPM  │ 128 BPM   │ Pitch: 0st, Time: 1.07x        │   │   │
│ │  └────────────┴──────────┴───────────┴────────────────────────────────┘   │   │
│ └───────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part V: Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Backend:**
- [ ] Create new project structure
- [ ] Implement core session state machine
- [ ] Build job queue (in-memory for MVP, Redis-ready interface)
- [ ] Refactor Demucs separation into clean service
- [ ] Add structured logging
- [ ] Write unit tests for domain logic

**Frontend:**
- [ ] Set up Next.js 14 with App Router
- [ ] Install and configure shadcn/ui
- [ ] Implement design tokens (colors, typography)
- [ ] Build primitive UI components (Button, Progress, etc.)
- [ ] Set up Zustand stores

### Phase 2: Quick Export Mode (Week 3-4)

**Backend:**
- [ ] Bulk upload endpoint with progress
- [ ] Parallel separation worker
- [ ] ZIP export generation
- [ ] WebSocket progress streaming

**Frontend:**
- [ ] DropZone component with Glyph animation
- [ ] File list with progress bars
- [ ] Processing status view
- [ ] Download results view
- [ ] E2E flow testing

### Phase 3: Laboratory Mode (Week 5-6)

**Backend:**
- [ ] Chimera dual-anchor processing
- [ ] Real-time pitch/time transformation
- [ ] Analysis caching

**Frontend:**
- [ ] Stems library panel
- [ ] Arrangement timeline
- [ ] Mixer with Web Audio
- [ ] Transformation matrix display

### Phase 4: Polish & Performance (Week 7-8)

- [ ] Performance optimization (code splitting, lazy loading)
- [ ] Accessibility audit
- [ ] Mobile responsiveness
- [ ] Error recovery flows
- [ ] Analytics integration
- [ ] Documentation

---

## Part VI: Success Metrics

### Performance Targets
- **Upload to first stem available**: < 30 seconds for 3-minute track
- **Full separation (4 stems)**: < 90 seconds for 3-minute track
- **UI interaction latency**: < 100ms for all interactions
- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 3s

### UX Targets
- **Quick Export flow**: 3 clicks from landing to download
- **Laboratory onboarding**: User understands anchor concept within 30 seconds
- **Error recovery**: Clear, actionable messages for all failure states

---

## Appendix A: Migration Strategy

1. **Keep existing backend running** during migration
2. **Build new frontend in parallel** at `/v2` route
3. **Feature flag** to route users to new experience
4. **Gradual rollout** with ability to rollback
5. **Deprecate old endpoints** after 30-day migration period

---

## Appendix B: Tech Stack Summary

| Layer | Current | Proposed |
|-------|---------|----------|
| **Frontend Framework** | React + Vite | Next.js 14 (App Router) |
| **UI Components** | Custom VST-style | shadcn/ui + custom Chimera components |
| **State Management** | useState spaghetti | Zustand |
| **Styling** | Tailwind + inline | Tailwind + CSS custom properties |
| **Audio** | Tone.js + Web Audio | Web Audio API (direct) |
| **Backend** | FastAPI (monolithic) | FastAPI (modular) |
| **Job Queue** | None (direct execution) | Redis/In-memory queue |
| **Session Store** | In-memory dict | Redis/SQLite |

---

*This document represents the north star. Implementation will be iterative, with working software at every step.*
