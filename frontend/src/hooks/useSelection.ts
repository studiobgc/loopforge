/**
 * useSelection - Figma-style selection system
 * 
 * Patterns:
 * - Click: Select single, deselect others
 * - Shift+Click: Add/remove from selection (toggle)
 * - Cmd+Click: Add to selection (no toggle)
 * - Drag: Rubber-band selection
 * - Shift+Drag: Add to existing selection
 * - Cmd+Drag: Only fully-enclosed objects
 */

import { useState, useCallback, useMemo } from 'react';

export interface SelectionState {
  selectedIds: Set<string>;
  selectionAnchor: string | null;
  focusedId: string | null;
  rubberBand: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    confined: boolean;
  } | null;
}

export interface SelectionActions {
  select: (id: string, modifiers?: { shift?: boolean; meta?: boolean }) => void;
  selectAll: (ids: string[]) => void;
  selectNone: () => void;
  toggle: (id: string) => void;
  focus: (id: string | null) => void;
  isSelected: (id: string) => boolean;
  startRubberBand: (x: number, y: number, confined?: boolean) => void;
  updateRubberBand: (x: number, y: number) => void;
  endRubberBand: (idsInBounds: string[], additive?: boolean) => void;
  cancelRubberBand: () => void;
}

export interface UseSelectionResult extends SelectionState, SelectionActions {
  selectedArray: string[];
  selectionCount: number;
  hasSelection: boolean;
}

export function useSelection(initialSelection: string[] = []): UseSelectionResult {
  const [state, setState] = useState<SelectionState>(() => ({
    selectedIds: new Set(initialSelection),
    selectionAnchor: initialSelection[0] ?? null,
    focusedId: initialSelection[0] ?? null,
    rubberBand: null,
  }));

  // Memoized derived state
  const selectedArray = useMemo(() => Array.from(state.selectedIds), [state.selectedIds]);
  const selectionCount = state.selectedIds.size;
  const hasSelection = selectionCount > 0;

  // Selection actions
  const select = useCallback((id: string, modifiers?: { shift?: boolean; meta?: boolean }) => {
    setState(prev => {
      const newSelected = new Set<string>();
      
      if (modifiers?.shift && prev.selectionAnchor) {
        // Shift+click: range selection (for ordered lists)
        // For now, just toggle since we don't have ordering info
        if (prev.selectedIds.has(id)) {
          prev.selectedIds.forEach(existingId => {
            if (existingId !== id) newSelected.add(existingId);
          });
        } else {
          prev.selectedIds.forEach(existingId => newSelected.add(existingId));
          newSelected.add(id);
        }
      } else if (modifiers?.meta) {
        // Cmd+click: add to selection without toggling
        prev.selectedIds.forEach(existingId => newSelected.add(existingId));
        newSelected.add(id);
      } else {
        // Normal click: single select
        newSelected.add(id);
      }

      return {
        ...prev,
        selectedIds: newSelected,
        selectionAnchor: id,
        focusedId: id,
      };
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setState(prev => ({
      ...prev,
      selectedIds: new Set(ids),
      selectionAnchor: ids[0] ?? null,
      focusedId: ids[0] ?? null,
    }));
  }, []);

  const selectNone = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedIds: new Set(),
      selectionAnchor: null,
      focusedId: null,
    }));
  }, []);

  const toggle = useCallback((id: string) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return {
        ...prev,
        selectedIds: newSelected,
        focusedId: newSelected.has(id) ? id : prev.focusedId,
      };
    });
  }, []);

  const focus = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, focusedId: id }));
  }, []);

  const isSelected = useCallback((id: string) => {
    return state.selectedIds.has(id);
  }, [state.selectedIds]);

  // Rubber band selection
  const startRubberBand = useCallback((x: number, y: number, confined = false) => {
    setState(prev => ({
      ...prev,
      rubberBand: { startX: x, startY: y, endX: x, endY: y, confined },
    }));
  }, []);

  const updateRubberBand = useCallback((x: number, y: number) => {
    setState(prev => {
      if (!prev.rubberBand) return prev;
      return {
        ...prev,
        rubberBand: { ...prev.rubberBand, endX: x, endY: y },
      };
    });
  }, []);

  const endRubberBand = useCallback((idsInBounds: string[], additive = false) => {
    setState(prev => {
      const newSelected = additive ? new Set(prev.selectedIds) : new Set<string>();
      idsInBounds.forEach(id => newSelected.add(id));
      
      return {
        ...prev,
        selectedIds: newSelected,
        selectionAnchor: idsInBounds[0] ?? prev.selectionAnchor,
        focusedId: idsInBounds[0] ?? prev.focusedId,
        rubberBand: null,
      };
    });
  }, []);

  const cancelRubberBand = useCallback(() => {
    setState(prev => ({ ...prev, rubberBand: null }));
  }, []);

  return {
    // State
    ...state,
    selectedArray,
    selectionCount,
    hasSelection,
    // Actions
    select,
    selectAll,
    selectNone,
    toggle,
    focus,
    isSelected,
    startRubberBand,
    updateRubberBand,
    endRubberBand,
    cancelRubberBand,
  };
}

/**
 * Helper: Check if a point is inside a rubber band
 */
export function isPointInRubberBand(
  x: number,
  y: number,
  rubberBand: { startX: number; startY: number; endX: number; endY: number }
): boolean {
  const minX = Math.min(rubberBand.startX, rubberBand.endX);
  const maxX = Math.max(rubberBand.startX, rubberBand.endX);
  const minY = Math.min(rubberBand.startY, rubberBand.endY);
  const maxY = Math.max(rubberBand.startY, rubberBand.endY);
  
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/**
 * Helper: Check if a rect is inside/intersects a rubber band
 */
export function isRectInRubberBand(
  rect: { x: number; y: number; width: number; height: number },
  rubberBand: { startX: number; startY: number; endX: number; endY: number },
  confined = false
): boolean {
  const minX = Math.min(rubberBand.startX, rubberBand.endX);
  const maxX = Math.max(rubberBand.startX, rubberBand.endX);
  const minY = Math.min(rubberBand.startY, rubberBand.endY);
  const maxY = Math.max(rubberBand.startY, rubberBand.endY);

  if (confined) {
    // Fully enclosed
    return (
      rect.x >= minX &&
      rect.x + rect.width <= maxX &&
      rect.y >= minY &&
      rect.y + rect.height <= maxY
    );
  } else {
    // Intersects
    return !(
      rect.x > maxX ||
      rect.x + rect.width < minX ||
      rect.y > maxY ||
      rect.y + rect.height < minY
    );
  }
}

export default useSelection;
