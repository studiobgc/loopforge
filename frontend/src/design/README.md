# LoopForge Design System v3.0

> Single source of truth for LoopForge UI. Built for Staff Designer ↔ Staff Engineer collaboration.

## Architecture

```
src/design/
├── tokens.json      # Source of truth (Figma Tokens Studio compatible)
├── tokens.css       # Compiled CSS custom properties + components
├── tokens.types.ts  # TypeScript definitions + helpers
└── README.md        # This file
```

## Designer ↔ Engineer Workflow

### For Designers (Figma)
1. Install **Tokens Studio** plugin in Figma
2. Connect to `tokens.json` via GitHub sync
3. Use tokens for all design work
4. Changes sync automatically to codebase

### For Engineers
1. Import CSS: `import './design/tokens.css'`
2. Use CSS classes: `.lf-btn`, `.lf-panel`, `.lf-pad`, etc.
3. Use CSS variables: `var(--accent)`, `var(--space-4)`, etc.
4. Use TypeScript helpers from `tokens.types.ts`

## Token Namespaces

| Prefix | Purpose | Example |
|--------|---------|---------|
| `--black-*` | Primitive blacks | `--black-100`, `--black-400` |
| `--neutral-*` | Primitive neutrals | `--neutral-700`, `--neutral-1000` |
| `--{color}-*` | Primitive colors | `--orange-500`, `--cyan-400` |
| `--surface-*` | Semantic surfaces | `--surface-app`, `--surface-panel` |
| `--text-*` | Semantic text colors | `--text-primary`, `--text-muted` |
| `--border-*` | Semantic borders | `--border-default`, `--border-focus` |
| `--stem-*` | Stem-specific colors | `--stem-drums`, `--stem-vocals` |
| `--space-*` | Spacing scale | `--space-4` (16px) |
| `--radius-*` | Border radius | `--radius-md` (4px) |
| `--text-*` | Font sizes | `--text-base` (13px) |

## CSS Layers

The system uses `@layer` for cascade control:

```css
@layer base;       /* Reset, fonts */
@layer tokens;     /* CSS custom properties */
@layer components; /* .lf-* component classes */
@layer utilities;  /* .flex, .gap-4, etc. */
```

## Component Classes

### Panels
```html
<div class="lf-panel">...</div>
<div class="lf-panel lf-panel-elevated">...</div>
<div class="lf-panel lf-panel-inset">...</div>
```

### Buttons
```html
<button class="lf-btn lf-btn-primary">Primary</button>
<button class="lf-btn lf-btn-secondary">Secondary</button>
<button class="lf-btn lf-btn-ghost">Ghost</button>
<button class="lf-btn lf-btn-sm">Small</button>
<button class="lf-btn lf-btn-icon">Icon only</button>
```

### Form Controls
```html
<input class="lf-input" />
<input class="lf-slider" type="range" />
<input class="lf-checkbox" type="checkbox" />
```

### Pads (DAW-specific)
```html
<button class="lf-pad" data-playing="true">
  <span class="lf-pad-number">1</span>
</button>
```

### Stem Colors
```html
<div data-stem="drums"><span class="lf-stem-dot"></span></div>
<div data-stem="bass"><span class="lf-stem-dot"></span></div>
<div data-stem="vocals"><span class="lf-stem-dot"></span></div>
<div data-stem="other"><span class="lf-stem-dot"></span></div>
```

## TypeScript Usage

```tsx
import { cx, btn, panel } from './design/tokens.types';

// Class name helper
<div className={cx('lf-panel', isActive && 'lf-panel-elevated')} />

// Button builder
<button className={btn('primary', 'lg')} />

// Panel builder
<div className={panel('elevated')} />
```

## Adding New Tokens

1. Add to `tokens.json` (source of truth)
2. Add corresponding CSS variable to `tokens.css`
3. Add TypeScript type to `tokens.types.ts` if needed
4. Sync Figma via Tokens Studio

## Performance

- **No runtime JS** for styling (pure CSS)
- **CSS layers** for predictable cascade
- **CSS custom properties** for theming
- **~24KB gzipped** total CSS

## Migrating from Legacy

Old pattern → New pattern:
```tsx
// ❌ Old (Tailwind)
<div className="bg-[#0a0a0b] p-4 rounded-lg">

// ✅ New (Design System)
<div className="lf-panel p-4">

// ❌ Old (inline styles)
<div style={{ color: '#fb7185' }}>

// ✅ New (CSS variables)
<div style={{ color: 'var(--stem-drums)' }}>
```
