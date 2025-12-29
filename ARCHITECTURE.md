# LoopForge Architecture Vision

> A Staff-level design document for the evolution of LoopForge as a professional audio workstation.

---

## Part 1: Design System Philosophy

### The Problem with Traditional Design Systems

Most design systems are **appearance-based**: they define colors, spacing, typography, and components as visual primitives. This creates a disconnect between design intent and implementation.

A Staff Designer in Figma thinks in terms of **intent**:
- "This needs to feel urgent"
- "This should recede into the background"
- "This element is interactive and awaiting input"
- "This process is running and the user should feel progress"

### Semantic Tokens

Instead of raw primitives like `--color-orange-500`, we use **semantic tokens** that describe purpose:

```css
/* Surface tokens */
--surface-app: /* Main app background */
--surface-panel: /* Panel backgrounds */
--surface-elevated: /* Raised elements */
--surface-inset: /* Recessed areas */

/* Text tokens */
--text-primary: /* Main content */
--text-secondary: /* Supporting content */
--text-muted: /* De-emphasized */

/* State tokens */
--accent: /* Primary action color */
--accent-subtle: /* Hover/focus states */
--border-focus: /* Focused element border */
```

### Component States as First-Class Citizens

Every interactive element has these states:
1. **Idle** - Default, waiting for interaction
2. **Hover** - User is considering
3. **Active** - Being pressed/engaged
4. **Focus** - Keyboard selected
5. **Loading** - Processing
6. **Disabled** - Not available
7. **Error** - Something wrong
8. **Success** - Operation complete

The design system must define **all states** for **all components** - no implicit fallbacks.

### Animation as Communication

Motion isn't decoration. It communicates:
- **Causality**: What caused this change?
- **Continuity**: Where did this come from?
- **Feedback**: Did my action work?
- **State**: What's happening now?

Defined animation intents:
```css
--motion-enter: /* Element appearing */
--motion-exit: /* Element leaving */
--motion-feedback: /* Response to input */
--motion-progress: /* Ongoing process */
--motion-attention: /* Needs user focus */
```

---

## Part 2: Application Architecture

### Core Principle: Single Context, Multiple Modes

LoopForge is **one workstation**, not multiple pages. The user is always in the same spatial context - what changes is the **mode** and **focus**.

### Application States

```
┌─────────────────────────────────────────────────────────────────┐
│                         WORKSTATION                              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    EMPTY STATE                           │   │
│  │                                                          │   │
│  │   Drop audio here or press ⌘O to open                   │   │
│  │                                                          │   │
│  │   Recent:                                                │   │
│  │   • vocal_session_001.mp3 (2h ago)                      │   │
│  │   • beat_stems.wav (yesterday)                          │   │
│  │                                                          │   │
│  │   [Browse Files]  [Record]                              │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼ (file dropped)                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   PROCESSING STATE                       │   │
│  │                                                          │   │
│  │   filename.mp3                                          │   │
│  │   ═══════════════════░░░░░░░░░░░░░░░░░░  35%           │   │
│  │                                                          │   │
│  │   ▸ Analyzing audio structure...                        │   │
│  │   ▸ Detecting moments (hits, phrases, textures)         │   │
│  │   ○ Separating stems (queued)                           │   │
│  │   ○ Generating embeddings (queued)                      │   │
│  │                                                          │   │
│  │   Preview available - click waveform to audition        │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼ (processing complete)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   WORKSTATION STATE                      │   │
│  │                                                          │   │
│  │  ┌─────────┬─────────────────────────┬─────────────┐   │   │
│  │  │ STEMS   │      WAVEFORM/GRID      │   INSPECTOR │   │   │
│  │  │         │                         │             │   │   │
│  │  │ ● drums │  [================]     │  BPM: 128   │   │   │
│  │  │ ○ bass  │  [  moments  ][ ][ ]    │  Key: Cm    │   │   │
│  │  │ ○ vocal │                         │             │   │   │
│  │  │ ○ other │  ┌─┬─┬─┬─┬─┬─┬─┬─┐     │  Duration:  │   │   │
│  │  │         │  │1│2│3│4│5│6│7│8│     │  3:42       │   │   │
│  │  │         │  └─┴─┴─┴─┴─┴─┴─┴─┘     │             │   │   │
│  │  │         │       PADS              │  [Export]   │   │   │
│  │  └─────────┴─────────────────────────┴─────────────┘   │   │
│  │                                                          │   │
│  │  [+ New Session]                          [?] [⚙]       │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Empty State is Not "Nothing"

The empty state is the **most important** state. It's where users:
1. Understand what the app does
2. Start their workflow
3. Return to recent work
4. Access global settings

Empty state features:
- **Drop zone** - Full-screen drag target
- **Recent sessions** - Quick resume
- **File browser** - Access local files
- **Keyboard hint** - `⌘O` to open
- **Backend status** - Model loading progress, GPU availability

### Processing State is Transparent

Power users need to see what's happening. The processing state shows:
1. **Current operation** with real progress
2. **Queue** of pending operations
3. **Preview** available as soon as audio is loaded
4. **Detailed logs** (collapsible)
5. **Cancel** option per job

### Workstation State is Modal

The workstation has sub-modes:
- **Overview** - See all stems, navigate structure
- **Slice** - Create and edit slice banks
- **Sequence** - Arrange triggers, apply rules
- **Effects** - Harmonic filter, spectral processing
- **Export** - Bounce to file

Mode switching is **instant** (keyboard: `1-5` or tab bar).

---

## Part 3: Hidden Backend Capabilities to Surface

### Currently Unsurfaced (Backend Ready, Frontend Missing)

| Capability | Backend Endpoint | Frontend Impact |
|------------|------------------|-----------------|
| **Text-to-Audio Search** | `POST /api/embeddings/search/text` | Type "punchy kick" to find matching slices |
| **Audio Similarity** | `POST /api/embeddings/search/similar` | "Find slices like this one" |
| **Harmonic Filterbank** | `POST /api/effects/harmonic-filter` | Harmonium-style spectral effects |
| **Drum Synthesis** | `POST /api/footwork/synthesize-drum` | Generate 808-style drums |
| **Pattern Generation** | `POST /api/footwork/generate-pattern` | Auto-generate footwork patterns |
| **Moment Detection** | `POST /api/moments/detect` | Hits, phrases, textures, changes |
| **Region Slicing** | `POST /api/moments/region-slices` | Octatrack-style mark in/out |
| **Grid Quantize** | `POST /api/grid/quantize` | Snap to grid with swing |
| **WebSocket Progress** | `WS /api/ws/{session_id}` | Real-time job updates |
| **Groove Transfer** | Backend engine exists | Apply groove from one stem to another |
| **Euclidean Triggers** | `TriggerEngine` | Euclidean rhythm generation |
| **Probability Triggers** | `TriggerEngine` | Stochastic sequencing |
| **Transient Following** | `TransientFollowSource` | Slice triggers follow transients |

### Priority Integration Order

1. **WebSocket for real-time progress** - Immediate feedback
2. **Moment detection during upload** - Navigate long files instantly
3. **Text search for slices** - "Find me a snare"
4. **Harmonic filter** - Creative sound design
5. **Pattern generation** - Quick idea starter

---

## Part 4: Keyboard-First Interaction

### Global Shortcuts

| Key | Action |
|-----|--------|
| `⌘O` | Open file |
| `⌘S` | Save/Export |
| `⌘Z/⇧⌘Z` | Undo/Redo |
| `Space` | Play/Stop |
| `Enter` | Play selection |
| `Escape` | Stop all / Deselect |
| `1-8` | Trigger pads |
| `Tab` | Next panel |
| `⇧Tab` | Previous panel |
| `/` | Command palette |
| `?` | Show shortcuts |

### Mode Shortcuts

| Key | Mode |
|-----|------|
| `⌘1` | Overview |
| `⌘2` | Slice |
| `⌘3` | Sequence |
| `⌘4` | Effects |
| `⌘5` | Export |

### Slice Mode Shortcuts

| Key | Action |
|-----|--------|
| `[` / `]` | Move slice start/end |
| `⇧[` / `⇧]` | Fine adjust (1ms) |
| `D` | Duplicate slice |
| `X` | Cut slice |
| `←/→` | Navigate slices |
| `⇧←/⇧→` | Extend selection |

### Sequence Mode Shortcuts

| Key | Action |
|-----|--------|
| `E` | Toggle Euclidean mode |
| `R` | Randomize |
| `Q` | Quantize selection |
| `+/-` | Adjust velocity |
| `⇧+/-` | Adjust probability |

---

## Part 5: Technical Implementation

### State Management

Single Zustand store with slices:

```typescript
interface WorkstationState {
  // Application mode
  mode: 'empty' | 'processing' | 'workstation';
  subMode: 'overview' | 'slice' | 'sequence' | 'effects' | 'export';
  
  // Session
  session: Session | null;
  stems: Stem[];
  selectedStemId: string | null;
  
  // Processing
  jobs: Job[];
  activeJobId: string | null;
  
  // Slices
  sliceBanks: SliceBank[];
  activeSliceBankId: string | null;
  selectedSliceIndices: number[];
  
  // Playback
  isPlaying: boolean;
  playheadPosition: number;
  
  // UI
  panelVisibility: Record<string, boolean>;
  keyboardFocus: string | null;
}
```

### WebSocket Integration

```typescript
class WorkstationSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  
  connect(sessionId: string) {
    this.ws = new WebSocket(`ws://${location.host}/api/ws/${sessionId}`);
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'job_progress':
          store.updateJobProgress(data.job_id, data.progress, data.stage);
          break;
        case 'job_complete':
          store.completeJob(data.job_id, data.output);
          break;
        case 'moments_ready':
          store.setMoments(data.moments);
          break;
        case 'stems_ready':
          store.setStems(data.stems);
          break;
      }
    };
  }
}
```

### Component Architecture

```
Workstation/
├── EmptyState/
│   ├── DropZone
│   ├── RecentSessions
│   └── FileBrowser
├── ProcessingState/
│   ├── ProgressBar
│   ├── JobQueue
│   └── PreviewPlayer
├── WorkstationState/
│   ├── Header/
│   │   ├── SessionTitle
│   │   ├── TransportControls
│   │   └── ModeSelector
│   ├── StemPanel/
│   │   ├── StemList
│   │   └── StemControls
│   ├── MainView/
│   │   ├── WaveformDisplay
│   │   ├── MomentsOverlay
│   │   ├── PadGrid
│   │   └── SequenceEditor
│   ├── Inspector/
│   │   ├── SessionInfo
│   │   ├── SliceInfo
│   │   └── EffectsPanel
│   └── StatusBar/
│       ├── BackendStatus
│       ├── KeyboardHint
│       └── ExportButton
└── CommandPalette/
```

---

## Part 6: The Felt Experience

### What Power Users Feel

1. **Speed** - No loading spinners blocking workflow
2. **Control** - Every operation is cancellable
3. **Transparency** - See what's happening under the hood
4. **Fluidity** - Transitions communicate state changes
5. **Reliability** - Never lose work, auto-save everything

### Micro-interactions That Matter

- **Pad triggers** have velocity-sensitive visual feedback
- **Waveform scrubbing** plays audio immediately
- **Slice creation** shows preview instantly
- **Drag operations** snap to grid with visual guides
- **Long operations** show ETA based on actual progress

### Audio-Visual Sync

The UI responds to audio:
- VU meters reflect actual levels
- Waveform playhead is frame-accurate
- Pad flashes sync with transients
- BPM display pulses on beat

---

## Implementation Priority

### Phase 1: Foundation (This Session)
- [x] Design token system
- [ ] Empty state with drop zone
- [ ] Processing state with real progress
- [ ] WebSocket integration

### Phase 2: Core Workstation
- [ ] Stem panel with proper controls
- [ ] Waveform with moments overlay
- [ ] Pad grid with velocity
- [ ] Basic keyboard shortcuts

### Phase 3: Advanced Features
- [ ] Text-to-audio search
- [ ] Harmonic filterbank UI
- [ ] Pattern generation
- [ ] Sequence editor

### Phase 4: Polish
- [ ] Command palette
- [ ] Full keyboard navigation
- [ ] Undo/redo system
- [ ] Export presets
