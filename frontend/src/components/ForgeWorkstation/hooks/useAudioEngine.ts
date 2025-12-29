/**
 * useAudioEngine - Hook for audio engine integration
 * 
 * Wraps the singleton audio engine with React-friendly state
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { getAudioEngine, SlicePlaybackOptions } from '../../../audio/engine';

interface AudioEngineState {
  isReady: boolean;
  isPlaying: boolean;
  volume: number;
  playingVoices: Set<string>;
}

export function useAudioEngine() {
  const engine = getAudioEngine();
  const [state, setState] = useState<AudioEngineState>({
    isReady: false,
    isPlaying: false,
    volume: 0.8,
    playingVoices: new Set(),
  });
  
  const voiceTimeouts = useRef<Map<string, number>>(new Map());

  // Initialize engine
  useEffect(() => {
    engine.init().then(() => {
      setState(s => ({ ...s, isReady: true }));
    }).catch(console.error);
  }, [engine]);

  // Play a slice
  const playSlice = useCallback((
    bankId: string,
    sliceIndex: number,
    options: SlicePlaybackOptions = {},
    duration?: number
  ): string | null => {
    const voiceId = engine.playSlice(bankId, sliceIndex, options);
    
    if (voiceId) {
      setState(s => ({
        ...s,
        playingVoices: new Set(s.playingVoices).add(voiceId),
      }));

      // Auto-remove voice after duration
      if (duration) {
        const timeout = window.setTimeout(() => {
          setState(s => {
            const voices = new Set(s.playingVoices);
            voices.delete(voiceId);
            return { ...s, playingVoices: voices };
          });
          voiceTimeouts.current.delete(voiceId);
        }, duration * 1000);
        
        voiceTimeouts.current.set(voiceId, timeout);
      }
    }
    
    return voiceId;
  }, [engine]);

  // Stop all playback
  const stopAll = useCallback(() => {
    engine.stopAll();
    voiceTimeouts.current.forEach(t => clearTimeout(t));
    voiceTimeouts.current.clear();
    setState(s => ({ ...s, playingVoices: new Set(), isPlaying: false }));
  }, [engine]);

  // Set volume
  const setVolume = useCallback((volume: number) => {
    const gain = engine.getMasterGain();
    const ctx = engine.getContext();
    if (gain && ctx) {
      gain.gain.setValueAtTime(volume, ctx.currentTime);
    }
    setState(s => ({ ...s, volume }));
  }, [engine]);

  // Load slice bank
  const loadSliceBank = useCallback(async (
    bankId: string,
    stemUrl: string,
    slices: Array<{ startTime: number; endTime: number }>
  ) => {
    await engine.loadSliceBank(bankId, stemUrl, slices);
    engine.protectBank(bankId);
  }, [engine]);

  // Check if bank is ready
  const isBankReady = useCallback((bankId: string): boolean => {
    return engine.isBankReady(bankId);
  }, [engine]);

  // Mute/Solo controls
  const setStemMute = useCallback((stemId: string, muted: boolean) => {
    engine.setStemMute(stemId, muted);
  }, [engine]);

  const setStemSolo = useCallback((stemId: string, soloed: boolean) => {
    engine.setStemSolo(stemId, soloed);
  }, [engine]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      voiceTimeouts.current.forEach(t => clearTimeout(t));
    };
  }, []);

  return {
    ...state,
    playSlice,
    stopAll,
    setVolume,
    loadSliceBank,
    isBankReady,
    setStemMute,
    setStemSolo,
    engine,
  };
}
