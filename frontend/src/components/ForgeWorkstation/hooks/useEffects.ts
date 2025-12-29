/**
 * useEffects - Hook for audio effects (Harmonic Filter, Grid Analysis)
 * 
 * Wires up the powerful backend effects that were previously unused
 */

import { useState, useCallback } from 'react';
import { api } from '../../../api/client';

interface GridAnalysis {
  bpm: number;
  bpm_confidence: number;
  time_signature: [number, number];
  beats: number[];
  downbeats: number[];
  duration: number;
  num_beats: number;
  num_bars: number;
}

interface HarmonicFilterResult {
  output_path: string;
  output_url: string;
  root_note: string;
  mode: string;
  voicing: string;
  motion: string;
}

export function useEffects() {
  const [gridAnalysis, setGridAnalysis] = useState<GridAnalysis | null>(null);
  const [harmonicResult, setHarmonicResult] = useState<HarmonicFilterResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // =========================================================================
  // GRID ANALYSIS - Beat/downbeat detection
  // =========================================================================

  const analyzeGrid = useCallback(async (
    sessionId: string,
    options: { stem?: string; timeSignatureBeats?: number } = {}
  ) => {
    setIsProcessing(true);
    try {
      const result = await api.analyzeGrid(sessionId, options);
      setGridAnalysis(result.grid);
      return result.grid;
    } catch (e) {
      console.error('Grid analysis failed:', e);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Quantize slices to detected grid
  const quantizeToGrid = useCallback(async (
    sliceBankId: string,
    options: { strength?: number; mode?: 'nearest' | 'floor' | 'ceil' } = {}
  ) => {
    try {
      const result = await api.quantizeSlicesToGrid(sliceBankId, options);
      return result;
    } catch (e) {
      console.error('Quantize failed:', e);
      return null;
    }
  }, []);

  // =========================================================================
  // HARMONIC FILTER - Harmonium-inspired spectral filtering
  // =========================================================================

  const applyHarmonicFilter = useCallback(async (
    sessionId: string,
    stemPath: string,
    options: {
      rootNote: string;
      mode?: 'major' | 'minor' | 'chromatic' | 'pentatonic' | 'dorian';
      resonance?: number;
      voicing?: 'natural' | 'odd_only' | 'fifth' | 'spread' | 'dense';
      motion?: 'static' | 'breathe' | 'pulse' | 'shimmer' | 'drift';
      motionRate?: number;
      motionDepth?: number;
    }
  ) => {
    setIsProcessing(true);
    try {
      const result = await api.applyHarmonicFilter({
        sessionId,
        stemPath,
        rootNote: options.rootNote,
        mode: options.mode ?? 'major',
        resonance: options.resonance ?? 0.5,
        voicing: options.voicing ?? 'natural',
        motion: options.motion ?? 'static',
        motionRate: options.motionRate ?? 0.1,
        motionDepth: options.motionDepth ?? 0.3,
      });
      setHarmonicResult(result);
      return result;
    } catch (e) {
      console.error('Harmonic filter failed:', e);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Preview harmonic frequencies for UI display
  const previewFrequencies = useCallback(async (
    rootNote: string,
    mode: string = 'major'
  ) => {
    try {
      const result = await api.previewHarmonicFrequencies(rootNote, mode);
      return result.frequencies;
    } catch (e) {
      console.error('Preview frequencies failed:', e);
      return [];
    }
  }, []);

  return {
    gridAnalysis,
    harmonicResult,
    isProcessing,
    analyzeGrid,
    quantizeToGrid,
    applyHarmonicFilter,
    previewFrequencies,
  };
}
