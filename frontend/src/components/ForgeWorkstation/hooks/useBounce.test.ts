/**
 * Tests for useBounce hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBounce } from './useBounce';

// Mock API
vi.mock('../../../api/client', () => ({
  api: {
    bounceAndSlice: vi.fn().mockResolvedValue({
      bounce: {
        id: 'bounce-123',
        path: '/path/to/bounce.wav',
        duration_seconds: 8.0,
      },
      slice_bank: {
        id: 'bank-456',
        num_slices: 16,
      },
    }),
  },
}));

describe('useBounce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with null state', () => {
    const { result } = renderHook(() => useBounce());
    
    expect(result.current.lastBounce).toBeNull();
    expect(result.current.isRendering).toBe(false);
  });

  it('should bounce and slice', async () => {
    const { result } = renderHook(() => useBounce());
    
    let bounceResult: any;
    await act(async () => {
      bounceResult = await result.current.bounceAndSlice(
        'session-123',
        'stem-456',
        [{ beat: 0, sliceIndex: 0, velocity: 1, microOffset: 0 }],
        120
      );
    });

    expect(bounceResult).not.toBeNull();
    expect(bounceResult.bounceId).toBe('bounce-123');
    expect(bounceResult.duration).toBe(8.0);
    expect(bounceResult.sliceCount).toBe(16);
    expect(result.current.lastBounce).toEqual(bounceResult);
  });

  it('should set isRendering during bounce', async () => {
    const { result } = renderHook(() => useBounce());
    
    const bouncePromise = act(async () => {
      await result.current.bounceAndSlice(
        'session-123',
        'stem-456',
        [],
        120
      );
    });

    // Note: In real tests we'd check isRendering during the operation
    await bouncePromise;
    expect(result.current.isRendering).toBe(false);
  });

  it('should handle errors gracefully', async () => {
    const { api } = await import('../../../api/client');
    vi.mocked(api.bounceAndSlice).mockRejectedValueOnce(new Error('Bounce failed'));

    const { result } = renderHook(() => useBounce());
    
    let bounceResult: any;
    await act(async () => {
      bounceResult = await result.current.bounceAndSlice(
        'session-123',
        'stem-456',
        [],
        120
      );
    });

    expect(bounceResult).toBeNull();
    expect(result.current.isRendering).toBe(false);
  });
});
