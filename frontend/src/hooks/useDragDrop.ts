/**
 * useDragDrop - Figma-style drag and drop with visual feedback
 * 
 * Patterns:
 * - Ghost preview follows cursor
 * - Drop zones highlight when valid
 * - Cursor changes based on drop validity
 * - Snap guides appear when aligned
 * - Smooth animations on drop
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface DragItem<T = unknown> {
  id: string;
  type: string;
  data: T;
  sourceRect?: DOMRect;
}

export interface DropZone {
  id: string;
  accepts: string[];
  rect: DOMRect;
  onDrop: (item: DragItem) => void;
  onHover?: (item: DragItem) => void;
  onLeave?: () => void;
}

export interface DragState<T = unknown> {
  isDragging: boolean;
  item: DragItem<T> | null;
  startPos: { x: number; y: number } | null;
  currentPos: { x: number; y: number } | null;
  offset: { x: number; y: number } | null;
  hoveredZone: string | null;
  isValidDrop: boolean;
}

export interface DragDropActions<T = unknown> {
  startDrag: (item: DragItem<T>, e: React.MouseEvent | MouseEvent) => void;
  updateDrag: (e: MouseEvent) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  registerDropZone: (zone: DropZone) => () => void;
  isOverZone: (zoneId: string) => boolean;
}

export function useDragDrop<T = unknown>(): DragState<T> & DragDropActions<T> {
  const [state, setState] = useState<DragState<T>>({
    isDragging: false,
    item: null,
    startPos: null,
    currentPos: null,
    offset: null,
    hoveredZone: null,
    isValidDrop: false,
  });

  const dropZonesRef = useRef<Map<string, DropZone>>(new Map());
  const lastHoveredRef = useRef<string | null>(null);

  const findDropZone = useCallback((x: number, y: number, itemType: string): DropZone | null => {
    for (const zone of dropZonesRef.current.values()) {
      if (!zone.accepts.includes(itemType) && !zone.accepts.includes('*')) {
        continue;
      }
      
      const { left, top, right, bottom } = zone.rect;
      if (x >= left && x <= right && y >= top && y <= bottom) {
        return zone;
      }
    }
    return null;
  }, []);

  const startDrag = useCallback((item: DragItem<T>, e: React.MouseEvent | MouseEvent) => {
    const offset = item.sourceRect 
      ? { x: e.clientX - item.sourceRect.left, y: e.clientY - item.sourceRect.top }
      : { x: 0, y: 0 };

    setState({
      isDragging: true,
      item,
      startPos: { x: e.clientX, y: e.clientY },
      currentPos: { x: e.clientX, y: e.clientY },
      offset,
      hoveredZone: null,
      isValidDrop: false,
    });

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  }, []);

  const updateDrag = useCallback((e: MouseEvent) => {
    setState(prev => {
      if (!prev.isDragging || !prev.item) return prev;

      const zone = findDropZone(e.clientX, e.clientY, prev.item.type);
      const hoveredZone = zone?.id ?? null;
      const isValidDrop = zone !== null;

      // Call hover/leave callbacks
      if (hoveredZone !== lastHoveredRef.current) {
        if (lastHoveredRef.current) {
          const oldZone = dropZonesRef.current.get(lastHoveredRef.current);
          oldZone?.onLeave?.();
        }
        if (hoveredZone && zone) {
          zone.onHover?.(prev.item);
        }
        lastHoveredRef.current = hoveredZone;
      }

      // Update cursor
      document.body.style.cursor = isValidDrop ? 'copy' : 'grabbing';

      return {
        ...prev,
        currentPos: { x: e.clientX, y: e.clientY },
        hoveredZone,
        isValidDrop,
      };
    });
  }, [findDropZone]);

  const endDrag = useCallback(() => {
    setState(prev => {
      if (!prev.isDragging || !prev.item || !prev.currentPos) {
        return { ...prev, isDragging: false, item: null };
      }

      // Find and trigger drop zone
      const zone = findDropZone(prev.currentPos.x, prev.currentPos.y, prev.item.type);
      if (zone) {
        zone.onDrop(prev.item);
      }

      // Clean up hover state
      if (lastHoveredRef.current) {
        const oldZone = dropZonesRef.current.get(lastHoveredRef.current);
        oldZone?.onLeave?.();
        lastHoveredRef.current = null;
      }

      return {
        isDragging: false,
        item: null,
        startPos: null,
        currentPos: null,
        offset: null,
        hoveredZone: null,
        isValidDrop: false,
      };
    });

    // Reset cursor and selection
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [findDropZone]);

  const cancelDrag = useCallback(() => {
    if (lastHoveredRef.current) {
      const oldZone = dropZonesRef.current.get(lastHoveredRef.current);
      oldZone?.onLeave?.();
      lastHoveredRef.current = null;
    }

    setState({
      isDragging: false,
      item: null,
      startPos: null,
      currentPos: null,
      offset: null,
      hoveredZone: null,
      isValidDrop: false,
    });

    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const registerDropZone = useCallback((zone: DropZone) => {
    dropZonesRef.current.set(zone.id, zone);
    return () => {
      dropZonesRef.current.delete(zone.id);
    };
  }, []);

  const isOverZone = useCallback((zoneId: string) => {
    return state.hoveredZone === zoneId;
  }, [state.hoveredZone]);

  // Global mouse event handlers
  useEffect(() => {
    if (!state.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      updateDrag(e);
    };

    const handleMouseUp = () => {
      endDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelDrag();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.isDragging, updateDrag, endDrag, cancelDrag]);

  return {
    ...state,
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    registerDropZone,
    isOverZone,
  };
}

/**
 * DragGhost component props
 */
export interface DragGhostProps {
  item: DragItem | null;
  currentPos: { x: number; y: number } | null;
  offset: { x: number; y: number } | null;
  children: React.ReactNode;
}

/**
 * Helper: Calculate ghost position
 */
export function getGhostStyle(
  currentPos: { x: number; y: number } | null,
  offset: { x: number; y: number } | null,
  sourceRect?: DOMRect
): React.CSSProperties {
  if (!currentPos) return { display: 'none' };
  
  const x = currentPos.x - (offset?.x ?? 0);
  const y = currentPos.y - (offset?.y ?? 0);
  
  return {
    position: 'fixed',
    left: x,
    top: y,
    width: sourceRect?.width,
    height: sourceRect?.height,
    pointerEvents: 'none',
    opacity: 0.8,
    transform: 'rotate(2deg)',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
    zIndex: 9999,
  };
}

/**
 * Helper: Check if drag distance exceeds threshold
 */
export function hasDragThreshold(
  startPos: { x: number; y: number } | null,
  currentPos: { x: number; y: number } | null,
  threshold = 5
): boolean {
  if (!startPos || !currentPos) return false;
  
  const dx = currentPos.x - startPos.x;
  const dy = currentPos.y - startPos.y;
  
  return Math.sqrt(dx * dx + dy * dy) >= threshold;
}

export default useDragDrop;
