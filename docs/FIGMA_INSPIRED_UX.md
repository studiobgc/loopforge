# Figma-Inspired UX Patterns for LoopForge

## Research Summary

After deep research into Figma's engineering blog, Andrew Chan's notes, and their interaction patterns, here are the key learnings applied to LoopForge.

---

## 1. Document Structure: Flat Property Map

**Figma's approach:**
```
Map<ObjectID, Map<Property, Value>>
```

Every object is a flat map of properties. Changes are atomic at the property level. Two users changing different properties on the same object don't conflict.

**LoopForge application:**
```typescript
// Instead of nested state like:
session: { stems: [{ id, role, slices: [...] }] }

// Use flat property maps:
objects: Map<ObjectID, { type, ...properties }>
// Where ObjectID could be: stem:abc, slice:xyz, pattern:123
```

**Benefit:** Simpler undo/redo, easier conflict resolution, better performance for partial updates.

---

## 2. Optimistic Local-First Updates

**Figma's approach:**
- Apply changes locally IMMEDIATELY (don't wait for server)
- Track unacknowledged changes
- Discard incoming server changes that conflict with unacknowledged local changes
- Show user's "best prediction" of eventual state

**LoopForge application:**
```typescript
// Before (wait for server):
await api.updateStem(stemId, { muted: true });
setSession(newSession);

// After (optimistic):
setLocalState(prev => ({ ...prev, [stemId]: { ...prev[stemId], muted: true } }));
pendingChanges.add({ stemId, property: 'muted', value: true });
api.updateStem(stemId, { muted: true }).catch(rollback);
```

**Benefit:** UI feels instant, no loading states for simple operations.

---

## 3. Undo/Redo Stack (Per-User, Client-Side)

**Figma's approach:**
- Each user has their own undo stack
- Undo buffer stores deleted object data (not server)
- Undo restores properties from client buffer

**LoopForge application:**
```typescript
interface UndoEntry {
  type: 'property' | 'create' | 'delete';
  objectId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];

function applyChange(entry: UndoEntry) {
  undoStack.push(entry);
  redoStack.length = 0; // Clear redo on new action
  // Apply change...
}

function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  redoStack.push(entry);
  // Restore 'before' state
}
```

---

## 4. Selection System (Figma-Style)

**Figma's patterns:**
- Click: Select single object, deselect others
- Shift+Click: Add/remove from selection
- Cmd+Click: Deep select (ignore groups)
- Drag: Rubber-band selection
- Shift+Drag: Add to selection with rubber-band
- Cmd+Drag: Confined selection (only fully-enclosed objects)

**LoopForge application for stems/slices/pads:**
```typescript
interface SelectionState {
  selectedIds: Set<string>;
  selectionAnchor: string | null; // For shift-click range
  rubberBand: { startX, startY, endX, endY } | null;
}

function handleClick(id: string, e: MouseEvent) {
  if (e.shiftKey) {
    // Toggle in selection
    toggleSelection(id);
  } else if (e.metaKey) {
    // Add to selection without deselecting others
    addToSelection(id);
  } else {
    // Single select
    setSelection([id]);
  }
}
```

---

## 5. Keyboard Shortcuts (Layered, Discoverable)

**Figma's patterns:**
- Single keys for tools: V (select), H (hand), R (rectangle)
- Modifiers for variants: Shift+R (rounded rectangle)
- Cmd+key for actions: Cmd+D (duplicate), Cmd+G (group)
- Number keys for opacity: 1=10%, 5=50%, 0=100%
- Context-sensitive: shortcuts change based on selection

**LoopForge keyboard map:**
```
# Transport
Space     = Play/Pause
Enter     = Stop & Rewind
.         = Nudge forward
,         = Nudge back

# Tools
V         = Select tool (default)
H         = Hand tool (pan)
S         = Slice tool
R         = Record mode toggle

# Stems (when stem selected)
M         = Mute toggle
S         = Solo toggle
1-4       = Select stem by index

# Pads
Q/W/E/R   = Trigger pads row 1
A/S/D/F   = Trigger pads row 2
Z/X/C/V   = Trigger pads row 3

# Editing
Cmd+Z     = Undo
Cmd+Shift+Z = Redo
Cmd+C     = Copy
Cmd+V     = Paste
Cmd+D     = Duplicate
Delete    = Delete selected

# View
Cmd++     = Zoom in
Cmd+-     = Zoom out
Cmd+0     = Fit to screen
Cmd+1     = Actual size
```

---

## 6. Micro-Interactions

**Figma's patterns:**
- Cursor changes based on context (move, resize, rotate)
- Hover states reveal affordances (resize handles appear)
- Drag preview shows ghost of what will happen
- Drop zones highlight when valid
- Snapping with visual guides
- Animated transitions between states

**LoopForge micro-interactions:**

### Cursor States
```css
.cursor-default { cursor: default; }
.cursor-grab { cursor: grab; }
.cursor-grabbing { cursor: grabbing; }
.cursor-crosshair { cursor: crosshair; } /* slice mode */
.cursor-ew-resize { cursor: ew-resize; } /* trim slice */
.cursor-not-allowed { cursor: not-allowed; } /* invalid drop */
```

### Hover Affordances
- Slice boundaries glow on hover
- Pad shows "tap to preview" hint
- Pattern grid shows beat number on hover
- Stem shows mute/solo buttons on hover (hidden otherwise)

### Drag Feedback
- Ghost preview of dragged element
- Drop zone pulses when valid
- Invalid zones dim and show prohibition cursor
- Snap lines appear when aligning

### State Transitions
```css
/* Smooth state changes */
.element {
  transition: 
    transform 150ms ease-out,
    opacity 100ms ease-out,
    box-shadow 100ms ease-out;
}

/* Playing state pulse */
@keyframes playing-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--accent); }
  50% { box-shadow: 0 0 8px 2px var(--accent); }
}
```

---

## 7. Time-Slicing & Prioritization

**Figma's approach:**
- Local edits prioritized over remote updates
- Rendering is time-sliced to maintain responsiveness
- Defer non-critical updates to idle time

**LoopForge application:**
```typescript
// Prioritize audio playback over UI updates
function scheduleUpdate(priority: 'critical' | 'normal' | 'low', fn: () => void) {
  if (priority === 'critical') {
    fn(); // Immediate
  } else if (priority === 'normal') {
    requestAnimationFrame(fn);
  } else {
    requestIdleCallback(fn);
  }
}

// Critical: audio scheduling, transport
// Normal: waveform updates, selection changes
// Low: spectrum analyzer, moment detection
```

---

## 8. Object Identity & Unique IDs

**Figma's approach:**
- Client generates unique IDs (clientId + counter)
- No server round-trip needed for object creation
- IDs are stable across undo/redo

**LoopForge application:**
```typescript
const clientId = crypto.randomUUID().slice(0, 8);
let objectCounter = 0;

function generateId(type: string): string {
  return `${type}:${clientId}-${++objectCounter}`;
}

// Usage:
const sliceId = generateId('slice'); // "slice:a1b2c3d4-1"
const patternId = generateId('pattern'); // "pattern:a1b2c3d4-2"
```

---

## Implementation Priority

1. **Selection System** - Foundation for all interactions
2. **Keyboard Shortcuts** - Power user efficiency
3. **Undo/Redo** - Safety net for experimentation
4. **Micro-interactions** - Polish and feel
5. **Optimistic Updates** - Performance perception
6. **Time-slicing** - Sustained performance

---

## Files to Create/Modify

1. `frontend/src/hooks/useSelection.ts` - Selection state management
2. `frontend/src/hooks/useKeyboardShortcuts.ts` - Keyboard handler
3. `frontend/src/hooks/useUndoRedo.ts` - Undo/redo stack
4. `frontend/src/hooks/useDragDrop.ts` - Drag and drop with previews
5. `frontend/src/components/shared/Cursor.tsx` - Context-aware cursor
6. `frontend/src/styles/micro-interactions.css` - Animation definitions
