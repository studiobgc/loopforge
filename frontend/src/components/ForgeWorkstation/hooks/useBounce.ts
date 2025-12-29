/**
 * useBounce - Hook for bounce/resample workflow
 * 
 * Render pattern to audio and auto-slice back to pads
 */

import { useState, useCallback } from 'react';
import { api } from '../../../api/client';

interface BounceResult {
  bounceId: string;
  bouncePath: string;
  duration: number;
  sliceBankId?: string;
  sliceCount?: number;
}

export function useBounce() {
  const [lastBounce, setLastBounce] = useState<BounceResult | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const bounceAndSlice = useCallback(async (
    sessionId: string,
    stemId: string,
    patternEvents: Array<{ beat: number; sliceIndex: number; velocity: number; microOffset: number }>,
    bpm: number,
    options: { bars?: number; swing?: number; name?: string } = {}
  ) => {
    setIsRendering(true);
    try {
      const result = await api.bounceAndSlice({
        sessionId,
        stemId,
        patternEvents,
        bpm,
        bars: options.bars ?? 4,
        swing: options.swing ?? 0,
        name: options.name,
      });

      const bounceResult: BounceResult = {
        bounceId: result.bounce.id,
        bouncePath: result.bounce.path,
        duration: result.bounce.duration_seconds,
        sliceBankId: result.slice_bank?.id,
        sliceCount: result.slice_bank?.num_slices,
      };

      setLastBounce(bounceResult);
      return bounceResult;
    } catch (e) {
      console.error('Bounce failed:', e);
      return null;
    } finally {
      setIsRendering(false);
    }
  }, []);

  return {
    lastBounce,
    isRendering,
    bounceAndSlice,
  };
}
