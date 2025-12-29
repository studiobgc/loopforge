/**
 * Tests for usePads hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePads } from './usePads';

// Mock API
vi.mock('../../../api/client', () => ({
  api: {
    createSliceBank: vi.fn().mockResolvedValue({
      id: 'bank-123',
      slices: [
        { index: 0, start_time: 0, end_time: 0.5, duration: 0.5, rms_energy: 0.8 },
        { index: 1, start_time: 0.5, end_time: 1.0, duration: 0.5, rms_energy: 0.6 },
      ],
    }),
    generateEmbeddings: vi.fn().mockResolvedValue({ embeddings_generated: 8 }),
    searchSlicesByText: vi.fn().mockResolvedValue({
      results: [{ slice_index: 0, score: 0.9 }],
    }),
    generateAutoKit: vi.fn().mockResolvedValue({
      kit: [{ pad: 0, slice_index: 0, start_time: 0, end_time: 0.5 }],
    }),
    generateSequence: vi.fn().mockResolvedValue({
      sequence_id: 'seq-123',
      events: [],
    }),
  },
}));

describe('usePads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty pads', () => {
    const { result } = renderHook(() => usePads(16));
    
    expect(result.current.pads).toHaveLength(16);
    expect(result.current.pads[0].loaded).toBe(false);
    expect(result.current.playingPad).toBeNull();
  });

  it('should initialize with custom pad count', () => {
    const { result } = renderHook(() => usePads(8));
    
    expect(result.current.pads).toHaveLength(8);
  });

  it('should add and remove trigger rules', () => {
    const { result } = renderHook(() => usePads(16));
    
    act(() => {
      result.current.addRule({
        id: 'rule-1',
        name: 'Test Rule',
        condition: 'consecutive_plays > 2',
        action: 'skip_next',
        probability: 1,
        enabled: true,
      });
    });

    expect(result.current.triggerRules).toHaveLength(1);
    expect(result.current.triggerRules[0].id).toBe('rule-1');

    act(() => {
      result.current.removeRule('rule-1');
    });

    expect(result.current.triggerRules).toHaveLength(0);
  });

  it('should update trigger rules', () => {
    const { result } = renderHook(() => usePads(16));
    
    act(() => {
      result.current.addRule({
        id: 'rule-1',
        name: 'Test Rule',
        condition: 'consecutive_plays > 2',
        action: 'skip_next',
        probability: 1,
        enabled: true,
      });
    });

    act(() => {
      result.current.updateRule('rule-1', { enabled: false });
    });

    expect(result.current.triggerRules[0].enabled).toBe(false);
  });

  it('should trigger pad and clear playing state', async () => {
    const { result } = renderHook(() => usePads(16));
    
    act(() => {
      result.current.triggerPad(0);
    });

    expect(result.current.playingPad).toBe(0);

    act(() => {
      result.current.clearPlaying();
    });

    expect(result.current.playingPad).toBeNull();
  });

  it('should clear all pads', () => {
    const { result } = renderHook(() => usePads(16));
    
    // First add some rules
    act(() => {
      result.current.addRule({
        id: 'rule-1',
        name: 'Test',
        condition: 'consecutive_plays > 2',
        action: 'skip_next',
        probability: 1,
        enabled: true,
      });
    });

    act(() => {
      result.current.clearPads();
    });

    expect(result.current.pads.every(p => !p.loaded)).toBe(true);
    expect(result.current.playingPad).toBeNull();
  });

  it('should get pad by index', () => {
    const { result } = renderHook(() => usePads(16));
    
    const pad = result.current.getPad(5);
    expect(pad).not.toBeNull();
    expect(pad?.index).toBe(5);
  });

  it('should return null for invalid pad index', () => {
    const { result } = renderHook(() => usePads(16));
    
    const pad = result.current.getPad(99);
    expect(pad).toBeNull();
  });
});
