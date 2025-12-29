/**
 * Tests for useSession hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSession } from './useSession';

// Mock API
vi.mock('../../../api/client', () => ({
  api: {
    upload: vi.fn().mockResolvedValue({
      session_id: 'session-123',
      filename: 'test.mp3',
    }),
    getSession: vi.fn().mockResolvedValue({
      id: 'session-123',
      name: null,
      source_filename: 'test.mp3',
      bpm: 120,
      key: 'Am',
      duration_seconds: 180,
      stems: [
        { id: 'stem-1', name: 'drums', filename: 'drums.wav', path: '/path/drums.wav' },
        { id: 'stem-2', name: 'bass', filename: 'bass.wav', path: '/path/bass.wav' },
      ],
      jobs: [],
    }),
    detectMoments: vi.fn().mockResolvedValue({
      moments: [
        { id: 'm1', type: 'hit', start_time: 0, end_time: 0.5, confidence: 0.9, energy: 0.8, brightness: 0.5, label: 'Kick' },
      ],
    }),
  },
}));

// Mock WebSocket
const mockWebSocket = {
  close: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
};
vi.stubGlobal('WebSocket', vi.fn(() => mockWebSocket));

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with null session', () => {
    const { result } = renderHook(() => useSession());
    
    expect(result.current.session).toBeNull();
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.moments).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('should clear error', () => {
    const { result } = renderHook(() => useSession());
    
    // Manually set an error state (normally would happen from failed API call)
    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('should clear session', () => {
    const { result } = renderHook(() => useSession());
    
    act(() => {
      result.current.clearSession();
    });

    expect(result.current.session).toBeNull();
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.moments).toHaveLength(0);
  });
});
