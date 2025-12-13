/**
 * useKeyboardShortcuts - DAW-style keyboard control
 * 
 * Maps keyboard shortcuts to actions with modifier key support.
 * Inspired by Ableton Live's keyboard shortcuts.
 */

import { useEffect, useCallback, useRef } from 'react';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;   // Cmd on Mac
  action: () => void;
  description?: string;
  enabled?: boolean;
}

interface KeyboardShortcutsOptions {
  enabled?: boolean;
  preventDefault?: boolean;
}

export function useKeyboardShortcuts(
  shortcuts: Shortcut[],
  options: KeyboardShortcutsOptions = {}
) {
  const { enabled = true, preventDefault = true } = options;
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Ignore if typing in input
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }
    
    const key = event.key.toLowerCase();
    
    for (const shortcut of shortcutsRef.current) {
      if (shortcut.enabled === false) continue;
      
      const keyMatch = shortcut.key.toLowerCase() === key;
      const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey);
      const shiftMatch = !!shortcut.shift === event.shiftKey;
      const altMatch = !!shortcut.alt === event.altKey;
      
      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        if (preventDefault) {
          event.preventDefault();
        }
        shortcut.action();
        return;
      }
    }
  }, [preventDefault]);
  
  useEffect(() => {
    if (!enabled) return;
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}

/**
 * Common DAW shortcuts configuration
 */
export function createDAWShortcuts(handlers: {
  play: () => void;
  stop: () => void;
  record?: () => void;
  rewind: () => void;
  undo?: () => void;
  redo?: () => void;
  save?: () => void;
  duplicate?: () => void;
  delete?: () => void;
  selectAll?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  toggleMetronome?: () => void;
  toggleLoop?: () => void;
  nudgeLeft?: () => void;
  nudgeRight?: () => void;
  // DAW-specific
  muteSelected?: () => void;
  soloSelected?: () => void;
  armRecord?: () => void;
  quantize?: () => void;
  splitAtPlayhead?: () => void;
  consolidate?: () => void;
  toggleSnap?: () => void;
  tempoTap?: () => void;
  // Stem shortcuts
  muteDrums?: () => void;
  muteBass?: () => void;
  muteVocals?: () => void;
  muteOther?: () => void;
  soloDrums?: () => void;
  soloBass?: () => void;
  soloVocals?: () => void;
  soloOther?: () => void;
  // Sequencer
  randomizePattern?: () => void;
  clearPattern?: () => void;
  shiftPatternLeft?: () => void;
  shiftPatternRight?: () => void;
  // Navigation
  focusArrangement?: () => void;
  focusMixer?: () => void;
  focusSequencer?: () => void;
  showShortcuts?: () => void;
}): Shortcut[] {
  const shortcuts: Shortcut[] = [
    // Transport
    { key: ' ', action: handlers.play, description: 'Play/Pause' },
    { key: 'Enter', action: handlers.stop, description: 'Stop' },
    { key: 'Home', action: handlers.rewind, description: 'Go to start' },
    { key: '0', action: handlers.rewind, description: 'Go to start' },
  ];
  
  if (handlers.record) {
    shortcuts.push({ key: 'r', action: handlers.record, description: 'Record' });
  }
  
  // Edit
  if (handlers.undo) {
    shortcuts.push({ key: 'z', ctrl: true, action: handlers.undo, description: 'Undo' });
  }
  if (handlers.redo) {
    shortcuts.push({ key: 'z', ctrl: true, shift: true, action: handlers.redo, description: 'Redo' });
    shortcuts.push({ key: 'y', ctrl: true, action: handlers.redo, description: 'Redo' });
  }
  if (handlers.save) {
    shortcuts.push({ key: 's', ctrl: true, action: handlers.save, description: 'Save' });
  }
  if (handlers.duplicate) {
    shortcuts.push({ key: 'd', ctrl: true, action: handlers.duplicate, description: 'Duplicate' });
  }
  if (handlers.delete) {
    shortcuts.push({ key: 'Backspace', action: handlers.delete, description: 'Delete' });
    shortcuts.push({ key: 'Delete', action: handlers.delete, description: 'Delete' });
  }
  if (handlers.selectAll) {
    shortcuts.push({ key: 'a', ctrl: true, action: handlers.selectAll, description: 'Select all' });
  }
  
  // View
  if (handlers.zoomIn) {
    shortcuts.push({ key: '=', ctrl: true, action: handlers.zoomIn, description: 'Zoom in' });
    shortcuts.push({ key: '+', ctrl: true, action: handlers.zoomIn, description: 'Zoom in' });
  }
  if (handlers.zoomOut) {
    shortcuts.push({ key: '-', ctrl: true, action: handlers.zoomOut, description: 'Zoom out' });
  }
  
  // Toggles
  if (handlers.toggleMetronome) {
    shortcuts.push({ key: 'm', action: handlers.toggleMetronome, description: 'Toggle metronome' });
  }
  if (handlers.toggleLoop) {
    shortcuts.push({ key: 'l', action: handlers.toggleLoop, description: 'Toggle loop' });
  }
  
  // Nudge
  if (handlers.nudgeLeft) {
    shortcuts.push({ key: 'ArrowLeft', action: handlers.nudgeLeft, description: 'Nudge left' });
  }
  if (handlers.nudgeRight) {
    shortcuts.push({ key: 'ArrowRight', action: handlers.nudgeRight, description: 'Nudge right' });
  }
  
  // DAW-specific
  if (handlers.muteSelected) {
    shortcuts.push({ key: 'm', ctrl: true, action: handlers.muteSelected, description: 'Mute selected' });
  }
  if (handlers.soloSelected) {
    shortcuts.push({ key: 's', action: handlers.soloSelected, description: 'Solo selected' });
  }
  if (handlers.quantize) {
    shortcuts.push({ key: 'q', action: handlers.quantize, description: 'Quantize' });
  }
  if (handlers.toggleSnap) {
    shortcuts.push({ key: 'g', action: handlers.toggleSnap, description: 'Toggle snap to grid' });
  }
  if (handlers.tempoTap) {
    shortcuts.push({ key: 't', action: handlers.tempoTap, description: 'Tap tempo' });
  }
  
  // Stem number shortcuts (1-4)
  if (handlers.muteDrums) {
    shortcuts.push({ key: '1', action: handlers.muteDrums, description: 'Toggle drums mute' });
  }
  if (handlers.muteBass) {
    shortcuts.push({ key: '2', action: handlers.muteBass, description: 'Toggle bass mute' });
  }
  if (handlers.muteVocals) {
    shortcuts.push({ key: '3', action: handlers.muteVocals, description: 'Toggle vocals mute' });
  }
  if (handlers.muteOther) {
    shortcuts.push({ key: '4', action: handlers.muteOther, description: 'Toggle other mute' });
  }
  
  // Stem solo with Shift modifier
  if (handlers.soloDrums) {
    shortcuts.push({ key: '1', shift: true, action: handlers.soloDrums, description: 'Solo drums' });
  }
  if (handlers.soloBass) {
    shortcuts.push({ key: '2', shift: true, action: handlers.soloBass, description: 'Solo bass' });
  }
  if (handlers.soloVocals) {
    shortcuts.push({ key: '3', shift: true, action: handlers.soloVocals, description: 'Solo vocals' });
  }
  if (handlers.soloOther) {
    shortcuts.push({ key: '4', shift: true, action: handlers.soloOther, description: 'Solo other' });
  }
  
  // Sequencer
  if (handlers.randomizePattern) {
    shortcuts.push({ key: 'r', shift: true, action: handlers.randomizePattern, description: 'Randomize pattern' });
  }
  if (handlers.clearPattern) {
    shortcuts.push({ key: 'c', ctrl: true, shift: true, action: handlers.clearPattern, description: 'Clear pattern' });
  }
  if (handlers.shiftPatternLeft) {
    shortcuts.push({ key: '[', action: handlers.shiftPatternLeft, description: 'Shift pattern left' });
  }
  if (handlers.shiftPatternRight) {
    shortcuts.push({ key: ']', action: handlers.shiftPatternRight, description: 'Shift pattern right' });
  }
  
  // Navigation/Focus
  if (handlers.focusArrangement) {
    shortcuts.push({ key: 'F1', action: handlers.focusArrangement, description: 'Arrangement view' });
  }
  if (handlers.focusMixer) {
    shortcuts.push({ key: 'F2', action: handlers.focusMixer, description: 'Mixer view' });
  }
  if (handlers.focusSequencer) {
    shortcuts.push({ key: 'F3', action: handlers.focusSequencer, description: 'Sequencer view' });
  }
  if (handlers.showShortcuts) {
    shortcuts.push({ key: '/', ctrl: true, action: handlers.showShortcuts, description: 'Show shortcuts' });
    shortcuts.push({ key: '?', action: handlers.showShortcuts, description: 'Show shortcuts' });
  }
  
  return shortcuts;
}

/**
 * Hook to show keyboard shortcut hints
 */
export function useShortcutHints() {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  
  const formatShortcut = useCallback((shortcut: Shortcut): string => {
    const parts: string[] = [];
    
    if (shortcut.ctrl) parts.push(isMac ? '⌘' : 'Ctrl');
    if (shortcut.shift) parts.push(isMac ? '⇧' : 'Shift');
    if (shortcut.alt) parts.push(isMac ? '⌥' : 'Alt');
    
    // Format special keys
    let key = shortcut.key;
    switch (key.toLowerCase()) {
      case ' ': key = 'Space'; break;
      case 'arrowleft': key = '←'; break;
      case 'arrowright': key = '→'; break;
      case 'arrowup': key = '↑'; break;
      case 'arrowdown': key = '↓'; break;
      case 'enter': key = '↵'; break;
      case 'backspace': key = '⌫'; break;
      case 'delete': key = 'Del'; break;
      case 'escape': key = 'Esc'; break;
    }
    
    parts.push(key.toUpperCase());
    
    return parts.join(isMac ? '' : '+');
  }, [isMac]);
  
  return { formatShortcut, isMac };
}
