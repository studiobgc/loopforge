/**
 * LoopForge Design Constants
 * Single source of truth for colors, timing, and shared values
 */

export const STEM_COLORS: Record<string, string> = {
  drums: '#e07020',
  bass: '#8060c0',
  vocals: '#40a0e0',
  other: '#60b060',
};

export const MOMENT_COLORS: Record<string, string> = {
  hit: '#e07020',
  phrase: '#40a0e0',
  texture: '#8060c0',
  change: '#60b060',
};

export const KEYBOARD_SHORTCUTS = {
  // Transport
  play: { key: ' ', label: 'Space', description: 'Play/Pause' },
  stop: { key: 'Escape', label: 'Esc', description: 'Stop' },
  rewind: { key: 'Home', label: 'Home', description: 'Rewind' },
  
  // Pads (top row)
  pad1: { key: '1', label: '1', description: 'Pad 1' },
  pad2: { key: '2', label: '2', description: 'Pad 2' },
  pad3: { key: '3', label: '3', description: 'Pad 3' },
  pad4: { key: '4', label: '4', description: 'Pad 4' },
  pad5: { key: '5', label: '5', description: 'Pad 5' },
  pad6: { key: '6', label: '6', description: 'Pad 6' },
  pad7: { key: '7', label: '7', description: 'Pad 7' },
  pad8: { key: '8', label: '8', description: 'Pad 8' },
  
  // Pads (bottom row)
  pad9: { key: 'q', label: 'Q', description: 'Pad 9' },
  pad10: { key: 'w', label: 'W', description: 'Pad 10' },
  pad11: { key: 'e', label: 'E', description: 'Pad 11' },
  pad12: { key: 'r', label: 'R', description: 'Pad 12' },
  pad13: { key: 't', label: 'T', description: 'Pad 13' },
  pad14: { key: 'y', label: 'Y', description: 'Pad 14' },
  pad15: { key: 'u', label: 'U', description: 'Pad 15' },
  pad16: { key: 'i', label: 'I', description: 'Pad 16' },
  
  // Actions
  undo: { key: 'z', meta: true, label: '⌘Z', description: 'Undo' },
  redo: { key: 'z', meta: true, shift: true, label: '⌘⇧Z', description: 'Redo' },
  save: { key: 's', meta: true, label: '⌘S', description: 'Save' },
  open: { key: 'o', meta: true, label: '⌘O', description: 'Open' },
  export: { key: 'e', meta: true, label: '⌘E', description: 'Export' },
  help: { key: '?', label: '?', description: 'Show shortcuts' },
};

export const TIMING = {
  debounce: 150,
  animationFast: 100,
  animationNormal: 200,
  animationSlow: 300,
  pollingInterval: 2000,
  healthCheckInterval: 10000,
};
