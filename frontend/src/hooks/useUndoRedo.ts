/**
 * useUndoRedo - Figma-style undo/redo stack
 * 
 * Patterns:
 * - Per-user undo stack (client-side)
 * - Deleted object data stored in undo buffer
 * - Undo restores properties from client buffer
 * - New actions clear redo stack
 * - Group related changes into single undo entry
 */

import { useState, useCallback } from 'react';

export type ChangeType = 'property' | 'create' | 'delete' | 'batch';

export interface UndoEntry<T = unknown> {
  id: string;
  type: ChangeType;
  objectId: string;
  description: string;
  before: T;
  after: T;
  timestamp: number;
}

export interface BatchEntry<T = unknown> {
  id: string;
  type: 'batch';
  description: string;
  entries: UndoEntry<T>[];
  timestamp: number;
}

export type HistoryEntry<T = unknown> = UndoEntry<T> | BatchEntry<T>;

export interface UndoRedoState<T> {
  undoStack: HistoryEntry<T>[];
  redoStack: HistoryEntry<T>[];
  canUndo: boolean;
  canRedo: boolean;
  lastAction: string | null;
}

export interface UndoRedoActions<T> {
  push: (entry: Omit<UndoEntry<T>, 'id' | 'timestamp'>) => void;
  pushBatch: (description: string, entries: Omit<UndoEntry<T>, 'id' | 'timestamp'>[]) => void;
  undo: () => HistoryEntry<T> | null;
  redo: () => HistoryEntry<T> | null;
  clear: () => void;
  peek: () => HistoryEntry<T> | null;
}

const MAX_UNDO_STACK = 100;

let entryCounter = 0;
function generateEntryId(): string {
  return `undo-${Date.now()}-${++entryCounter}`;
}

export function useUndoRedo<T = unknown>(
  onUndo?: (entry: HistoryEntry<T>) => void,
  onRedo?: (entry: HistoryEntry<T>) => void
): UndoRedoState<T> & UndoRedoActions<T> {
  const [undoStack, setUndoStack] = useState<HistoryEntry<T>[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry<T>[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const push = useCallback((entry: Omit<UndoEntry<T>, 'id' | 'timestamp'>) => {
    const fullEntry: UndoEntry<T> = {
      ...entry,
      id: generateEntryId(),
      timestamp: Date.now(),
    };

    setUndoStack(prev => {
      const next = [...prev, fullEntry];
      // Limit stack size
      if (next.length > MAX_UNDO_STACK) {
        return next.slice(-MAX_UNDO_STACK);
      }
      return next;
    });
    
    // Clear redo stack on new action
    setRedoStack([]);
    setLastAction(entry.description);
  }, []);

  const pushBatch = useCallback((description: string, entries: Omit<UndoEntry<T>, 'id' | 'timestamp'>[]) => {
    if (entries.length === 0) return;

    const batchEntry: BatchEntry<T> = {
      id: generateEntryId(),
      type: 'batch',
      description,
      entries: entries.map(e => ({
        ...e,
        id: generateEntryId(),
        timestamp: Date.now(),
      })),
      timestamp: Date.now(),
    };

    setUndoStack(prev => {
      const next = [...prev, batchEntry];
      if (next.length > MAX_UNDO_STACK) {
        return next.slice(-MAX_UNDO_STACK);
      }
      return next;
    });
    
    setRedoStack([]);
    setLastAction(description);
  }, []);

  const undo = useCallback((): HistoryEntry<T> | null => {
    const stack = undoStack;
    if (stack.length === 0) return null;
    
    const entry = stack[stack.length - 1];
    setUndoStack(stack.slice(0, -1));
    setRedoStack(prev => [...prev, entry]);
    setLastAction(`Undo: ${entry.description}`);
    onUndo?.(entry);
    
    return entry;
  }, [undoStack, onUndo]);

  const redo = useCallback((): HistoryEntry<T> | null => {
    const stack = redoStack;
    if (stack.length === 0) return null;
    
    const entry = stack[stack.length - 1];
    setRedoStack(stack.slice(0, -1));
    setUndoStack(prev => [...prev, entry]);
    setLastAction(`Redo: ${entry.description}`);
    onRedo?.(entry);
    
    return entry;
  }, [redoStack, onRedo]);

  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
    setLastAction(null);
  }, []);

  const peek = useCallback((): HistoryEntry<T> | null => {
    return undoStack[undoStack.length - 1] ?? null;
  }, [undoStack]);

  return {
    // State
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    lastAction,
    // Actions
    push,
    pushBatch,
    undo,
    redo,
    clear,
    peek,
  };
}

/**
 * Helper: Create a property change entry
 */
export function createPropertyChange<T>(
  objectId: string,
  property: string,
  before: T,
  after: T
): Omit<UndoEntry<T>, 'id' | 'timestamp'> {
  return {
    type: 'property',
    objectId,
    description: `Change ${property}`,
    before,
    after,
  };
}

/**
 * Helper: Create a create entry
 */
export function createCreateEntry<T>(
  objectId: string,
  objectType: string,
  data: T
): Omit<UndoEntry<T>, 'id' | 'timestamp'> {
  return {
    type: 'create',
    objectId,
    description: `Create ${objectType}`,
    before: null as unknown as T,
    after: data,
  };
}

/**
 * Helper: Create a delete entry
 */
export function createDeleteEntry<T>(
  objectId: string,
  objectType: string,
  data: T
): Omit<UndoEntry<T>, 'id' | 'timestamp'> {
  return {
    type: 'delete',
    objectId,
    description: `Delete ${objectType}`,
    before: data,
    after: null as unknown as T,
  };
}

export default useUndoRedo;
