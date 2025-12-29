/**
 * Tests for useEffects hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEffects } from './useEffects';

// Mock API
vi.mock('../../../api/client', () => ({
  api: {
    analyzeGrid: vi.fn().mockResolvedValue({
      grid: {
        bpm: 120,
        bpm_confidence: 0.95,
        time_signature: [4, 4],
        beats: [0, 0.5, 1, 1.5],
        downbeats: [0, 2],
        duration: 180,
        num_beats: 360,
        num_bars: 90,
      },
    }),
    quantizeSlicesToGrid: vi.fn().mockResolvedValue({
      slice_bank_id: 'bank-123',
      quantized_slices: 8,
      grid_bpm: 120,
      strength: 1.0,
      mode: 'nearest',
    }),
    applyHarmonicFilter: vi.fn().mockResolvedValue({
      output_path: '/path/to/output.wav',
      output_url: '/api/files/output.wav',
      root_note: 'C',
      mode: 'major',
      voicing: 'natural',
      motion: 'static',
    }),
    previewHarmonicFrequencies: vi.fn().mockResolvedValue({
      frequencies: [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25],
    }),
  },
}));

describe('useEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with null state', () => {
    const { result } = renderHook(() => useEffects());
    
    expect(result.current.gridAnalysis).toBeNull();
    expect(result.current.harmonicResult).toBeNull();
    expect(result.current.isProcessing).toBe(false);
  });

  it('should analyze grid', async () => {
    const { result } = renderHook(() => useEffects());
    
    let grid: any;
    await act(async () => {
      grid = await result.current.analyzeGrid('session-123');
    });

    expect(grid).not.toBeNull();
    expect(grid.bpm).toBe(120);
    expect(result.current.gridAnalysis?.bpm).toBe(120);
  });

  it('should quantize slices to grid', async () => {
    const { result } = renderHook(() => useEffects());
    
    let quantizeResult: any;
    await act(async () => {
      quantizeResult = await result.current.quantizeToGrid('bank-123', { strength: 0.8 });
    });

    expect(quantizeResult).not.toBeNull();
    expect(quantizeResult.quantized_slices).toBe(8);
  });

  it('should apply harmonic filter', async () => {
    const { result } = renderHook(() => useEffects());
    
    let filterResult: any;
    await act(async () => {
      filterResult = await result.current.applyHarmonicFilter(
        'session-123',
        '/path/to/stem.wav',
        { rootNote: 'C', mode: 'major' }
      );
    });

    expect(filterResult).not.toBeNull();
    expect(filterResult.root_note).toBe('C');
    expect(result.current.harmonicResult?.root_note).toBe('C');
  });

  it('should preview frequencies', async () => {
    const { result } = renderHook(() => useEffects());
    
    let frequencies: number[] = [];
    await act(async () => {
      frequencies = await result.current.previewFrequencies('C', 'major');
    });

    expect(frequencies).toHaveLength(8);
    expect(frequencies[0]).toBeCloseTo(261.63, 1);
  });

  it('should handle API errors gracefully', async () => {
    const { api } = await import('../../../api/client');
    vi.mocked(api.analyzeGrid).mockRejectedValueOnce(new Error('API Error'));

    const { result } = renderHook(() => useEffects());
    
    let grid: any;
    await act(async () => {
      grid = await result.current.analyzeGrid('session-123');
    });

    expect(grid).toBeNull();
    expect(result.current.isProcessing).toBe(false);
  });
});
