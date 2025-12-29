/**
 * usePads - Hook for pad state management
 * 
 * Handles pad data, slice loading, and trigger logic
 */

import { useState, useCallback } from 'react';
import { RuleEngine, TriggerRule } from '../../../audio/ruleEngine';
import { api, SliceBank, Sequence } from '../../../api/client';

export interface PadData {
  index: number;
  loaded: boolean;
  startTime: number;
  endTime: number;
  stemId?: string;
  bankId?: string;
  waveformPeaks?: number[];
}

const ruleEngine = new RuleEngine();

export function usePads(padCount: number = 16) {
  const [pads, setPads] = useState<PadData[]>(
    Array.from({ length: padCount }, (_, i) => ({
      index: i,
      loaded: false,
      startTime: 0,
      endTime: 0,
    }))
  );

  const [sliceBanks, setSliceBanks] = useState<Map<string, SliceBank>>(new Map());
  const [triggerRules, setTriggerRules] = useState<TriggerRule[]>([]);
  const [playingPad, setPlayingPad] = useState<number | null>(null);

  // Generate fake waveform peaks for visualization
  const generatePeaks = (count: number = 32): number[] => {
    return Array.from({ length: count }, () => 0.2 + Math.random() * 0.6);
  };

  // Create slice bank and load into pads
  const loadStemIntoPads = useCallback(async (
    sessionId: string,
    stemPath: string,
    stemName: string,
    stemId: string,
    bpm: number,
    startPadIndex: number = 0
  ): Promise<SliceBank | null> => {
    try {
      const bank = await api.createSliceBank(sessionId, stemPath, stemName, bpm);
      
      setSliceBanks(prev => new Map(prev).set(stemId, bank));

      // Populate pads with slices
      setPads(prev => {
        const newPads = [...prev];
        bank.slices.slice(0, 8).forEach((slice, i) => {
          const padIndex = startPadIndex + i;
          if (padIndex < newPads.length) {
            newPads[padIndex] = {
              index: padIndex,
              loaded: true,
              startTime: slice.start_time,
              endTime: slice.end_time,
              stemId,
              bankId: bank.id,
              waveformPeaks: generatePeaks(),
            };
          }
        });
        return newPads;
      });

      return bank;
    } catch (e) {
      console.error(`Failed to create slice bank for ${stemName}:`, e);
      return null;
    }
  }, []);

  // Evaluate trigger rules before playing
  const evaluateTrigger = useCallback((
    padIndex: number,
    velocity: number = 1.0,
    beat: number = 0
  ) => {
    const pad = pads[padIndex];
    if (!pad.loaded) return null;

    const modified = ruleEngine.evaluate(
      triggerRules,
      pad.stemId || 'default',
      padIndex,
      velocity,
      beat,
      pad.stemId || 'other'
    );

    return modified;
  }, [pads, triggerRules]);

  // Set playing pad (for visual feedback)
  const triggerPad = useCallback((padIndex: number, duration?: number) => {
    setPlayingPad(padIndex);
    
    if (duration) {
      setTimeout(() => {
        setPlayingPad(prev => prev === padIndex ? null : prev);
      }, duration * 1000);
    }
  }, []);

  // Clear playing state
  const clearPlaying = useCallback(() => {
    setPlayingPad(null);
  }, []);

  // Add trigger rule
  const addRule = useCallback((rule: TriggerRule) => {
    setTriggerRules(prev => [...prev, rule]);
  }, []);

  // Update trigger rule
  const updateRule = useCallback((id: string, updates: Partial<TriggerRule>) => {
    setTriggerRules(prev => 
      prev.map(r => r.id === id ? { ...r, ...updates } : r)
    );
  }, []);

  // Remove trigger rule
  const removeRule = useCallback((id: string) => {
    setTriggerRules(prev => prev.filter(r => r.id !== id));
  }, []);

  // Clear all pads
  const clearPads = useCallback(() => {
    setPads(Array.from({ length: padCount }, (_, i) => ({
      index: i,
      loaded: false,
      startTime: 0,
      endTime: 0,
    })));
    setSliceBanks(new Map());
    setPlayingPad(null);
  }, [padCount]);

  // Get pad by index
  const getPad = useCallback((index: number): PadData | null => {
    return pads[index] || null;
  }, [pads]);

  // Get slice bank for pad
  const getBankForPad = useCallback((padIndex: number): SliceBank | null => {
    const pad = pads[padIndex];
    if (!pad?.bankId) return null;
    return sliceBanks.get(pad.bankId) || null;
  }, [pads, sliceBanks]);

  // =========================================================================
  // CLAP SEMANTIC SEARCH - "punchy kick", "snappy snare"
  // =========================================================================

  const searchByText = useCallback(async (
    bankId: string,
    query: string,
    topK: number = 8
  ) => {
    try {
      // First generate embeddings if not already done
      await api.generateEmbeddings(bankId);
      // Then search
      const results = await api.searchSlicesByText(bankId, query, topK);
      return results.results;
    } catch (e) {
      console.error('CLAP search failed:', e);
      return [];
    }
  }, []);

  // Auto-fill pads with diverse/punchy/bright slices
  const generateAutoKit = useCallback(async (
    bankId: string,
    strategy: 'diverse' | 'punchy' | 'bright' | 'deep' = 'diverse'
  ) => {
    try {
      await api.generateEmbeddings(bankId);
      const result = await api.generateAutoKit(bankId, { numPads: 16, strategy });
      
      // Update pads with auto-kit results
      setPads(prev => {
        const newPads = [...prev];
        result.kit.forEach(item => {
          if (item.pad < newPads.length) {
            newPads[item.pad] = {
              index: item.pad,
              loaded: true,
              startTime: item.start_time,
              endTime: item.end_time,
              bankId,
              waveformPeaks: generatePeaks(),
            };
          }
        });
        return newPads;
      });
      
      return result;
    } catch (e) {
      console.error('Auto-kit generation failed:', e);
      return null;
    }
  }, []);

  // =========================================================================
  // SEQUENCE GENERATION - Euclidean, probability patterns
  // =========================================================================

  const [currentSequence, setCurrentSequence] = useState<Sequence | null>(null);

  const generateSequence = useCallback(async (
    sessionId: string,
    bankId: string,
    options: {
      mode?: 'sequential' | 'random' | 'euclidean' | 'probability';
      durationBeats?: number;
      bpm?: number;
      euclideanHits?: number;
      euclideanSteps?: number;
      euclideanRotation?: number;
      probabilities?: number[];
    } = {}
  ) => {
    try {
      const sequence = await api.generateSequence({
        sessionId,
        sliceBankId: bankId,
        durationBeats: options.durationBeats ?? 16,
        bpm: options.bpm ?? 120,
        mode: options.mode ?? 'euclidean',
        euclideanHits: options.euclideanHits ?? 4,
        euclideanSteps: options.euclideanSteps ?? 16,
        euclideanRotation: options.euclideanRotation ?? 0,
        probabilities: options.probabilities,
      });
      setCurrentSequence(sequence);
      return sequence;
    } catch (e) {
      console.error('Sequence generation failed:', e);
      return null;
    }
  }, []);

  return {
    pads,
    playingPad,
    triggerRules,
    sliceBanks,
    currentSequence,
    loadStemIntoPads,
    evaluateTrigger,
    triggerPad,
    clearPlaying,
    addRule,
    updateRule,
    removeRule,
    clearPads,
    getPad,
    getBankForPad,
    // CLAP search
    searchByText,
    generateAutoKit,
    // Sequence generation
    generateSequence,
  };
}
