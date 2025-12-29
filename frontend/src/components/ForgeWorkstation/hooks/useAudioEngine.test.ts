/**
 * Tests for useAudioEngine hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioEngine } from './useAudioEngine';

// Mock the audio engine
const mockEngine = {
  init: vi.fn().mockResolvedValue(undefined),
  playSlice: vi.fn().mockReturnValue('voice-123'),
  stopAll: vi.fn(),
  getMasterGain: vi.fn().mockReturnValue({
    gain: { setValueAtTime: vi.fn() },
  }),
  getContext: vi.fn().mockReturnValue({ currentTime: 0 }),
  loadSliceBank: vi.fn().mockResolvedValue(undefined),
  protectBank: vi.fn(),
  isBankReady: vi.fn().mockReturnValue(true),
  setStemMute: vi.fn(),
  setStemSolo: vi.fn(),
};

vi.mock('../../../audio/engine', () => ({
  getAudioEngine: () => mockEngine,
}));

describe('useAudioEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize audio engine on mount', async () => {
    const { result } = renderHook(() => useAudioEngine());
    
    // Wait for init to complete
    await vi.waitFor(() => {
      expect(mockEngine.init).toHaveBeenCalled();
    });
    
    expect(result.current.engine).toBe(mockEngine);
  });

  it('should play slice and track voice', () => {
    const { result } = renderHook(() => useAudioEngine());
    
    act(() => {
      const voiceId = result.current.playSlice('bank-123', 0, {}, 0.5);
      expect(voiceId).toBe('voice-123');
    });

    expect(mockEngine.playSlice).toHaveBeenCalledWith('bank-123', 0, {});
  });

  it('should stop all playback', () => {
    const { result } = renderHook(() => useAudioEngine());
    
    act(() => {
      result.current.stopAll();
    });

    expect(mockEngine.stopAll).toHaveBeenCalled();
  });

  it('should set volume', () => {
    const { result } = renderHook(() => useAudioEngine());
    
    act(() => {
      result.current.setVolume(0.5);
    });

    expect(result.current.volume).toBe(0.5);
  });

  it('should load slice bank', async () => {
    const { result } = renderHook(() => useAudioEngine());
    
    await act(async () => {
      await result.current.loadSliceBank('bank-123', '/url', [
        { startTime: 0, endTime: 0.5 },
      ]);
    });

    expect(mockEngine.loadSliceBank).toHaveBeenCalled();
    expect(mockEngine.protectBank).toHaveBeenCalledWith('bank-123');
  });

  it('should check if bank is ready', () => {
    const { result } = renderHook(() => useAudioEngine());
    
    const isReady = result.current.isBankReady('bank-123');
    
    expect(isReady).toBe(true);
    expect(mockEngine.isBankReady).toHaveBeenCalledWith('bank-123');
  });

  it('should set stem mute', () => {
    const { result } = renderHook(() => useAudioEngine());
    
    act(() => {
      result.current.setStemMute('drums', true);
    });

    expect(mockEngine.setStemMute).toHaveBeenCalledWith('drums', true);
  });

  it('should set stem solo', () => {
    const { result } = renderHook(() => useAudioEngine());
    
    act(() => {
      result.current.setStemSolo('drums', true);
    });

    expect(mockEngine.setStemSolo).toHaveBeenCalledWith('drums', true);
  });
});
