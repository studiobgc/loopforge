/**
 * useUndoRedo - Generic undo/redo hook for state management
 * 
 * Provides history tracking for any state with configurable max history size.
 */

import { useState, useCallback, useRef } from 'react';

interface UndoRedoState<T> {
  past: T[];
  present: T;
  future: T[];
}

interface UndoRedoOptions {
  maxHistory?: number;
}

export function useUndoRedo<T>(initialState: T, options: UndoRedoOptions = {}) {
  const { maxHistory = 50 } = options;
  
  const [state, setState] = useState<UndoRedoState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  // Track if we're in the middle of an undo/redo operation
  const isUndoingRef = useRef(false);

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  // Set new state (adds to history)
  const set = useCallback((newPresent: T | ((prev: T) => T)) => {
    if (isUndoingRef.current) return;

    setState(s => {
      const resolvedPresent = typeof newPresent === 'function' 
        ? (newPresent as (prev: T) => T)(s.present)
        : newPresent;

      // Don't add to history if value hasn't changed
      if (resolvedPresent === s.present) return s;

      const newPast = [...s.past, s.present].slice(-maxHistory);
      
      return {
        past: newPast,
        present: resolvedPresent,
        future: [], // Clear future on new action
      };
    });
  }, [maxHistory]);

  // Undo
  const undo = useCallback(() => {
    setState(s => {
      if (s.past.length === 0) return s;

      isUndoingRef.current = true;
      setTimeout(() => { isUndoingRef.current = false; }, 0);

      const previous = s.past[s.past.length - 1];
      const newPast = s.past.slice(0, -1);

      return {
        past: newPast,
        present: previous,
        future: [s.present, ...s.future],
      };
    });
  }, []);

  // Redo
  const redo = useCallback(() => {
    setState(s => {
      if (s.future.length === 0) return s;

      isUndoingRef.current = true;
      setTimeout(() => { isUndoingRef.current = false; }, 0);

      const next = s.future[0];
      const newFuture = s.future.slice(1);

      return {
        past: [...s.past, s.present],
        present: next,
        future: newFuture,
      };
    });
  }, []);

  // Reset history
  const reset = useCallback((newPresent?: T) => {
    setState({
      past: [],
      present: newPresent ?? state.present,
      future: [],
    });
  }, [state.present]);

  // Clear history but keep present
  const clearHistory = useCallback(() => {
    setState(s => ({
      past: [],
      present: s.present,
      future: [],
    }));
  }, []);

  return {
    state: state.present,
    set,
    undo,
    redo,
    reset,
    clearHistory,
    canUndo,
    canRedo,
    historyLength: state.past.length,
    futureLength: state.future.length,
  };
}
