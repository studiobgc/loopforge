/**
 * DAWWorkspace - Main Loop Forge interface
 * 
 * A professional DAW-style workspace with:
 * - Top: Transport bar
 * - Left: Stem mixer with solo/mute
 * - Center: Waveform & slice grid
 * - Right: Sequencer mode & rules
 * - Bottom: Spectrum analyzer
 * 
 * Inspired by Ableton + Max/MSP + cutting-edge AI tools
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Scissors,
  Music,
  Drum,
  Mic2,
  Waves,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Sparkles,
  Grid3X3,
  Activity,
  Zap,
  Play,
  Pause,
  Square,
  Repeat,
  Timer,
} from 'lucide-react';

import { api } from '../../api/client';
import { getAudioEngine } from '../../audio/engine';
import { generateEuclidean, EUCLIDEAN_PRESETS, patternToString } from '../../audio/generators/euclidean';
import { getRuleEngine, CrossStemRouter } from '../../audio/ruleEngine';
import { useKeyboardShortcuts, createDAWShortcuts } from '../../hooks/useKeyboardShortcuts';
import { TransportBar } from './TransportBar';
import { WaveformCanvas } from '../visualizers/WaveformCanvas';
import { SpectrumAnalyzer } from '../visualizers/SpectrumAnalyzer';
import { TriggerRuleEditor } from './TriggerRuleEditor';
import { SliceGrid } from './SliceGrid';
import { CrossStemMatrix } from './CrossStemMatrix';
import { MomentsTimeline } from './MomentsTimeline';
import { VariationGenerator } from './VariationGenerator';
import { PeaksWaveform } from '../audio/PeaksWaveform';

const API_BASE = '';

const LOADING_PAD_KEYMAP: Record<string, number> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  'q': 4,
  'w': 5,
  'e': 6,
  'r': 7,
  'a': 8,
  's': 9,
  'd': 10,
  'f': 11,
  'z': 12,
  'x': 13,
  'c': 14,
  'v': 15,
};

// =============================================================================
// TYPES
// =============================================================================

interface Stem {
  id: string;
  name: string;
  role: 'drums' | 'bass' | 'vocals' | 'other';
  path: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  sliceBankId: string | null;
  sliceCount: number;
  audioBuffer: AudioBuffer | null;
}

interface TriggerRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  probability: number;
  enabled: boolean;
}

interface Slice {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  energy: number;
  transientStrength: number;
  brightness: number;
}

interface PatternEvent {
  id: string;
  stemId: string;
  sliceIndex: number;
  beat: number; // quantized beat position within loop
  microOffset: number; // +/- beats
  velocity: number;
}

interface StemMoment {
  type: 'hit' | 'phrase' | 'texture' | 'change';
  start: number;
  end: number;
  confidence: number;
  energy: number;
  brightness: number;
  label: string;
}

interface CrossRoute {
  sourceId: string;
  targetId: string;
  enabled: boolean;
  probability: number;
  velocityScale: number;
  sliceMode: 'same' | 'random' | 'sequential' | 'energy-match';
  pitchOffset: number;
  timeOffset: number;
}

type SequencerMode = 'sequential' | 'random' | 'probability' | 'euclidean' | 'chaos' | 'follow';

interface SessionState {
  id: string;
  filename: string;
  bpm: number;
  key: string;
  stems: Stem[];
  duration_seconds?: number;
}

// =============================================================================
// STEM ICON HELPER
// =============================================================================

const getStemIcon = (role: string) => {
  switch (role) {
    case 'drums': return <Drum className="w-4 h-4" />;
    case 'bass': return <Waves className="w-4 h-4" />;
    case 'vocals': return <Mic2 className="w-4 h-4" />;
    default: return <Music className="w-4 h-4" />;
  }
};

const getStemColor = (role: string) => {
  switch (role) {
    case 'drums': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    case 'bass': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
    case 'vocals': return 'text-purple-400 bg-purple-500/10 border-purple-500/30';
    default: return 'text-green-400 bg-green-500/10 border-green-500/30';
  }
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const DAWWorkspace: React.FC = () => {
  // Session state
  const [session, setSession] = useState<SessionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fastPreviewMode, setFastPreviewMode] = useState(false);

  const [previewVolume, setPreviewVolume] = useState(0.9);
  const previewVolumeRef = useRef(0.9);
  const previewVoicesRef = useRef<HTMLAudioElement[]>([]);
  const previewVoiceCursorRef = useRef(0);
  const previewStopTimerRef = useRef<number | null>(null);
  const previewLoopTimerRef = useRef<number | null>(null);
  const [isAuditioningPreview, setIsAuditioningPreview] = useState(false);
  const [playingPreviewPads, setPlayingPreviewPads] = useState<Set<number>>(new Set());
  const peaksPreviewRef = useRef<any>(null);

  const [loopSelectedMoment, setLoopSelectedMoment] = useState(false);
  const loopSelectedMomentRef = useRef(false);
  const [quantizePreviewPads, setQuantizePreviewPads] = useState(true);

  // Raw preview during processing
  const [rawPreviewUrl, setRawPreviewUrl] = useState<string | null>(null);
  const [rawSourcePath, setRawSourcePath] = useState<string | null>(null);
  const [processingSessionId, setProcessingSessionId] = useState<string | null>(null);
  const processingJobsRef = useRef<Array<{ id: string; type: string }>>([]);
  const pollTimerRef = useRef<number | null>(null);
  const wsReconnectTimerRef = useRef<number | null>(null);
  const wsReconnectAttemptsRef = useRef(0);

  // Moments-first: user can click a detected moment and send that region to pads
  const [momentSlices, setMomentSlices] = useState<null | {
    bankId: string;
    role: 'drums' | 'bass' | 'vocals' | 'other';
    slices: Slice[];
    startTime: number;
    endTime: number;
  }>(null);
  const [selectedMomentIndex, setSelectedMomentIndex] = useState<number | null>(null);
  const [isCreatingMomentSlices, setIsCreatingMomentSlices] = useState(false);
  const [momentSlicesError, setMomentSlicesError] = useState<string | null>(null);

  // Moments detected during processing (for instant navigation of long files)
  const [detectedMoments, setDetectedMoments] = useState<Array<{
    type: string;
    start: number;
    end: number;
    confidence: number;
    label: string;
  }>>([]);
  const [momentsReady, setMomentsReady] = useState(false);

  // Refs to avoid stale closure values inside polling/WS handlers
  const momentsReadyRef = useRef(false);
  const momentSlicesRef = useRef<typeof momentSlices>(null);
  const rawPreviewUrlRef = useRef<string | null>(null);
  const rawSourcePathRef = useRef<string | null>(null);
  const processingSessionIdRef = useRef<string | null>(null);
  
  // Transport state
  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.8);

  // MPC pattern state
  const [gridDivision, setGridDivision] = useState<32 | 64>(64);
  const [swingAmount, setSwingAmount] = useState(0.0);
  const [isRecording, setIsRecording] = useState(false);
  const [isOverdubbing, setIsOverdubbing] = useState(true);
  const [patternByStem, setPatternByStem] = useState<Record<string, PatternEvent[]>>({});

  // Pad Pages (A/B/C/D like MPC banks)
  const [padPage, setPadPage] = useState<'A' | 'B' | 'C' | 'D'>('A');

  // Feel Presets (Dilla Loose / Tight / Drunk / Machine)
  type FeelPreset = 'dilla' | 'tight' | 'drunk' | 'machine';
  const [feelPreset, setFeelPreset] = useState<FeelPreset>('dilla');

  // Feel preset configs
  const FEEL_PRESETS: Record<FeelPreset, { swing: number; velocityRand: number; timingRand: number; label: string }> = {
    dilla: { swing: 0.62, velocityRand: 0.15, timingRand: 0.08, label: 'Dilla Loose' },
    tight: { swing: 0.0, velocityRand: 0.0, timingRand: 0.0, label: 'Tight' },
    drunk: { swing: 0.45, velocityRand: 0.25, timingRand: 0.15, label: 'Drunk' },
    machine: { swing: 0.0, velocityRand: 0.0, timingRand: 0.0, label: 'Machine' },
  };

  // Bounce state
  const [isBouncing, setIsBouncing] = useState(false);

  // Clip editor state
  const [isClipEditorFocused, setIsClipEditorFocused] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [selectionAnchorStep, setSelectionAnchorStep] = useState<number | null>(null);
  const [cursorStep, setCursorStep] = useState(0);
  const [clipboard, setClipboard] = useState<{
    events: PatternEvent[];
    minBeat: number;
  } | null>(null);
  
  // UI state
  const [selectedStemId, setSelectedStemId] = useState<string | null>(null);
  const [sequencerMode, setSequencerMode] = useState<SequencerMode>('sequential');
  const [rules, setRules] = useState<TriggerRule[]>([]);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true); // Start collapsed to reduce overwhelm
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  
  // Slice state (populated from backend)
  const [slices, setSlices] = useState<Slice[]>([]);
  const [playingSliceIndex, setPlayingSliceIndex] = useState<number | null>(null);
  const [crossRoutes, setCrossRoutes] = useState<CrossRoute[]>([]);
  const [momentRoutes, setMomentRoutes] = useState<CrossRoute[]>([]);
  const [momentRoutingEnabled, setMomentRoutingEnabled] = useState(false);
  const [momentMaxPerLoop, setMomentMaxPerLoop] = useState(16);
  const [stemMoments, setStemMoments] = useState<Record<string, StemMoment[]>>({});
  const [stemMomentBias, setStemMomentBias] = useState<Record<string, 'hits' | 'phrases' | 'textures' | 'balanced'>>({});
  const [detectingStemMoments, setDetectingStemMoments] = useState<Record<string, boolean>>({});
  const [stemMomentTypes, setStemMomentTypes] = useState<Record<string, { hit: boolean; phrase: boolean; texture: boolean; change: boolean }>>({});
  const [sliceProbabilities, setSliceProbabilities] = useState<Record<string, number[]>>({});
  const [showProbabilities, setShowProbabilities] = useState(false);
  
  // Euclidean sequencer state
  const [euclideanSteps, setEuclideanSteps] = useState(16);
  const [euclideanPulses, setEuclideanPulses] = useState(4);
  const [euclideanRotation, setEuclideanRotation] = useState(0);
  const [euclideanPattern, setEuclideanPattern] = useState<boolean[]>([]);
  
  // View state
  const [zoom, setZoom] = useState(1);
  
  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioEngine = useRef(getAudioEngine());
  const ruleEngine = useRef(getRuleEngine());
  // const crossStemRouter = useRef(getCrossStemRouter()); // Disabled - advanced feature
  const momentStemRouter = useRef(new CrossStemRouter());
  const sliceCacheRef = useRef<Map<string, { bankId: string; slices: Slice[] }>>(new Map());
  const scheduledLoopIndexRef = useRef<number>(-1);
  const patternByStemRef = useRef<Record<string, PatternEvent[]>>({});
  const rulesRef = useRef<typeof rules>([]);
  const crossRoutesRef = useRef<typeof crossRoutes>([]);
  const momentRoutesRef = useRef<typeof momentRoutes>([]);
  const momentRoutingEnabledRef = useRef(false);
  const momentMaxPerLoopRef = useRef(16);
  const stemMomentsRef = useRef<Record<string, StemMoment[]>>({});
  const stemMomentTypesRef = useRef<Record<string, { hit: boolean; phrase: boolean; texture: boolean; change: boolean }>>({});
  const handleTogglePlayRef = useRef<() => void>(() => {});

  const buildFileUrl = useCallback((relativePath: string) => {
    const trimmed = relativePath.replace(/^\/+/, '');
    return `${API_BASE}/files/${trimmed}`;
  }, []);

  // Keep refs in sync for polling/WS closures
  useEffect(() => {
    momentsReadyRef.current = momentsReady;
  }, [momentsReady]);
  useEffect(() => {
    momentSlicesRef.current = momentSlices;
  }, [momentSlices]);
  useEffect(() => {
    rawPreviewUrlRef.current = rawPreviewUrl;
  }, [rawPreviewUrl]);
  useEffect(() => {
    previewVolumeRef.current = previewVolume;
    for (const v of previewVoicesRef.current) {
      v.volume = previewVolume;
    }
  }, [previewVolume]);

  useEffect(() => {
    loopSelectedMomentRef.current = loopSelectedMoment;
  }, [loopSelectedMoment]);
  useEffect(() => {
    rawSourcePathRef.current = rawSourcePath;
  }, [rawSourcePath]);
  useEffect(() => {
    processingSessionIdRef.current = processingSessionId;
  }, [processingSessionId]);

  useEffect(() => {
    for (const v of previewVoicesRef.current) {
      try {
        v.pause();
        v.src = '';
      } catch {
        // ignore
      }
    }
    previewVoicesRef.current = [];
    previewVoiceCursorRef.current = 0;
    if (previewStopTimerRef.current) {
      window.clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    setIsAuditioningPreview(false);
    setPlayingPreviewPads(new Set());

    if (!rawPreviewUrl) return;

    const voices = Array.from({ length: 8 }, () => {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.src = rawPreviewUrl;
      a.preload = 'auto';
      a.volume = previewVolumeRef.current;
      return a;
    });

    previewVoicesRef.current = voices;
    return () => {
      for (const v of voices) {
        try {
          v.pause();
          v.src = '';
        } catch {
          // ignore
        }
      }
    };
  }, [rawPreviewUrl]);

  const stopPreviewAudio = useCallback(() => {
    if (previewStopTimerRef.current) {
      window.clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    if (previewLoopTimerRef.current) {
      window.clearInterval(previewLoopTimerRef.current);
      previewLoopTimerRef.current = null;
    }
    for (const v of previewVoicesRef.current) {
      try {
        v.pause();
      } catch {
        // ignore
      }
    }
    try {
      peaksPreviewRef.current?.player?.pause?.();
    } catch {
      // ignore
    }
    setIsAuditioningPreview(false);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    stopPreviewAudio();
    for (const v of previewVoicesRef.current) {
      try {
        v.pause();
        v.src = '';
      } catch {
        // ignore
      }
    }
    previewVoicesRef.current = [];
    previewVoiceCursorRef.current = 0;
  }, [isLoading, stopPreviewAudio]);

  const playPreviewRange = useCallback(async (
    startTime: number,
    endTime: number,
    opts: { poly?: boolean; padIndex?: number } = {}
  ) => {
    const voices = previewVoicesRef.current;
    if (!voices.length) return;

    const safeStart = Math.max(0, startTime);
    const safeEnd = Math.max(safeStart, endTime);
    const durationMs = Math.min((safeEnd - safeStart) * 1000, 15000);

    const voice = opts.poly
      ? voices[previewVoiceCursorRef.current++ % voices.length]
      : voices[0];

    const ensureReady = () => {
      if (voice.readyState >= 1) return Promise.resolve();
      return new Promise<void>((resolve) => {
        voice.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    };

    try {
      await ensureReady();
      try {
        voice.pause();
      } catch {
        // ignore
      }
      voice.currentTime = safeStart;
      await voice.play();
    } catch {
      return;
    }

    if (!opts.poly) {
      setIsAuditioningPreview(true);
      if (previewStopTimerRef.current) {
        window.clearTimeout(previewStopTimerRef.current);
      }
      previewStopTimerRef.current = window.setTimeout(() => {
        try {
          voice.pause();
        } catch {
          // ignore
        }
        setIsAuditioningPreview(false);
      }, durationMs);
    } else if (opts.padIndex !== undefined) {
      setPlayingPreviewPads((prev) => {
        const next = new Set(prev);
        next.add(opts.padIndex!);
        return next;
      });
      window.setTimeout(() => {
        setPlayingPreviewPads((prev) => {
          const next = new Set(prev);
          next.delete(opts.padIndex!);
          return next;
        });
        try {
          voice.pause();
        } catch {
          // ignore
        }
      }, Math.min(durationMs, 600));
    }
  }, []);

  const handleMomentSendToPads = useCallback(async (m: { type: string; start: number; end: number; label: string }, idx: number) => {
    const sessionId = processingSessionIdRef.current;
    const sourcePath = rawSourcePathRef.current;
    if (!sessionId || !sourcePath) return;

    setSelectedMomentIndex(idx);
    setIsCreatingMomentSlices(true);
    setMomentSlicesError(null);

    try {
      const role: 'drums' | 'bass' | 'vocals' | 'other' =
        m.type === 'hit' ? 'drums' :
        m.type === 'phrase' ? 'vocals' :
        'other';

      const result = await api.createRegionSlices({
        sessionId,
        audioPath: sourcePath,
        startTime: m.start,
        endTime: m.end,
        role,
      });

      const mappedSlices: Slice[] = (result.slices || []).map((s: any, idx: number) => ({
        index: idx,
        startTime: s.start_time,
        endTime: s.end_time,
        duration: s.duration,
        energy: s.rms_energy ?? 0.5,
        transientStrength: s.transient_strength ?? 0.5,
        brightness: (s.spectral_centroid ?? 0) / 20000,
      }));

      setMomentSlices({
        bankId: result.id,
        role,
        slices: mappedSlices.slice(0, 16),
        startTime: m.start,
        endTime: m.end,
      });
    } catch (e) {
      setMomentSlicesError('Failed to slice that moment');
    } finally {
      setIsCreatingMomentSlices(false);
    }
  }, []);

  const selectedMoment = useMemo(() => {
    if (selectedMomentIndex === null) return null;
    return detectedMoments[selectedMomentIndex] ?? null;
  }, [detectedMoments, selectedMomentIndex]);

  const loopSelectedMomentPlayback = useCallback(async () => {
    if (!selectedMoment) return;
    const voices = previewVoicesRef.current;
    if (!voices.length) return;

    const start = Math.max(0, selectedMoment.start);
    const end = Math.max(start, selectedMoment.end);
    const voice = voices[0];

    const ensureReady = () => {
      if (voice.readyState >= 1) return Promise.resolve();
      return new Promise<void>((resolve) => {
        voice.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    };

    try {
      await ensureReady();
      try {
        voice.pause();
      } catch {
        // ignore
      }
      voice.currentTime = start;
      await voice.play();
    } catch {
      return;
    }

    setIsAuditioningPreview(true);

    if (previewLoopTimerRef.current) {
      window.clearInterval(previewLoopTimerRef.current);
    }

    previewLoopTimerRef.current = window.setInterval(() => {
      if (!loopSelectedMomentRef.current) {
        if (previewLoopTimerRef.current) {
          window.clearInterval(previewLoopTimerRef.current);
          previewLoopTimerRef.current = null;
        }
        return;
      }
      try {
        if (voice.currentTime >= end) {
          voice.currentTime = start;
        }
      } catch {
        // ignore
      }
    }, 30);
  }, [selectedMoment]);

  const visibleMomentIndices = useMemo(() => {
    const total = detectedMoments.length;
    const max = 12;
    if (total <= max) return Array.from({ length: total }, (_, i) => i);
    const sel = selectedMomentIndex ?? 0;
    const half = Math.floor(max / 2);
    let start = Math.max(0, sel - half);
    let end = start + max;
    if (end > total) {
      end = total;
      start = Math.max(0, end - max);
    }
    return Array.from({ length: end - start }, (_, i) => start + i);
  }, [detectedMoments.length, selectedMomentIndex]);

  useEffect(() => {
    if (!momentsReady) return;
    if (!detectedMoments.length) return;
    if (selectedMomentIndex !== null) return;
    setSelectedMomentIndex(0);
  }, [detectedMoments.length, momentsReady, selectedMomentIndex]);

  useEffect(() => {
    if (!selectedMoment) return;
    try {
      peaksPreviewRef.current?.player?.seek?.(selectedMoment.start);
    } catch {
      // ignore
    }
  }, [selectedMoment]);

  const previewRegions = useMemo(() => {
    if (!selectedMoment) return [];
    return [
      {
        id: 'selected',
        start: selectedMoment.start,
        end: selectedMoment.end,
        color: 'rgba(245, 158, 11, 0.25)',
        drag: false,
        resize: false,
      },
    ];
  }, [selectedMoment]);

  const auditionSelectedMoment = useCallback(async () => {
    if (!selectedMoment) return;
    if (loopSelectedMomentRef.current) {
      stopPreviewAudio();
      await loopSelectedMomentPlayback();
      return;
    }
    const start = selectedMoment.start;
    const end = selectedMoment.end;
    const safeStart = Math.max(0, start);
    const safeEnd = Math.max(safeStart, end);
    const durationMs = Math.min((safeEnd - safeStart) * 1000, 15000);

    const peaks = peaksPreviewRef.current;
    if (peaks?.player?.seek && peaks?.player?.play && peaks?.player?.pause) {
      try {
        peaks.player.pause();
      } catch {
        // ignore
      }
      try {
        peaks.player.seek(safeStart);
        peaks.player.play();
      } catch {
        await playPreviewRange(safeStart, safeEnd);
        return;
      }

      setIsAuditioningPreview(true);
      if (previewStopTimerRef.current) {
        window.clearTimeout(previewStopTimerRef.current);
      }
      previewStopTimerRef.current = window.setTimeout(() => {
        try {
          peaks.player.pause();
        } catch {
          // ignore
        }
        setIsAuditioningPreview(false);
      }, durationMs);

      return;
    }

    await playPreviewRange(safeStart, safeEnd);
  }, [loopSelectedMomentPlayback, playPreviewRange, selectedMoment, stopPreviewAudio]);

  const sliceSelectedMoment = useCallback(async () => {
    if (!selectedMoment || selectedMomentIndex === null) return;
    await handleMomentSendToPads(selectedMoment, selectedMomentIndex);
  }, [handleMomentSendToPads, selectedMoment, selectedMomentIndex]);

  const triggerPreviewPad = useCallback(async (padIndex: number, velocity: number = 0.85) => {
    const picked = momentSlicesRef.current;
    if (!picked) return;
    const slice = picked.slices[padIndex];
    if (!slice) return;
    const vel = Math.max(0.05, Math.min(1, velocity));
    try {
      peaksPreviewRef.current?.player?.pause?.();
    } catch {
      // ignore
    }
    for (const v of previewVoicesRef.current) {
      v.volume = previewVolumeRef.current * vel;
    }
    await playPreviewRange(slice.startTime, slice.endTime, { poly: true, padIndex });
  }, [playPreviewRange]);

  const triggerPreviewPadMaybeQuantized = useCallback((padIndex: number, velocity: number) => {
    if (!quantizePreviewPads) {
      void triggerPreviewPad(padIndex, velocity);
      return;
    }
    const ctx = audioEngine.current.getContext();
    if (!ctx) {
      void triggerPreviewPad(padIndex, velocity);
      return;
    }
    const gridSeconds = (60 / Math.max(1, bpm)) / 4;
    const now = ctx.currentTime;
    const when = Math.ceil(now / gridSeconds) * gridSeconds;
    const delayMs = Math.max(0, (when - now) * 1000);
    window.setTimeout(() => {
      void triggerPreviewPad(padIndex, velocity);
    }, delayMs);
  }, [bpm, quantizePreviewPads, triggerPreviewPad]);

  useEffect(() => {
    if (!isLoading) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (momentSlicesRef.current) {
        const idx = LOADING_PAD_KEYMAP[e.key.toLowerCase()];
        if (idx !== undefined) {
          e.preventDefault();
          triggerPreviewPadMaybeQuantized(idx, 0.85);
          return;
        }
      }

      if (!detectedMoments.length) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMomentIndex((prev) => {
          const next = prev === null ? 0 : Math.min(detectedMoments.length - 1, prev + 1);
          return next;
        });
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMomentIndex((prev) => {
          const next = prev === null ? 0 : Math.max(0, prev - 1);
          return next;
        });
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        // Toggle beat playback (not moments preview)
        if (session) {
          handleTogglePlayRef.current();
        } else {
          auditionSelectedMoment();
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        sliceSelectedMoment();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        stopPreviewAudio();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [auditionSelectedMoment, detectedMoments.length, isLoading, session, sliceSelectedMoment, stopPreviewAudio, triggerPreviewPadMaybeQuantized]);
  
  // Initialize audio engine
  useEffect(() => {
    audioEngine.current.init();
    return () => {
      audioEngine.current.close();
    };
  }, []);

  useEffect(() => {
    patternByStemRef.current = patternByStem;
  }, [patternByStem]);
  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);
  useEffect(() => {
    crossRoutesRef.current = crossRoutes;
  }, [crossRoutes]);
  useEffect(() => {
    momentRoutesRef.current = momentRoutes;
  }, [momentRoutes]);
  useEffect(() => {
    momentRoutingEnabledRef.current = momentRoutingEnabled;
  }, [momentRoutingEnabled]);
  useEffect(() => {
    momentMaxPerLoopRef.current = momentMaxPerLoop;
  }, [momentMaxPerLoop]);
  useEffect(() => {
    stemMomentsRef.current = stemMoments;
  }, [stemMoments]);
  useEffect(() => {
    stemMomentTypesRef.current = stemMomentTypes;
  }, [stemMomentTypes]);
  
  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (wsReconnectTimerRef.current) {
        window.clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
    };
  }, []);
  
  // =============================================================================
  // FILE UPLOAD & PROCESSING
  // =============================================================================

  const getKnownJobType = useCallback((jobId: string | null | undefined) => {
    if (!jobId) return undefined;
    return processingJobsRef.current.find(j => j.id === jobId)?.type;
  }, []);
  
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    
    console.log('[DAWWorkspace] onDrop called with:', file.name, file.size);
    
    setError(null);
    setIsLoading(true);
    setLoadingStage('Uploading...');
    setLoadingProgress(0);
    setRawPreviewUrl(null);
    setRawSourcePath(null);
    setProcessingSessionId(null);
    processingJobsRef.current = [];
    setMomentSlices(null);
    setSelectedMomentIndex(null);
    setMomentSlicesError(null);

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (wsReconnectTimerRef.current) {
      window.clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
    
    try {
      // Resume audio context (requires user gesture)
      console.log('[DAWWorkspace] Resuming audio context...');
      await audioEngine.current.resume();
      console.log('[DAWWorkspace] Audio context resumed');
      
      // Upload file
      console.log('[DAWWorkspace] Starting upload...', { fastPreviewMode });
      const uploadResult = await api.upload(file, {
        autoSeparate: true,
        autoAnalyze: true,
        previewDuration: fastPreviewMode ? 30 : undefined,
      });
      console.log('[DAWWorkspace] Upload complete:', uploadResult);
      
      const sessionId = uploadResult.session_id;
      setProcessingSessionId(sessionId);
      processingJobsRef.current = uploadResult.jobs || [];

      // Instant raw preview while processing
      if (uploadResult.source?.url) {
        const url = `${API_BASE}${uploadResult.source.url}`;
        setRawPreviewUrl(url);
      }
      if (uploadResult.source?.path) {
        setRawSourcePath(uploadResult.source.path);
      }

      const stopPolling = () => {
        if (pollTimerRef.current) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };

      const startPolling = () => {
        if (pollTimerRef.current) return;
        pollTimerRef.current = window.setInterval(async () => {
          try {
            const { jobs } = await api.listJobs(sessionId);
            if (jobs && jobs.length > 0) {
              const active = jobs.filter(j => j.status === 'running' || j.status === 'pending');
              const completed = jobs.filter(j => j.status === 'completed');
              
              // Only separation failure is fatal - moments/peaks failures are non-blocking
              const fatalFailed = jobs.find(j => 
                j.status === 'failed' && j.job_type === 'separation'
              );

              if (fatalFailed) {
                setError(fatalFailed.error_message || 'Processing failed');
                stopPolling();
                setIsLoading(false);
                return;
              }

              // Overall progress: avg of job progresses
              const avg = jobs.reduce((sum, j) => sum + (j.progress ?? 0), 0) / jobs.length;
              const stage = active[0]?.stage || (active[0]?.job_type ? `${active[0].job_type}...` : 'Processing...');
              setLoadingProgress(avg);
              setLoadingStage(stage);

              // Check if moments job completed - show them immediately for long file navigation
              const momentsJob = completed.find(j => j.job_type === 'moments');
              if (momentsJob && momentsJob.output_paths?.moments && !momentsReadyRef.current) {
                // Map backend field names (start_time/end_time) to frontend (start/end)
                const mapped = momentsJob.output_paths.moments.map((m: any) => ({
                  type: m.type,
                  start: m.start_time ?? m.start,
                  end: m.end_time ?? m.end,
                  confidence: m.confidence,
                  label: m.label,
                }));
                setDetectedMoments(mapped);
                setMomentsReady(true);
              }

              // If separation completed, proceed to load session + stems
              const sepDone = completed.some(j => j.job_type === 'separation');
              if (sepDone) {
                stopPolling();
                const sess = await api.getSession(sessionId);
                const stems: Stem[] = sess.stems.map((s: any) => ({
                  id: s.id,
                  name: s.filename,
                  role: s.name as Stem['role'],
                  path: s.path,
                  volume: 1,
                  muted: false,
                  solo: false,
                  sliceBankId: null,
                  sliceCount: 0,
                  audioBuffer: null,
                }));

                setSession({
                  id: sessionId,
                  filename: file.name,
                  bpm: sess.bpm || 120,
                  key: sess.key || 'C',
                  stems,
                });

                setBpm(sess.bpm || 120);
                if (stems.length > 0) setSelectedStemId(stems[0].id);

                setLoadingStage('Loading audio...');
                const audioCtx = audioEngine.current.getContext();
                if (audioCtx) {
                  for (const stem of stems) {
                    try {
                      const stemUrl = buildFileUrl(stem.path);
                      const response = await fetch(stemUrl);
                      if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                        stem.audioBuffer = audioBuffer;
                      }
                    } catch {
                      // ignore
                    }
                  }
                  setSession(prev => prev ? { ...prev, stems: [...stems] } : null);
                }

                // Moments-first: if the user picked a moment region, load those slices into pads
                const picked = momentSlicesRef.current;
                if (picked) {
                  const targetStem = stems.find(s => s.role === picked.role) ?? stems[0];
                  if (targetStem) {
                    setSlices(picked.slices);
                    sliceCacheRef.current.set(targetStem.id, { bankId: picked.bankId, slices: picked.slices });
                    targetStem.sliceBankId = picked.bankId;
                    targetStem.sliceCount = picked.slices.length;
                    setSelectedStemId(targetStem.id);
                  }
                } else {
                  // Auto-kit: create slice bank from drums stem and load best 16 to pads
                  const drumsStem = stems.find(s => s.role === 'drums');
                  if (drumsStem) {
                    try {
                      setLoadingStage('Creating drum kit...');
                      const sliceBank = await api.createSliceBank(
                        sessionId,
                        drumsStem.path,
                        'drums',
                        sess.bpm || 120
                      );
                      if (sliceBank && sliceBank.slices.length > 0) {
                        // Select best 16 slices by transient strength + energy
                        const sorted = [...sliceBank.slices]
                          .sort((a, b) => (b.transient_strength + b.rms_energy) - (a.transient_strength + a.rms_energy))
                          .slice(0, 16);
                        
                        const mappedSlices = sorted.map((s: any, idx: number) => ({
                          index: idx,
                          startTime: s.start_time,
                          endTime: s.end_time,
                          duration: s.duration,
                          energy: s.rms_energy ?? 0.5,
                          transientStrength: s.transient_strength ?? 0.5,
                          brightness: (s.spectral_centroid ?? 0) / 20000,
                        }));
                        
                        setSlices(mappedSlices);
                        sliceCacheRef.current.set(drumsStem.id, { bankId: sliceBank.id, slices: mappedSlices });
                        drumsStem.sliceBankId = sliceBank.id;
                        drumsStem.sliceCount = mappedSlices.length;
                        setSelectedStemId(drumsStem.id);
                        console.log('[DAW] Auto-kit created:', mappedSlices.length, 'slices from drums');
                      }
                    } catch (e) {
                      console.warn('[DAW] Auto-kit failed:', e);
                    }
                  }
                }

                setIsLoading(false);
              }

              // If no active jobs remain, stop polling.
              if (active.length === 0) {
                stopPolling();
              }
            }
          } catch {
            // ignore transient poll errors
          }
        }, 2000);
      };
      
      // Connect WebSocket for progress
      const connectWebSocket = () => {
        const wsUrl = api.getWebSocketUrl(sessionId);
        console.log('[DAWWorkspace] Connecting WebSocket:', wsUrl);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onerror = () => {
          startPolling();
        };

        ws.onopen = () => {
          console.log('[DAWWorkspace] WebSocket connected');
          wsReconnectAttemptsRef.current = 0;
          stopPolling();
          
          // CTO-level: Start heartbeat ping to detect stale connections
          const heartbeatInterval = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
              } catch {
                // Connection may have closed
              }
            } else {
              window.clearInterval(heartbeatInterval);
            }
          }, 15000); // Ping every 15 seconds
          
          // Clean up heartbeat on close
          const originalOnClose = ws.onclose;
          ws.onclose = (e) => {
            window.clearInterval(heartbeatInterval);
            if (originalOnClose) originalOnClose.call(ws, e);
          };
        };

        ws.onclose = (e) => {
          console.log('[DAWWorkspace] WebSocket closed:', e.code, e.reason);
          if (wsReconnectTimerRef.current) {
            window.clearTimeout(wsReconnectTimerRef.current);
            wsReconnectTimerRef.current = null;
          }
          const nextAttempt = wsReconnectAttemptsRef.current + 1;
          wsReconnectAttemptsRef.current = nextAttempt;
          if (nextAttempt <= 5) {
            const backoffMs = 500 * nextAttempt;
            wsReconnectTimerRef.current = window.setTimeout(() => {
              connectWebSocket();
            }, backoffMs);
          } else {
            startPolling();
          }
        };

        ws.onmessage = async (event) => {
        console.log('[DAWWorkspace] WS message:', event.data);
        const data = JSON.parse(event.data);

        // Learn job types from pending events (backend is authoritative)
        if (data.type === 'job.pending' && data.data?.id && data.data?.job_type) {
          const id = String(data.data.id);
          const type = String(data.data.job_type).toLowerCase();
          const exists = processingJobsRef.current.some(j => j.id === id);
          if (!exists) {
            processingJobsRef.current = [...processingJobsRef.current, { id, type }];
          }
        }
        
        // Handle all progress-related events
        if (data.type?.includes('progress') || data.data?.progress !== undefined) {
          const progress = data.data?.progress ?? data.progress ?? 0;
          const stage = data.data?.stage ?? data.stage ?? 'Processing...';
          console.log(`[DAWWorkspace] Progress: ${progress}% - ${stage}`);
          setLoadingProgress(progress);
          setLoadingStage(stage);
        }
        
        // Handle job completion - check both event types and job status
        const isCompleted = data.type === 'job.completed' || 
                           data.type === 'job.COMPLETED' || 
                           data.data?.status === 'completed' ||
                           data.data?.status === 'COMPLETED';
        const jobType = data.data?.job_type;
        const isSeparation = jobType === 'separation' || jobType === 'SEPARATION';
        const isMoments = jobType === 'moments' || jobType === 'MOMENTS';

        if (isCompleted && isMoments) {
          const output = data.data?.output_paths;
          if (output?.moments && !momentsReadyRef.current) {
            // Map backend field names (start_time/end_time) to frontend (start/end)
            const mapped = output.moments.map((m: any) => ({
              type: m.type,
              start: m.start_time ?? m.start,
              end: m.end_time ?? m.end,
              confidence: m.confidence,
              label: m.label,
            }));
            setDetectedMoments(mapped);
            setMomentsReady(true);
          }
        }
        
        if (isCompleted && isSeparation) {
          // Fetch full session
          const sess = await api.getSession(sessionId);
          
          // Create stems from response
          const stems: Stem[] = sess.stems.map((s: any) => ({
            id: s.id,
            name: s.filename,
            role: s.name as Stem['role'],
            path: s.path,
            volume: 1,
            muted: false,
            solo: false,
            sliceBankId: null,
            sliceCount: 0,
            audioBuffer: null,
          }));
          
          setSession({
            id: sessionId,
            filename: file.name,
            bpm: sess.bpm || 120,
            key: sess.key || 'C',
            stems,
          });
          
          setBpm(sess.bpm || 120);
          
          if (stems.length > 0) {
            setSelectedStemId(stems[0].id);
          }
          
          setLoadingStage('Loading audio...');
          const audioCtx = audioEngine.current.getContext();
          const updateStemBuffer = (stemId: string, audioBuffer: AudioBuffer) => {
            setSession(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                stems: prev.stems.map(s => (s.id === stemId ? { ...s, audioBuffer } : s)),
              };
            });
          };

          const loadStem = async (stem: Stem) => {
            if (!audioCtx) return;
            const stemUrl = buildFileUrl(stem.path);
            const response = await fetch(stemUrl);
            if (!response.ok) return;
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            updateStemBuffer(stem.id, audioBuffer);
          };

          if (audioCtx) {
            const concurrency = 2;
            let index = 0;
            const runWorker = async () => {
              while (index < stems.length) {
                const stem = stems[index++];
                try {
                  await loadStem(stem);
                } catch {
                  // ignore
                }
              }
            };
            await Promise.all(Array.from({ length: Math.min(concurrency, stems.length) }, () => runWorker()));
          }

          // Moments-first: if the user picked a moment region, load those slices into pads
          const picked = momentSlicesRef.current;
          if (picked) {
            const targetStem = stems.find(s => s.role === picked.role) ?? stems[0];
            if (targetStem) {
              setSlices(picked.slices);
              sliceCacheRef.current.set(targetStem.id, { bankId: picked.bankId, slices: picked.slices });
              targetStem.sliceBankId = picked.bankId;
              targetStem.sliceCount = picked.slices.length;
              setSelectedStemId(targetStem.id);
            }
          } else {
            // Auto-kit: create slice bank from drums stem and load best 16 to pads
            const drumsStem = stems.find(s => s.role === 'drums');
            if (drumsStem) {
              try {
                setLoadingStage('Creating drum kit...');
                const sliceBank = await api.createSliceBank(
                  sessionId,
                  drumsStem.path,
                  'drums',
                  sess.bpm || 120
                );
                if (sliceBank && sliceBank.slices.length > 0) {
                  // Select best 16 slices by transient strength + energy
                  const sorted = [...sliceBank.slices]
                    .sort((a, b) => (b.transient_strength + b.rms_energy) - (a.transient_strength + a.rms_energy))
                    .slice(0, 16);
                  
                  const mappedSlices = sorted.map((s: any, idx: number) => ({
                    index: idx,
                    startTime: s.start_time,
                    endTime: s.end_time,
                    duration: s.duration,
                    energy: s.rms_energy ?? 0.5,
                    transientStrength: s.transient_strength ?? 0.5,
                    brightness: (s.spectral_centroid ?? 0) / 20000,
                  }));
                  
                  setSlices(mappedSlices);
                  sliceCacheRef.current.set(drumsStem.id, { bankId: sliceBank.id, slices: mappedSlices });
                  drumsStem.sliceBankId = sliceBank.id;
                  drumsStem.sliceCount = mappedSlices.length;
                  setSelectedStemId(drumsStem.id);
                  console.log('[DAW] Auto-kit created:', mappedSlices.length, 'slices from drums');
                }
              } catch (e) {
                console.warn('[DAW] Auto-kit failed:', e);
              }
            }
          }
          
          setIsLoading(false);
          console.log('[DAWWorkspace] All stems loaded and ready!');
        }
        
        // Only separation failure is fatal - moments/peaks failures are non-blocking
        if (data.type === 'job.failed' && data.data) {
          const failedJobId = data.data.job_id || data.data.id;
          const failedJobType = (data.data.job_type || getKnownJobType(failedJobId)) as string | undefined;
          const normalizedType = typeof failedJobType === 'string' ? failedJobType.toLowerCase() : undefined;
          if (normalizedType === 'separation') {
            setError(data.data.error || 'Processing failed');
            setIsLoading(false);
            if (wsRef.current) {
              try {
                wsRef.current.close();
              } catch {
                // ignore
              }
              wsRef.current = null;
            }
            stopPolling();
          } else {
            console.warn(`[DAW] Non-fatal job failed: ${failedJobType}`, data.data.error);
          }
        }
        };
      };

      connectWebSocket();
      
    } catch (err: unknown) {
      console.error('Upload error:', err);
      // Show detailed error message
      let message = 'Upload failed';
      if (err instanceof Error) {
        message = err.message;
      }
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        message = axiosErr.response?.data?.detail || message;
      }
      setError(message);
      setIsLoading(false);
    }
  }, []);
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aiff'] },
    maxFiles: 1,
    disabled: isLoading,
  });
  
  // =============================================================================
  // STEM OPERATIONS
  // =============================================================================
  
  const toggleStemMute = useCallback((stemId: string) => {
    setSession(prev => {
      if (!prev) return prev;
      const newStems = prev.stems.map(s => 
        s.id === stemId ? { ...s, muted: !s.muted } : s
      );
      // Update audio in real-time
      const stem = newStems.find(s => s.id === stemId);
      const hasSolo = newStems.some(s => s.solo);
      if (stem) {
        const shouldMute = hasSolo ? !stem.solo : stem.muted;
        audioEngine.current.setStemVolume(stemId, stem.volume, shouldMute);
      }
      return { ...prev, stems: newStems };
    });
  }, []);
  
  const toggleStemSolo = useCallback((stemId: string) => {
    setSession(prev => {
      if (!prev) return prev;
      const newStems = prev.stems.map(s => 
        s.id === stemId ? { ...s, solo: !s.solo } : s
      );
      // Update ALL stems based on new solo state
      const hasSolo = newStems.some(s => s.solo);
      newStems.forEach(stem => {
        const shouldMute = hasSolo ? !stem.solo : stem.muted;
        audioEngine.current.setStemVolume(stem.id, stem.volume, shouldMute);
      });
      return { ...prev, stems: newStems };
    });
  }, []);
  
  // Disabled - UI simplified, volume sliders removed
  // const setStemVolume = useCallback((stemId: string, volume: number) => {
  //   setSession(prev => {
  //     if (!prev) return prev;
  //     const stem = prev.stems.find(s => s.id === stemId);
  //     if (stem) {
  //       audioEngine.current.setStemVolume(stemId, volume, stem.muted);
  //     }
  //     return {
  //       ...prev,
  //       stems: prev.stems.map(s => 
  //         s.id === stemId ? { ...s, volume } : s
  //       ),
  //     };
  //   });
  // }, []);
  
  // =============================================================================
  // RULE MANAGEMENT
  // =============================================================================
  
  const addRule = useCallback((rule: TriggerRule) => {
    setRules(prev => [...prev, rule]);
  }, []);
  
  const updateRule = useCallback((id: string, updates: Partial<TriggerRule>) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);
  
  const removeRule = useCallback((id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  }, []);
  
  // =============================================================================
  // TRANSPORT
  // =============================================================================
  
  const handlePlay = useCallback(() => {
    if (!session) return;
    
    audioEngine.current.bpm = bpm;

     // Start engine transport (for scheduling pattern playback)
     audioEngine.current.play();
    
    // Play all loaded stems with their volume/mute settings
    session.stems.forEach(stem => {
      if (stem.audioBuffer) {
        // Check if any stem has solo enabled
        const hasSolo = session.stems.some(s => s.solo);
        const shouldMute = hasSolo ? !stem.solo : stem.muted;
        
        audioEngine.current.playStem(stem.id, stem.audioBuffer, {
          volume: stem.volume,
          muted: shouldMute,
        });
      }
    });
    
    setIsPlaying(true);
    console.log('[DAWWorkspace] Playing all stems');
  }, [bpm, session]);
  
  const handleStop = useCallback(() => {
    audioEngine.current.stopAllStems();
    audioEngine.current.stop();
    audioEngine.current.clearSchedule();
    scheduledLoopIndexRef.current = -1;
    setIsPlaying(false);
    console.log('[DAWWorkspace] Stopped playback');
  }, []);
  
  const handleSeek = useCallback((beat: number) => {
    audioEngine.current.seek(beat);
    audioEngine.current.clearSchedule();
    scheduledLoopIndexRef.current = -1;
    setCurrentBeat(beat);
  }, []);
  
  const handleVolumeChange = useCallback((volume: number) => {
    setMasterVolume(volume);
    audioEngine.current.setMasterVolume(volume);
  }, []);
  
  // Update current beat during playback
  useEffect(() => {
    if (!isPlaying) return;

    let lastBeat = -1;
    const interval = setInterval(() => {
      const beat = audioEngine.current.getCurrentBeat();
      if (Math.abs(beat - lastBeat) > 0.02) {
        lastBeat = beat;
        setCurrentBeat(beat);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying]);

  // MPC pattern scheduling (looped) with rule engine + cross-stem routing
  useEffect(() => {
    if (!isPlaying || !session) return;

    const beatsPerBar = 4;
    const barsPerLoop = 4;
    const loopBeats = beatsPerBar * barsPerLoop;

    const stepsPerBeat = gridDivision / 4;
    const gridStepBeats = 1 / stepsPerBeat;

    const scheduleLookaheadLoops = 1;

    const interval = window.setInterval(() => {
      const nowBeat = audioEngine.current.getCurrentBeat();
      const currentLoopIndex = Math.floor(nowBeat / loopBeats);
      const targetLoopIndex = currentLoopIndex + scheduleLookaheadLoops;

      for (let loopIndex = scheduledLoopIndexRef.current + 1; loopIndex <= targetLoopIndex; loopIndex++) {
        const loopStartBeat = loopIndex * loopBeats;
        const allTriggers: Array<{
          time: number;
          sliceIndex: number;
          options: { velocity?: number; pitchShift?: number; reverse?: boolean };
          id: string;
        }> = [];

        for (const stem of session.stems) {
          const events = patternByStemRef.current[stem.id] ?? [];
          
          for (const ev of events) {
            const quantizedStepIndex = Math.round(ev.beat / gridStepBeats);
            const swingOffset = quantizedStepIndex % 2 === 1 ? swingAmount * (gridStepBeats * 0.5) : 0;
            const triggerBeat = loopStartBeat + ev.beat + ev.microOffset + swingOffset;

            const modified = ruleEngine.current.evaluate(
              rulesRef.current,
              stem.id,
              ev.sliceIndex,
              ev.velocity,
              triggerBeat,
              stem.role
            );

            if (!modified.skip) {
              allTriggers.push({
                time: triggerBeat,
                sliceIndex: modified.sliceIndex,
                options: {
                  velocity: modified.velocity,
                  pitchShift: modified.pitchShift,
                  reverse: modified.reverse,
                },
                id: `${stem.id}:${ev.id}`,
              });

              // DISABLED: doubleTrigger and cross-stem routing - too confusing for users
              // Enable these advanced features only when explicitly requested
              // if (modified.doubleTrigger) { ... }
              // const crossTriggers = crossStemRouter.current.evaluateRoutes(...);
            }
          }
        }

        if (momentRoutingEnabledRef.current && momentRoutesRef.current.length > 0) {
          momentStemRouter.current.setMaxSlices(16);
          for (const source of session.stems) {
            const moments = stemMomentsRef.current[source.id] ?? [];
            if (!moments.length) continue;
            const typeMask = stemMomentTypesRef.current[source.id] ?? { hit: true, phrase: true, texture: true, change: true };
            const filtered = moments.filter(m => (m.type === 'hit' && typeMask.hit) || (m.type === 'phrase' && typeMask.phrase) || (m.type === 'texture' && typeMask.texture) || (m.type === 'change' && typeMask.change));
            if (!filtered.length) continue;
            const maxPer = Math.max(0, Math.min(64, momentMaxPerLoopRef.current));
            const picked = [...filtered]
              .sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0))
              .slice(0, maxPer);

            for (let mi = 0; mi < picked.length; mi++) {
              const m = picked[mi];
              const rawBeat = audioEngine.current.secondsToBeats(m.start);
              const beatInLoop = ((rawBeat % loopBeats) + loopBeats) % loopBeats;
              const quantized = Math.round(beatInLoop / gridStepBeats) * gridStepBeats;
              const triggerBeat = loopStartBeat + quantized;
              const velocity = Math.max(0.2, Math.min(1, (m.energy ?? 0.5) * 0.8 + 0.2)) * Math.max(0.5, Math.min(1, m.confidence ?? 0.75));
              const momentIndexAsSlice = mi % 16;

              const routed = momentStemRouter.current.evaluateRoutes(
                momentRoutesRef.current,
                source.id,
                momentIndexAsSlice,
                velocity,
                triggerBeat
              );

              for (const ct of routed) {
                allTriggers.push({
                  time: ct.beat,
                  sliceIndex: ct.sliceIndex,
                  options: {
                    velocity: ct.velocity,
                    pitchShift: ct.pitchOffset,
                  },
                  id: `${ct.targetId}:moment:${Date.now()}`,
                });
              }
            }
          }
        }

        if (allTriggers.length > 0) {
          audioEngine.current.addToSchedule(allTriggers);
        }

        scheduledLoopIndexRef.current = loopIndex;
      }
    }, 50);

    return () => {
      clearInterval(interval);
    };
  }, [gridDivision, isPlaying, session, swingAmount]);

  const recordPadHit = useCallback((stemId: string, sliceIndex: number, velocity: number) => {
    const beatsPerBar = 4;
    const barsPerLoop = 4;
    const loopBeats = beatsPerBar * barsPerLoop;

    const stepsPerBeat = gridDivision / 4;
    const gridStepBeats = 1 / stepsPerBeat;

    const rawBeat = audioEngine.current.getCurrentBeat();
    const posInLoop = ((rawBeat % loopBeats) + loopBeats) % loopBeats;
    const quantized = Math.round(posInLoop / gridStepBeats) * gridStepBeats;
    const microOffset = posInLoop - quantized;

    const ev: PatternEvent = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      stemId,
      sliceIndex,
      beat: quantized,
      microOffset,
      velocity,
    };

    setPatternByStem(prev => {
      const existing = prev[stemId] ?? [];
      const next = isOverdubbing ? [...existing, ev] : [ev];
      return {
        ...prev,
        [stemId]: next,
      };
    });
  }, [gridDivision, isOverdubbing]);

  const handleSlicePlay = useCallback((index: number, velocity: number) => {
    console.log(`[SliceGrid] Play slice ${index} @ velocity ${velocity}`);
    if (!selectedStemId) return;

    // Highlight playing slice in waveform
    setPlayingSliceIndex(index);
    const slice = slices[index];
    const duration = slice ? Math.min(slice.duration * 1000, 500) : 300;
    setTimeout(() => setPlayingSliceIndex(null), duration);

    // Record pad hits when in Record Mode
    if (isRecording && isPlaying) {
      // Only record when sequencer is playing (space to start)
      recordPadHit(selectedStemId, index, velocity);
    }
  }, [isPlaying, isRecording, recordPadHit, selectedStemId, slices]);

  const handleSliceSelect = useCallback((index: number) => {
    console.log(`[SliceGrid] Selected slice ${index}`);
  }, []);

  const beatsPerBar = 4;
  const barsPerLoop = 4;
  const loopBeats = beatsPerBar * barsPerLoop;
  const stepsPerBeat = gridDivision / 4;
  const gridStepBeats = 1 / stepsPerBeat;
  const totalSteps = gridDivision * barsPerLoop;

  const selectedStemPattern = useMemo(
    () => (selectedStemId ? (patternByStem[selectedStemId] ?? []) : []),
    [patternByStem, selectedStemId]
  );

  const stepIndices = useMemo(() => Array.from({ length: totalSteps }, (_, i) => i), [totalSteps]);

  const stepIndexFromEvent = useCallback((ev: PatternEvent): number => {
    const rawStep = Math.round(ev.beat / gridStepBeats);
    const wrapped = ((rawStep % totalSteps) + totalSteps) % totalSteps;
    return wrapped;
  }, [gridStepBeats, totalSteps]);

  const selectedStemEventsByStep = useMemo(() => {
    const map = new Map<number, PatternEvent[]>();
    if (!selectedStemId) return map;
    for (const ev of selectedStemPattern) {
      const step = stepIndexFromEvent(ev);
      const existing = map.get(step);
      if (existing) existing.push(ev);
      else map.set(step, [ev]);
    }
    return map;
  }, [selectedStemId, selectedStemPattern, stepIndexFromEvent]);

  const updateSelectedStemPattern = useCallback((updater: (events: PatternEvent[]) => PatternEvent[]) => {
    if (!selectedStemId) return;
    setPatternByStem(prev => {
      const current = prev[selectedStemId] ?? [];
      return {
        ...prev,
        [selectedStemId]: updater(current),
      };
    });
  }, [selectedStemId]);

  const selectedEvents = useCallback((): PatternEvent[] => {
    if (!selectedStemId) return [];
    const events = patternByStem[selectedStemId] ?? [];
    return events.filter(e => selectedEventIds.has(e.id));
  }, [patternByStem, selectedEventIds, selectedStemId]);

  const clearSelection = useCallback(() => {
    setSelectedEventIds(new Set());
    setSelectionAnchorStep(null);
  }, []);

  const setSelectionBySteps = useCallback((steps: number[]) => {
    if (!selectedStemId) return;
    const stepSet = new Set(steps);
    const events = patternByStem[selectedStemId] ?? [];
    const ids = new Set<string>();
    for (const ev of events) {
      if (stepSet.has(stepIndexFromEvent(ev))) {
        ids.add(ev.id);
      }
    }
    setSelectedEventIds(ids);
  }, [patternByStem, selectedStemId, stepIndexFromEvent]);

  const moveSelectedByBeats = useCallback((deltaBeats: number) => {
    if (!selectedStemId) return;
    updateSelectedStemPattern((events) => {
      return events.map(ev => {
        if (!selectedEventIds.has(ev.id)) return ev;
        const nextBeat = Math.max(0, Math.min(loopBeats - gridStepBeats, ev.beat + deltaBeats));
        return { ...ev, beat: nextBeat };
      });
    });
  }, [gridStepBeats, loopBeats, selectedEventIds, selectedStemId, updateSelectedStemPattern]);

  const nudgeSelectedMicro = useCallback((deltaMicroBeats: number) => {
    if (!selectedStemId) return;
    updateSelectedStemPattern((events) => {
      return events.map(ev => {
        if (!selectedEventIds.has(ev.id)) return ev;
        const limit = gridStepBeats * 0.5;
        const next = Math.max(-limit, Math.min(limit, ev.microOffset + deltaMicroBeats));
        return { ...ev, microOffset: next };
      });
    });
  }, [gridStepBeats, selectedEventIds, selectedStemId, updateSelectedStemPattern]);

  const deleteSelected = useCallback(() => {
    if (!selectedStemId) return;
    updateSelectedStemPattern((events) => events.filter(ev => !selectedEventIds.has(ev.id)));
    clearSelection();
  }, [clearSelection, selectedEventIds, selectedStemId, updateSelectedStemPattern]);

  const copySelected = useCallback(() => {
    const evs = selectedEvents();
    if (evs.length === 0) return;
    const minBeat = Math.min(...evs.map(e => e.beat));
    setClipboard({ events: evs.map(e => ({ ...e })), minBeat });
  }, [selectedEvents]);

  const cutSelected = useCallback(() => {
    copySelected();
    deleteSelected();
  }, [copySelected, deleteSelected]);

  const pasteAtCursor = useCallback(() => {
    if (!selectedStemId) return;
    if (!clipboard || clipboard.events.length === 0) return;

    const cursorBeat = cursorStep * gridStepBeats;

    const pasted: PatternEvent[] = [];
    for (const ev of clipboard.events) {
      const rel = ev.beat - clipboard.minBeat;
      const nextBeat = cursorBeat + rel;
      if (nextBeat < 0 || nextBeat > loopBeats - gridStepBeats) continue;
      pasted.push({
        ...ev,
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        stemId: selectedStemId,
        beat: nextBeat,
      });
    }

    if (pasted.length === 0) return;

    updateSelectedStemPattern((events) => [...events, ...pasted]);
    setSelectedEventIds(new Set(pasted.map(e => e.id)));
  }, [clipboard, cursorStep, gridStepBeats, loopBeats, selectedStemId, updateSelectedStemPattern]);

  const duplicateSelectedByOneBar = useCallback(() => {
    if (!selectedStemId) return;
    const evs = selectedEvents();
    if (evs.length === 0) return;

    const oneBar = beatsPerBar;
    const pasted: PatternEvent[] = [];
    for (const ev of evs) {
      const nextBeat = ev.beat + oneBar;
      if (nextBeat > loopBeats - gridStepBeats) continue;
      pasted.push({
        ...ev,
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        stemId: selectedStemId,
        beat: nextBeat,
      });
    }

    if (pasted.length === 0) return;
    updateSelectedStemPattern((events) => [...events, ...pasted]);
    setSelectedEventIds(new Set(pasted.map(e => e.id)));
  }, [beatsPerBar, gridStepBeats, loopBeats, selectedEvents, selectedStemId, updateSelectedStemPattern]);

  // Clip editor keyboard shortcuts
  useEffect(() => {
    if (!isClipEditorFocused) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const isCmd = e.metaKey;

      if (isCmd && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelected();
        return;
      }
      if (isCmd && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        cutSelected();
        return;
      }
      if (isCmd && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteAtCursor();
        return;
      }
      if (isCmd && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelectedByOneBar();
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        clearSelection();
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.altKey) nudgeSelectedMicro(-gridStepBeats / 4);
        else moveSelectedByBeats(-gridStepBeats);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.altKey) nudgeSelectedMicro(gridStepBeats / 4);
        else moveSelectedByBeats(gridStepBeats);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clearSelection,
    copySelected,
    cutSelected,
    deleteSelected,
    duplicateSelectedByOneBar,
    gridStepBeats,
    isClipEditorFocused,
    moveSelectedByBeats,
    nudgeSelectedMicro,
    pasteAtCursor,
  ]);

  // Keyboard shortcuts help toggle (? key)
  useEffect(() => {
    const handleShortcutsKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '?' || (e.key === '/' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
      }
      if (e.key === 'Escape' && showShortcutsHelp) {
        setShowShortcutsHelp(false);
      }
    };
    window.addEventListener('keydown', handleShortcutsKey);
    return () => window.removeEventListener('keydown', handleShortcutsKey);
  }, [showShortcutsHelp]);
  
  // =============================================================================
  // CROSS-STEM ROUTING
  // =============================================================================
  
  const handleRouteAdd = useCallback((sourceId: string, targetId: string) => {
    setCrossRoutes(prev => [...prev, {
      sourceId,
      targetId,
      enabled: true,
      probability: 0.5,
      velocityScale: 1,
      sliceMode: 'random',
      pitchOffset: 0,
      timeOffset: 0,
    }]);
  }, []);
  
  const handleRouteChange = useCallback((sourceId: string, targetId: string, updates: Partial<CrossRoute>) => {
    setCrossRoutes(prev => prev.map(r => 
      r.sourceId === sourceId && r.targetId === targetId 
        ? { ...r, ...updates } 
        : r
    ));
  }, []);
  
  const handleRouteRemove = useCallback((sourceId: string, targetId: string) => {
    setCrossRoutes(prev => prev.filter(r => 
      !(r.sourceId === sourceId && r.targetId === targetId)
    ));
  }, []);

  const handleMomentRouteAdd = useCallback((sourceId: string, targetId: string) => {
    setMomentRoutes(prev => [...prev, {
      sourceId,
      targetId,
      enabled: true,
      probability: 0.5,
      velocityScale: 1,
      sliceMode: 'random',
      pitchOffset: 0,
      timeOffset: 0,
    }]);
  }, []);

  const handleMomentRouteChange = useCallback((sourceId: string, targetId: string, updates: Partial<CrossRoute>) => {
    setMomentRoutes(prev => prev.map(r => 
      r.sourceId === sourceId && r.targetId === targetId 
        ? { ...r, ...updates } 
        : r
    ));
  }, []);

  const handleMomentRouteRemove = useCallback((sourceId: string, targetId: string) => {
    setMomentRoutes(prev => prev.filter(r => 
      !(r.sourceId === sourceId && r.targetId === targetId)
    ));
  }, []);

  const ensureStemMomentDefaults = useCallback((stemId: string) => {
    setStemMomentBias(prev => (prev[stemId] ? prev : { ...prev, [stemId]: 'balanced' }));
    setStemMomentTypes(prev => {
      if (prev[stemId]) return prev;
      return {
        ...prev,
        [stemId]: { hit: true, phrase: true, texture: true, change: true },
      };
    });
  }, []);

  const detectMomentsForStem = useCallback(async (stem: Stem) => {
    ensureStemMomentDefaults(stem.id);
    const bias = stemMomentBias[stem.id] ?? 'balanced';
    setDetectingStemMoments(prev => ({ ...prev, [stem.id]: true }));
    try {
      const res = await api.detectMoments(stem.path, bias);
      const mapped: StemMoment[] = (res.moments || []).map((m: any) => ({
        type: m.type,
        start: m.start_time,
        end: m.end_time,
        confidence: m.confidence ?? 0.5,
        energy: m.energy ?? 0.5,
        brightness: m.brightness ?? 0.5,
        label: m.label ?? m.type,
      }));
      setStemMoments(prev => ({ ...prev, [stem.id]: mapped }));
    } catch (e) {
      // ignore
    } finally {
      setDetectingStemMoments(prev => ({ ...prev, [stem.id]: false }));
    }
  }, [ensureStemMomentDefaults, stemMomentBias]);
  
  // =============================================================================
  // EUCLIDEAN PATTERN
  // =============================================================================
  
  useEffect(() => {
    const pattern = generateEuclidean(euclideanSteps, euclideanPulses, euclideanRotation);
    setEuclideanPattern(pattern.pattern);
  }, [euclideanSteps, euclideanPulses, euclideanRotation]);
  
  // =============================================================================
  // KEYBOARD SHORTCUTS
  // =============================================================================
  
  const handleTogglePlay = useCallback(() => {
    if (isPlaying) handleStop();
    else handlePlay();
  }, [isPlaying, handlePlay, handleStop]);
  
  // Sync ref for keyboard handler
  useEffect(() => {
    handleTogglePlayRef.current = handleTogglePlay;
  }, [handleTogglePlay]);
  
  // Helper to find stem by role
  const findStemByRole = useCallback((role: string) => {
    return session?.stems.find(s => s.role === role);
  }, [session]);
  
  // Comprehensive DAW keyboard shortcuts
  useKeyboardShortcuts(createDAWShortcuts({
    // Transport
    play: handleTogglePlay,
    stop: handleStop,
    rewind: () => handleSeek(0),
    
    // Stem mute shortcuts (1-4)
    muteDrums: () => { const s = findStemByRole('drums'); if (s) toggleStemMute(s.id); },
    muteBass: () => { const s = findStemByRole('bass'); if (s) toggleStemMute(s.id); },
    muteVocals: () => { const s = findStemByRole('vocals'); if (s) toggleStemMute(s.id); },
    muteOther: () => { const s = findStemByRole('other'); if (s) toggleStemMute(s.id); },
    
    // Stem solo shortcuts (Shift+1-4)
    soloDrums: () => { const s = findStemByRole('drums'); if (s) toggleStemSolo(s.id); },
    soloBass: () => { const s = findStemByRole('bass'); if (s) toggleStemSolo(s.id); },
    soloVocals: () => { const s = findStemByRole('vocals'); if (s) toggleStemSolo(s.id); },
    soloOther: () => { const s = findStemByRole('other'); if (s) toggleStemSolo(s.id); },
    
    // Tempo tap
    tempoTap: () => {
      // Tap tempo logic handled in TransportBar, but keyboard trigger here
      const tapEvent = new CustomEvent('tapTempo');
      window.dispatchEvent(tapEvent);
    },
    
    // View toggles
    zoomIn: () => setZoom(prev => Math.min(prev * 1.25, 4)),
    zoomOut: () => setZoom(prev => Math.max(prev / 1.25, 0.25)),
    
    // Navigation
    nudgeLeft: () => setCurrentBeat(prev => Math.max(0, prev - 0.25)),
    nudgeRight: () => setCurrentBeat(prev => prev + 0.25),
  }));
  
  // Create/load a real slice bank when a stem is selected
  // Protect current stem's bank from eviction when selected
  useEffect(() => {
    if (selectedStemId) {
      audioEngine.current.protectBank(selectedStemId);
    }
    return () => {
      if (selectedStemId) {
        audioEngine.current.unprotectBank(selectedStemId);
      }
    };
  }, [selectedStemId]);
  
  // Create/load a real slice bank when a stem is selected
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!session || !selectedStemId) return;
      const stem = session.stems.find(s => s.id === selectedStemId);
      if (!stem) return;

      // Fast path: use cached slices if we already created/loaded them for this stem
      const cached = sliceCacheRef.current.get(stem.id);
      if (cached) {
        setSlices(cached.slices);
        const maybeMoment = momentSlicesRef.current;
        const useRaw = !!(maybeMoment && maybeMoment.bankId === cached.bankId && rawPreviewUrlRef.current);
        const stemUrl = useRaw ? rawPreviewUrlRef.current! : buildFileUrl(stem.path);
        await audioEngine.current.loadSliceBank(
          stem.id,
          stemUrl,
          cached.slices.map(s => ({ startTime: s.startTime, endTime: s.endTime }))
        );
        return;
      }

      // Reset while loading
      setSlices([]);

      // Create bank only once per stem; if already created, fetch it
      try {
        const bank = stem.sliceBankId
          ? await api.getSliceBank(session.id, stem.sliceBankId)
          : await api.createSliceBank(session.id, stem.path, stem.role, bpm, session.key);

        if (cancelled) return;

        const mappedSlices: Slice[] = (bank.slices || []).map((s: any) => ({
          index: s.index,
          startTime: s.start_time,
          endTime: s.end_time,
          duration: s.duration,
          energy: s.rms_energy,
          transientStrength: s.transient_strength,
          brightness: (s.spectral_centroid ?? 0) / 20000,
        }));

        setSlices(mappedSlices);
        sliceCacheRef.current.set(stem.id, { bankId: bank.id, slices: mappedSlices });

        // Attach bank id to stem + load slices into audio engine (bankId == stemId)
        // IMPORTANT: SliceGrid triggers via stemId; our engine uses bankId as key.
        const stemUrl = buildFileUrl(stem.path);
        await audioEngine.current.loadSliceBank(
          stem.id,
          stemUrl,
          mappedSlices.map(s => ({ startTime: s.startTime, endTime: s.endTime }))
        );

        if (cancelled) return;
        setSession(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            stems: prev.stems.map(st => st.id === stem.id ? {
              ...st,
              sliceBankId: bank.id,
              sliceCount: mappedSlices.length,
            } : st),
          };
        });
      } catch (e) {
        if (cancelled) return;
        console.warn('[DAWWorkspace] Failed to create/load slice bank', e);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [session, selectedStemId, bpm, buildFileUrl]);
  
  // =============================================================================
  // RENDER
  // =============================================================================
  
  const selectedStem = session?.stems.find(s => s.id === selectedStemId);
  
  // Upload screen
  if (!session && !isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-8">
        <div>
          <div 
            {...getRootProps()}
            className={`
              w-full max-w-2xl aspect-video rounded-2xl border-2 border-dashed
              flex flex-col items-center justify-center gap-6 cursor-pointer
              transition-all duration-300
              ${isDragActive 
                ? 'border-blue-500 bg-blue-500/10 scale-102' 
                : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50'
              }
            `}
          >
            <input {...getInputProps()} />
            
            <div className={`p-6 rounded-full transition-colors ${
              isDragActive ? 'bg-blue-500/20' : 'bg-zinc-800'
            }`}>
              <Upload className={`w-12 h-12 ${isDragActive ? 'text-blue-400' : 'text-zinc-400'}`} />
            </div>
            
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-white mb-2">
                Drop your audio file
              </h2>
              <p className="text-zinc-500">
                MP3, WAV, FLAC, M4A, OGG, or AIFF
              </p>
            </div>
            
            <div className="flex items-center gap-6 text-xs text-zinc-600">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                <span>AI Stem Separation</span>
              </div>
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4" />
                <span>Transient Detection</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span>Generative Sequencing</span>
              </div>
            </div>
          </div>

          <label className="mt-4 flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={fastPreviewMode}
                onChange={(e) => setFastPreviewMode(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-700 rounded-full peer-checked:bg-blue-600 transition-colors" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
            </div>
            <div className="text-sm text-zinc-400 group-hover:text-zinc-300">
              <span className="font-medium">Fast Preview</span>
              <span className="text-xs text-zinc-500 ml-2">(first 30s only - instant jamming)</span>
            </div>
          </label>

          {error && (
            <div className="mt-6 px-4 py-3 bg-red-900/40 border border-red-700/60 rounded-lg text-sm text-red-200 flex items-start justify-between gap-3">
              <div>{error}</div>
              <button onClick={() => setError(null)} className="text-red-300 hover:text-white">×</button>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Loading screen
  if (isLoading) {
    const handleCancelProcessing = async () => {
      try {
        // Close WS immediately to stop UI churn
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        if (wsReconnectTimerRef.current) {
          window.clearTimeout(wsReconnectTimerRef.current);
          wsReconnectTimerRef.current = null;
        }
        wsReconnectAttemptsRef.current = 0;
        // Stop polling
        if (pollTimerRef.current) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        // Cancel any jobs we know about
        const jobsToCancel = processingJobsRef.current || [];
        await Promise.allSettled(jobsToCancel.map(j => api.cancelJob(j.id)));
      } catch {
        // ignore
      } finally {
        // Reset to upload screen
        setRawPreviewUrl(null);
        setRawSourcePath(null);
        setProcessingSessionId(null);
        processingJobsRef.current = [];
        setLoadingProgress(0);
        setLoadingStage('');
        setMomentSlices(null);
        setSelectedMomentIndex(null);
        setMomentSlicesError(null);
        setIsLoading(false);
      }
    };

    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="w-full max-w-md">
          {fastPreviewMode && (
            <div className="mb-4 px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-lg text-xs text-amber-300 flex items-center gap-2">
              <Zap className="w-3 h-3" />
              <span>Fast Preview Mode — processing first 30 seconds only</span>
            </div>
          )}

          <div className="flex items-center justify-center gap-4 mb-8">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-zinc-800 rounded-full" />
              <div 
                className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-blue-500 rounded-full animate-spin"
              />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">{loadingStage}</h2>
              <p className="text-sm text-zinc-500">{Math.round(loadingProgress)}% complete</p>
            </div>
          </div>
          
          <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>

          {/* Instant raw preview while processing */}
          {rawPreviewUrl && processingSessionId && (
            <div className="mt-6 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
              <div className="text-xs text-zinc-400 mb-2">Preview (raw upload)</div>
              <PeaksWaveform
                audioUrl={rawPreviewUrl}
                peaksUrl={api.getSourcePeaksUrl(processingSessionId)}
                regions={previewRegions}
                onReady={(peaks) => {
                  peaksPreviewRef.current = peaks;
                }}
                height={80}
                zoomviewHeight={80}
                overviewHeight={40}
                theme={{
                  waveformColor: '#3b82f6',
                  playedWaveformColor: '#60a5fa',
                  playheadColor: '#ffffff',
                  overviewWaveformColor: '#27272a',
                  overviewPlayedWaveformColor: '#3f3f46',
                }}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-[11px] text-zinc-500">
                  Space: audition | Enter: send to pads | 1-4/Q-R/A-F/Z-V: pads
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[10px] text-zinc-500">Preview vol</div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={previewVolume}
                    onChange={(e) => setPreviewVolume(Number(e.target.value))}
                    className="w-24"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Moments detected - show for instant navigation */}
          {momentsReady && detectedMoments.length > 0 && (
            <div className="mt-4 p-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
              <div className="text-xs text-zinc-400 mb-2 flex items-center gap-2">
                <Activity className="w-3 h-3" />
                <span>{detectedMoments.length} moments detected</span>
              </div>
              <div className="text-[10px] text-zinc-500 mb-2">
                Click to select. Space auditions. Enter sends the selection to pads.
              </div>
              <div className="flex flex-wrap gap-1">
                {visibleMomentIndices.map((idx) => {
                  const m = detectedMoments[idx];
                  const isSelected = selectedMomentIndex === idx;
                  const colorClasses = {
                    hit: isSelected 
                      ? 'bg-red-500/40 text-red-300 ring-1 ring-red-400' 
                      : 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
                    phrase: isSelected 
                      ? 'bg-blue-500/40 text-blue-300 ring-1 ring-blue-400' 
                      : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30',
                    texture: isSelected 
                      ? 'bg-purple-500/40 text-purple-300 ring-1 ring-purple-400' 
                      : 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30',
                    change: isSelected 
                      ? 'bg-yellow-500/40 text-yellow-300 ring-1 ring-yellow-400' 
                      : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30',
                  };
                  return (
                    <button
                      key={idx}
                      disabled={!processingSessionId || !rawSourcePath || isCreatingMomentSlices}
                      onClick={() => setSelectedMomentIndex(idx)}
                      className={`px-2 py-0.5 text-[10px] rounded transition-all ${
                        colorClasses[m.type as keyof typeof colorClasses] || colorClasses.change
                      }`}
                    >
                      {m.type} {m.start.toFixed(1)}s ({(m.end - m.start).toFixed(1)}s) {isSelected && '✓'}
                    </button>
                  );
                })}
                {detectedMoments.length > visibleMomentIndices.length && (
                  <span className="px-2 py-0.5 text-[10px] text-zinc-500">
                    {visibleMomentIndices[0] > 0 ? `+${visibleMomentIndices[0]} before` : ''}
                    {visibleMomentIndices[0] > 0 && visibleMomentIndices[visibleMomentIndices.length - 1] < detectedMoments.length - 1 ? ' · ' : ''}
                    {visibleMomentIndices[visibleMomentIndices.length - 1] < detectedMoments.length - 1 ? `+${detectedMoments.length - 1 - visibleMomentIndices[visibleMomentIndices.length - 1]} after` : ''}
                  </span>
                )}
              </div>

              {selectedMoment && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] text-zinc-500">
                    Selected: {selectedMoment.label || selectedMoment.type} ({selectedMoment.start.toFixed(1)}s - {selectedMoment.end.toFixed(1)}s)
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={!rawPreviewUrl || isCreatingMomentSlices}
                      onClick={() => {
                        if (isAuditioningPreview) stopPreviewAudio();
                        else auditionSelectedMoment();
                      }}
                      className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1"
                    >
                      {isAuditioningPreview ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      {isAuditioningPreview ? 'Stop' : 'Audition'}
                    </button>
                    <button
                      disabled={!processingSessionId || !rawSourcePath || isCreatingMomentSlices}
                      onClick={sliceSelectedMoment}
                      className="px-2 py-1 text-[11px] rounded bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 flex items-center gap-1"
                    >
                      <Square className="w-3 h-3" />
                      Send to Pads
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-2 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={loopSelectedMoment}
                    onChange={(e) => setLoopSelectedMoment(e.target.checked)}
                    className="accent-amber-500"
                  />
                  <div className="text-[11px] text-zinc-400 flex items-center gap-1">
                    <Repeat className="w-3 h-3" />
                    Loop moment
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={quantizePreviewPads}
                    onChange={(e) => setQuantizePreviewPads(e.target.checked)}
                    className="accent-blue-500"
                  />
                  <div className="text-[11px] text-zinc-400 flex items-center gap-1">
                    <Timer className="w-3 h-3" />
                    Quantize pads
                  </div>
                </label>
              </div>

              <div className="mt-3">
                {isCreatingMomentSlices && (
                  <div className="text-[11px] text-zinc-500">Slicing moment...</div>
                )}
                {momentSlicesError && (
                  <div className="text-[11px] text-red-400">{momentSlicesError}</div>
                )}
                {momentSlices && !isCreatingMomentSlices && (
                  <div className="text-[11px] text-zinc-400">
                    Ready: {momentSlices.slices.length} slices from {momentSlices.role} ({momentSlices.startTime.toFixed(1)}s - {momentSlices.endTime.toFixed(1)}s)
                  </div>
                )}
              </div>

              {momentSlices && (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {Array.from({ length: 16 }).map((_, idx) => {
                    const slice = momentSlices.slices[idx];
                    const isActive = playingPreviewPads.has(idx);
                    return (
                      <button
                        key={idx}
                        disabled={!slice}
                        onMouseDown={(e) => {
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          const y = e.clientY - rect.top;
                          const vel = 0.3 + (1 - y / rect.height) * 0.7;
                          triggerPreviewPadMaybeQuantized(idx, vel);
                        }}
                        className={`h-10 rounded border text-xs transition-all ${
                          !slice
                            ? 'border-zinc-800 bg-zinc-900/40 text-zinc-700'
                            : isActive
                              ? 'border-amber-400 bg-amber-500/30 text-amber-200'
                              : 'border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-200'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Cancel controls */}
          {processingSessionId && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleCancelProcessing}
                className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
              >
                Cancel Processing
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Main workspace
  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-white overflow-hidden">
      {/* Transport Bar */}
      <TransportBar
        bpm={bpm}
        isPlaying={isPlaying}
        currentBeat={currentBeat}
        masterVolume={masterVolume}
        onBpmChange={setBpm}
        onPlay={handlePlay}
        onStop={handleStop}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
      />
      
      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Stem mixer */}
        <div className={`flex flex-col border-r border-zinc-800 bg-zinc-900/50 transition-all ${
          leftPanelCollapsed ? 'w-12' : 'w-64'
        }`}>
          <div className="flex items-center justify-between p-3 border-b border-zinc-800">
            {!leftPanelCollapsed && (
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Stems
              </span>
            )}
            <button
              onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
              className="p-1 hover:bg-zinc-800 rounded"
            >
              {leftPanelCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          {/* START SKETCH - Instant Gratification Button */}
          {!leftPanelCollapsed && session && session.stems.length > 0 && (
            <button
              onClick={async () => {
                // Auto-select drums (or first stem with slices)
                const drumStem = session.stems.find(s => s.role === 'drums') ?? session.stems[0];
                if (drumStem) {
                  setSelectedStemId(drumStem.id);
                  
                  // If no slices yet, create slice bank first
                  const cached = sliceCacheRef.current.get(drumStem.id);
                  if (!cached && drumStem.path) {
                    try {
                      const sliceBank = await api.createSliceBank(
                        session.id,
                        drumStem.path,
                        drumStem.role || 'drums',
                        bpm
                      );
                      if (sliceBank && sliceBank.slices.length > 0) {
                        const sorted = [...sliceBank.slices]
                          .sort((a, b) => (b.transient_strength + b.rms_energy) - (a.transient_strength + a.rms_energy))
                          .slice(0, 16);
                        const mappedSlices = sorted.map((s: any, idx: number) => ({
                          index: idx,
                          startTime: s.start_time,
                          endTime: s.end_time,
                          duration: s.duration,
                          energy: s.rms_energy ?? 0.5,
                          transientStrength: s.transient_strength ?? 0.5,
                          brightness: (s.spectral_centroid ?? 0) / 20000,
                        }));
                        setSlices(mappedSlices);
                        sliceCacheRef.current.set(drumStem.id, { bankId: sliceBank.id, slices: mappedSlices });
                      }
                    } catch (e) {
                      console.warn('[StartSketch] Failed to create slices:', e);
                    }
                  } else if (cached) {
                    setSlices(cached.slices);
                  }
                }
                // Just arm recording - don't auto-play stems
                setIsRecording(true);
                // User will tap pads to trigger sounds, space to start sequencer
              }}
              className="mx-2 my-2 px-4 py-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-bold rounded-lg shadow-lg shadow-red-500/20 transition-all flex flex-col items-center justify-center gap-1"
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-white animate-pulse" />
                <span>Record Mode</span>
              </div>
              <span className="text-[10px] font-normal opacity-80">Arm • then tap pads to jam</span>
            </button>
          )}
          
          {/* Hint to click stems */}
          {!selectedStemId && session?.stems && session.stems.length > 0 && (
            <div className="mx-2 mb-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-xs text-center animate-pulse">
              👆 Click a stem below to load slices
            </div>
          )}
          
          <div className="flex-1 overflow-y-auto p-2">
            {session?.stems.map((stem) => (
              <div
                key={stem.id}
                onClick={() => setSelectedStemId(stem.id)}
                className={`
                  mb-2 rounded-lg border cursor-pointer transition-all
                  ${stem.id === selectedStemId ? 'ring-2 ring-blue-500' : ''}
                  ${getStemColor(stem.role)}
                `}
              >
                {leftPanelCollapsed ? (
                  <div className="p-2 flex justify-center">
                    {getStemIcon(stem.role)}
                  </div>
                ) : (
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getStemIcon(stem.role)}
                        <span className="text-sm font-medium capitalize">{stem.role}</span>
                      </div>
                      {/* Simple mute button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleStemMute(stem.id); }}
                        className={`px-2 py-1 text-[10px] font-semibold rounded transition-colors ${
                          stem.muted 
                            ? 'bg-red-500/30 text-red-400' 
                            : 'bg-zinc-800/50 text-zinc-500 hover:text-white'
                        }`}
                      >
                        {stem.muted ? 'MUTED' : 'M'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Center panel - Waveform & Grid */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Waveform */}
          <div className="h-32 border-b border-zinc-800">
            {selectedStem ? (
              <WaveformCanvas
                audioBuffer={selectedStem.audioBuffer}
                slices={slices}
                playheadPosition={0}
                zoom={zoom}
                playingSliceIndex={playingSliceIndex ?? undefined}
                className="w-full h-full"
                colorScheme="neon"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">👈</span>
                  <span>Click a stem on the left (Drums, Bass, Vocals, Other)</span>
                </div>
                <span className="text-xs text-zinc-600">This loads slices into the pads below</span>
              </div>
            )}
          </div>

          {/* Moments Timeline (Octatrack-style) */}
          {selectedStem && session && (
            <MomentsTimeline
              sessionId={session.id}
              audioPath={selectedStem.path}
              duration={session.duration_seconds ?? 60}
              initialMoments={momentsReady ? detectedMoments.map((m, i) => ({
                id: `m-${i}`,
                type: m.type as 'hit' | 'phrase' | 'texture' | 'change',
                start_time: m.start,
                end_time: m.end,
                duration: m.end - m.start,
                energy: 0.5,
                brightness: 0.5,
                label: m.label,
                confidence: m.confidence,
              })) : undefined}
              onRegionSlicesCreated={async (bankId, newSlices) => {
                console.log('[DAW] Region slices created:', bankId, newSlices.length);
                const mappedSlices = newSlices.map((s: any) => ({
                  index: s.index,
                  startTime: s.start_time,
                  endTime: s.end_time,
                  duration: s.duration,
                  energy: s.rms_energy ?? 0.5,
                  transientStrength: s.transient_strength ?? 0.5,
                  brightness: (s.spectral_centroid ?? 0) / 20000,
                }));
                
                // Update UI immediately
                setSlices(mappedSlices);
                sliceCacheRef.current.set(selectedStem.id, { bankId, slices: mappedSlices });
                
                // Load into audio engine so pads work immediately
                const stemUrl = buildFileUrl(selectedStem.path);
                audioEngine.current.protectBank(selectedStem.id);
                await audioEngine.current.loadSliceBank(
                  selectedStem.id,
                  stemUrl,
                  mappedSlices.map(s => ({ startTime: s.startTime, endTime: s.endTime }))
                );
                console.log('[DAW] Slices loaded into audio engine, ready to play!');
              }}
              className="border-b border-zinc-800"
            />
          )}
          
          {/* Slice grid header with probability toggle */}
          <div className="flex items-center justify-between px-4 pt-2 pb-1">
            <span className="text-[10px] text-zinc-500 uppercase">Slices</span>
            <button
              onClick={() => setShowProbabilities(v => !v)}
              className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                showProbabilities 
                  ? 'bg-cyan-600 text-white' 
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {showProbabilities ? 'Probabilities ON' : 'Probabilities'}
            </button>
          </div>
          
          {/* Slice grid */}
          <div className="flex-1 p-4 pt-1 overflow-auto relative">
            {selectedStem && slices.length > 0 ? (
              <SliceGrid
                slices={slices}
                stemId={selectedStemId!}
                stemRole={selectedStem.role}
                columns={8}
                onSlicePlay={handleSlicePlay}
                onSliceSelect={handleSliceSelect}
                sliceProbabilities={selectedStemId ? sliceProbabilities[selectedStemId] : undefined}
                onProbabilityChange={(index, prob) => {
                  if (!selectedStemId) return;
                  setSliceProbabilities(prev => {
                    const current = prev[selectedStemId] ?? Array(slices.length).fill(1);
                    const updated = [...current];
                    updated[index] = prob;
                    return { ...prev, [selectedStemId]: updated };
                  });
                }}
                showProbabilities={showProbabilities}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-600">
                <div className="text-center">
                  <div className="text-4xl mb-2">🎹</div>
                  {selectedStem ? (
                    <>
                      <div className="text-sm text-amber-400">Loading slices for {selectedStem.role}...</div>
                      <div className="text-xs text-zinc-600 mt-2">
                        Or use <span className="text-cyan-400">MOMENTS</span> above: click a phrase → Send to Pads
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm">👈 Click a stem on the left first</div>
                      <div className="text-xs text-zinc-700 mt-1">
                        Then use keyboard 1-8, Q-I, A-K, Z-M to play pads
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            
            {/* Play state indicator + workflow hint */}
            {slices.length > 0 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
                {/* Pattern hit counter */}
                {selectedStemPattern.length > 0 && (
                  <div className="bg-amber-500/20 border border-amber-500/50 px-3 py-1 rounded-full flex items-center gap-2">
                    <span className="text-amber-400 text-xs font-medium">
                      {selectedStemPattern.length} hit{selectedStemPattern.length !== 1 ? 's' : ''} recorded
                    </span>
                    <button
                      onClick={() => {
                        if (selectedStemId) {
                          setPatternByStem(prev => ({ ...prev, [selectedStemId]: [] }));
                        }
                      }}
                      className="text-amber-400/70 hover:text-amber-300 text-xs underline"
                    >
                      Clear
                    </button>
                  </div>
                )}
                {/* Big play state */}
                {isPlaying && isRecording && (
                  <div className="bg-red-500/20 border border-red-500/50 px-4 py-2 rounded-lg flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-red-400 font-semibold text-sm">RECORDING</span>
                    <span className="text-red-400/70 text-xs">Tap pads → hits quantize to grid</span>
                  </div>
                )}
                {!isPlaying && isRecording && (
                  <div className="bg-amber-500/20 border border-amber-500/50 px-4 py-2 rounded-lg flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-amber-400 font-semibold text-sm">ARMED</span>
                    <span className="text-amber-400/70 text-xs">Tap pads to jam • Space to record into pattern</span>
                  </div>
                )}
                {isPlaying && !isRecording && (
                  <div className="bg-green-500/20 border border-green-500/50 px-4 py-2 rounded-lg flex items-center gap-2 animate-pulse">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-green-400 font-semibold text-sm">PLAYING</span>
                    <span className="text-green-400/70 text-xs">Press Space to stop</span>
                  </div>
                )}
                {/* Simple hints when not playing */}
                {!isPlaying && !isRecording && (
                  <div className="bg-zinc-800/90 px-4 py-2 rounded-full text-xs text-zinc-400 flex items-center gap-3 border border-zinc-700">
                    <span><strong className="text-white">1.</strong> Click <strong className="text-red-400">Record Mode</strong></span>
                    <span className="text-zinc-600">→</span>
                    <span><strong className="text-white">2.</strong> Tap pads to jam (free play)</span>
                    <span className="text-zinc-600">→</span>
                    <span><strong className="text-white">3.</strong> Space to play</span>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Spectrum analyzer */}
          <div className="h-24 border-t border-zinc-800">
            <SpectrumAnalyzer
              className="w-full h-full"
              mode="bars"
              barCount={64}
              colorScheme="spectrum"
            />
          </div>
        </div>
        
        {/* Right panel - CONTEXTUAL controls (shows what's relevant) */}
        <div className={`flex flex-col border-l border-zinc-800 bg-zinc-900/50 transition-all ${
          rightPanelCollapsed ? 'w-12' : 'w-72'
        }`}>
          <div className="flex items-center justify-between p-3 border-b border-zinc-800">
            <button
              onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
              className="p-1 hover:bg-zinc-800 rounded"
              title={rightPanelCollapsed ? "Expand" : "Collapse"}
            >
              {rightPanelCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
          
          {!rightPanelCollapsed && (
            <div className="flex-1 overflow-y-auto">
              
              {/* ESSENTIAL: Key + BPM (always visible) */}
              <div className="p-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <select
                    value={session?.key || 'C'}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm"
                  >
                    {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={bpm}
                    onChange={(e) => setBpm(Number(e.target.value))}
                    className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center"
                  />
                  <span className="text-xs text-zinc-500">BPM</span>
                </div>
              </div>

              {/* CONTEXTUAL: Only show when a stem is selected */}
              {selectedStemId && (() => {
                const stem = session?.stems.find(s => s.id === selectedStemId);
                return (
                <div className="p-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-2 h-2 rounded-full ${
                      stem?.role === 'drums' ? 'bg-orange-500' :
                      stem?.role === 'bass' ? 'bg-blue-500' :
                      stem?.role === 'vocals' ? 'bg-purple-500' :
                      'bg-emerald-500'
                    }`} />
                    <span className="text-sm font-medium capitalize">{stem?.role || 'Stem'}</span>
                    <span className="text-xs text-zinc-500 ml-auto">
                      {selectedStemPattern.length} hits
                    </span>
                  </div>
                  
                  {/* Pad bank selector - compact */}
                  <div className="flex gap-1 mb-3">
                    {(['A', 'B', 'C', 'D'] as const).map((page) => (
                      <button
                        key={page}
                        onClick={() => setPadPage(page)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded ${
                          padPage === page ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                </div>
              );})()}

              {/* CONTEXTUAL: Pattern controls - only when recording or has hits */}
              {(isRecording || selectedStemPattern.length > 0) && (
                <div className="p-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2 mb-3">
                    <Drum className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-xs font-semibold text-zinc-300 uppercase">Pattern</span>
                  </div>
                  
                  {/* Feel presets - single row */}
                  <div className="flex gap-1 mb-3">
                    {(Object.keys(FEEL_PRESETS) as FeelPreset[]).map((preset) => (
                      <button
                        key={preset}
                        onClick={() => { setFeelPreset(preset); setSwingAmount(FEEL_PRESETS[preset].swing); }}
                        className={`flex-1 py-1 text-[10px] rounded ${
                          feelPreset === preset ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {FEEL_PRESETS[preset].label}
                      </button>
                    ))}
                  </div>
                  
                  {/* Grid */}
                  <div className="flex gap-2 mb-3">
                    <button onClick={() => setGridDivision(32)} className={`flex-1 py-1 text-xs rounded ${gridDivision === 32 ? 'bg-zinc-700' : 'bg-zinc-900 text-zinc-500'}`}>1/32</button>
                    <button onClick={() => setGridDivision(64)} className={`flex-1 py-1 text-xs rounded ${gridDivision === 64 ? 'bg-zinc-700' : 'bg-zinc-900 text-zinc-500'}`}>1/64</button>
                  </div>
                  
                  {/* Actions */}
                  {selectedStemPattern.length > 0 && (
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!session || !selectedStemId) return;
                          setIsBouncing(true);
                          try {
                            await api.bounceAndSlice({
                              sessionId: session.id, stemId: selectedStemId,
                              patternEvents: selectedStemPattern.map(e => ({ beat: e.beat, sliceIndex: e.sliceIndex, velocity: e.velocity, microOffset: e.microOffset })),
                              bpm, bars: 4, swing: swingAmount,
                            });
                          } finally { setIsBouncing(false); }
                        }}
                        disabled={isBouncing}
                        className="flex-1 py-2 text-xs bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 text-white rounded"
                      >
                        {isBouncing ? 'Bouncing...' : 'Bounce'}
                      </button>
                      <button
                        onClick={() => selectedStemId && setPatternByStem(prev => ({ ...prev, [selectedStemId]: [] }))}
                        className="px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 🥁 PATTERN RECORDER - MPC-style beat making */}
              <div className="p-3 bg-zinc-800/40 rounded-lg border border-zinc-700/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Drum className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] font-semibold text-zinc-300 uppercase">Pattern</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        if (!session || !selectedStemId) return;
                        const events = patternByStem[selectedStemId] ?? [];
                        if (events.length === 0) return;
                        
                        setIsBouncing(true);
                        try {
                          const result = await api.bounceAndSlice({
                            sessionId: session.id,
                            stemId: selectedStemId,
                            patternEvents: events.map(e => ({
                              beat: e.beat,
                              sliceIndex: e.sliceIndex,
                              velocity: e.velocity,
                              microOffset: e.microOffset,
                            })),
                            bpm,
                            bars: 4,
                            swing: swingAmount,
                          });
                          console.log('[DAW] Bounced:', result);
                          if (result.slice_bank) {
                            const mappedSlices = result.slice_bank.slices.map((s: any) => ({
                              index: s.index,
                              startTime: s.start_time,
                              endTime: s.end_time,
                              duration: s.duration,
                              energy: s.rms_energy ?? 0.5,
                              transientStrength: s.transient_strength ?? 0.5,
                              brightness: (s.spectral_centroid ?? 0) / 20000,
                            }));
                            setSlices(mappedSlices);
                          }
                        } catch (e) {
                          console.error('[DAW] Bounce failed:', e);
                        } finally {
                          setIsBouncing(false);
                        }
                      }}
                      disabled={!selectedStemId || isBouncing}
                      className="text-[10px] px-2 py-1 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded transition-all"
                    >
                      {isBouncing ? 'Bouncing...' : 'Bounce'}
                    </button>
                    <button
                      onClick={() => {
                        if (selectedStemId) {
                          setPatternByStem(prev => ({ ...prev, [selectedStemId]: [] }));
                        }
                      }}
                      className="text-[10px] text-zinc-500 hover:text-zinc-200"
                      disabled={!selectedStemId}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => setIsRecording(v => !v)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                      isRecording ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isRecording ? 'Recording' : 'Record'}
                  </button>
                  <button
                    onClick={() => setIsOverdubbing(v => !v)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                      isOverdubbing ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isOverdubbing ? 'Overdub' : 'Replace'}
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-zinc-500 uppercase">Grid</label>
                      <span className="text-[10px] text-zinc-400">1/{gridDivision}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setGridDivision(32)}
                        className={`px-2 py-1 text-[11px] rounded ${gridDivision === 32 ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                      >
                        1/32
                      </button>
                      <button
                        onClick={() => setGridDivision(64)}
                        className={`px-2 py-1 text-[11px] rounded ${gridDivision === 64 ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                      >
                        1/64
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-zinc-500 uppercase">Swing</label>
                      <span className="text-[10px] text-zinc-400">{Math.round(swingAmount * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(swingAmount * 100)}
                      onChange={(e) => setSwingAmount(Number(e.target.value) / 100)}
                      className="w-full"
                    />
                  </div>

                  {/* Variation Generator */}
                  {selectedStemId && (
                    <VariationGenerator
                      pattern={selectedStemPattern}
                      stemId={selectedStemId}
                      gridStepBeats={gridStepBeats}
                      loopBeats={loopBeats}
                      onVariationGenerated={(newPattern) => {
                        setPatternByStem(prev => ({
                          ...prev,
                          [selectedStemId]: newPattern,
                        }));
                      }}
                      className="mt-3 pt-3 border-t border-zinc-700"
                    />
                  )}
                </div>
              </div>

              {/* ✂️ CLIP EDITOR - Fine-tune your pattern */}
              <div className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Scissors className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[10px] font-semibold text-zinc-300 uppercase">Clip Editor</span>
                  </div>
                  <div className="text-[9px] text-zinc-600 font-mono">
                    ⌘C ⌘X ⌘V ⌘D
                  </div>
                </div>
                <p className="text-[10px] text-zinc-500 mb-2">Select, copy, paste, and nudge hits</p>

                <div
                  tabIndex={0}
                  onFocus={() => setIsClipEditorFocused(true)}
                  onBlur={() => setIsClipEditorFocused(false)}
                  onMouseDown={() => setIsClipEditorFocused(true)}
                  className={`rounded border ${isClipEditorFocused ? 'border-blue-500' : 'border-zinc-700'} bg-zinc-900/60 p-2 outline-none`}
                >
                  {!selectedStemId ? (
                    <div className="text-xs text-zinc-600">Select a stem to edit its clip.</div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10px] text-zinc-500">
                        <div>
                          {selectedStemPattern.length} hits
                          {selectedEventIds.size > 0 ? ` • ${selectedEventIds.size} selected` : ''}
                        </div>
                        <div>
                          Cursor: {cursorStep}/{totalSteps - 1}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <div className="flex" style={{ width: `${totalSteps * 10}px` }}>
                          {stepIndices.map((step) => {
                            const beat = step * gridStepBeats;
                            const eventsHere = selectedStemEventsByStep.get(step) ?? [];
                            const isBarBoundary = step % gridDivision === 0;
                            const hasSelected = eventsHere.some(ev => selectedEventIds.has(ev.id));
                            const hasEvents = eventsHere.length > 0;
                            const isCursor = step === cursorStep;

                            return (
                              <button
                                key={step}
                                type="button"
                                onClick={(e) => {
                                  setCursorStep(step);

                                  if (!e.shiftKey) {
                                    setSelectionAnchorStep(step);
                                  }

                                  if (!hasEvents) {
                                    if (!e.shiftKey) {
                                      clearSelection();
                                    }
                                    return;
                                  }

                                  if (e.shiftKey && selectionAnchorStep !== null) {
                                    const start = Math.min(selectionAnchorStep, step);
                                    const end = Math.max(selectionAnchorStep, step);
                                    setSelectionBySteps(Array.from({ length: end - start + 1 }, (_, i) => start + i));
                                    return;
                                  }

                                  const ids = new Set<string>();
                                  for (const ev of eventsHere) ids.add(ev.id);
                                  setSelectedEventIds(ids);
                                }}
                                className={`relative h-10 flex-shrink-0 border-r ${
                                  isBarBoundary ? 'border-zinc-500/50' : 'border-zinc-800/60'
                                } ${
                                  isCursor ? 'bg-blue-500/10' : 'bg-transparent'
                                } hover:bg-white/5`}
                                style={{ width: '10px' }}
                                title={`Beat ${beat.toFixed(2)}`}
                              >
                                {hasEvents && (
                                  <div
                                    className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-sm ${
                                      hasSelected ? 'bg-amber-400' : 'bg-zinc-400'
                                    }`}
                                  />
                                )}
                                {isCursor && (
                                  <div className="absolute inset-y-0 left-0 w-px bg-blue-400/70" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="text-[10px] text-zinc-500">
                        Nudge: ←/→ (grid) • Alt+←/→ (micro) • Del (delete) • Esc (clear)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ⚡ SEQUENCER MODE - How slices are triggered */}
              <div className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-[10px] font-semibold text-zinc-300 uppercase">Sequencer Mode</span>
                </div>
                <p className="text-[10px] text-zinc-500 mb-2">Controls how slices trigger during playback</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['sequential', 'euclidean', 'probability', 'chaos', 'follow', 'random'] as SequencerMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setSequencerMode(mode)}
                      className={`
                        px-2 py-1.5 text-[10px] font-medium rounded transition-all capitalize
                        ${sequencerMode === mode 
                          ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white' 
                          : 'bg-zinc-800 text-zinc-400 hover:text-white'
                        }
                      `}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Mode-specific controls */}
              {sequencerMode === 'euclidean' && (
                <div className="mb-6 p-3 bg-zinc-800/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Grid3X3 className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-zinc-400">Euclidean Pattern</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between">
                        <label className="text-[10px] text-zinc-500">Steps</label>
                        <span className="text-[10px] text-zinc-400">{euclideanSteps}</span>
                      </div>
                      <input 
                        type="range" 
                        min={4} 
                        max={32} 
                        value={euclideanSteps} 
                        onChange={(e) => setEuclideanSteps(parseInt(e.target.value))}
                        className="w-full" 
                      />
                    </div>
                    <div>
                      <div className="flex justify-between">
                        <label className="text-[10px] text-zinc-500">Pulses</label>
                        <span className="text-[10px] text-zinc-400">{euclideanPulses}</span>
                      </div>
                      <input 
                        type="range" 
                        min={1} 
                        max={euclideanSteps} 
                        value={euclideanPulses}
                        onChange={(e) => setEuclideanPulses(parseInt(e.target.value))}
                        className="w-full" 
                      />
                    </div>
                    <div>
                      <div className="flex justify-between">
                        <label className="text-[10px] text-zinc-500">Rotation</label>
                        <span className="text-[10px] text-zinc-400">{euclideanRotation}</span>
                      </div>
                      <input 
                        type="range" 
                        min={0} 
                        max={euclideanSteps - 1} 
                        value={euclideanRotation}
                        onChange={(e) => setEuclideanRotation(parseInt(e.target.value))}
                        className="w-full" 
                      />
                    </div>
                  </div>
                  
                  {/* Pattern visualization */}
                  <div className="mt-3 p-2 bg-zinc-900 rounded font-mono text-xs text-center tracking-widest">
                    {patternToString(euclideanPattern)}
                  </div>
                  
                  {/* Presets */}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {Object.entries(EUCLIDEAN_PRESETS).slice(0, 6).map(([name, preset]) => (
                      <button
                        key={name}
                        onClick={() => {
                          setEuclideanSteps(preset.steps);
                          setEuclideanPulses(preset.pulses);
                          setEuclideanRotation(preset.rotation);
                        }}
                        className="px-2 py-0.5 text-[9px] bg-zinc-700 hover:bg-zinc-600 rounded capitalize"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  
                  {/* Generate pattern from Euclidean */}
                  <button
                    onClick={() => {
                      if (!selectedStemId || euclideanPattern.length === 0) return;
                      const beatsPerStep = 16 / euclideanPattern.length;
                      const newEvents: PatternEvent[] = [];
                      euclideanPattern.forEach((active, i) => {
                        if (active) {
                          newEvents.push({
                            id: globalThis.crypto?.randomUUID?.() ?? `euc-${Date.now()}-${i}`,
                            stemId: selectedStemId,
                            sliceIndex: i % Math.max(1, slices.length),
                            beat: i * beatsPerStep,
                            microOffset: 0,
                            velocity: 0.8,
                          });
                        }
                      });
                      
                      setPatternByStem(prev => ({
                        ...prev,
                        [selectedStemId]: newEvents,
                      }));
                    }}
                    disabled={!selectedStemId}
                    className="mt-3 w-full py-2 text-xs font-medium bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-all"
                  >
                    Apply to Pattern
                  </button>
                </div>
              )}
              
              {sequencerMode === 'chaos' && (
                <div className="mb-6 p-3 bg-zinc-800/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <span className="text-xs text-zinc-400">Chaos Amount</span>
                  </div>
                  <input 
                    type="range" 
                    min={0} 
                    max={100} 
                    defaultValue={50} 
                    className="w-full"
                  />
                </div>
              )}
              
              {/* 🔀 CROSS-STEM - Trigger one stem from another */}
              {session && session.stems.length > 0 && (
                <div className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="w-3.5 h-3.5 text-pink-400" />
                    <span className="text-[10px] font-semibold text-zinc-300 uppercase">Cross-Stem Routing</span>
                  </div>
                  <p className="text-[10px] text-zinc-500 mb-3">When one stem plays, trigger slices from another</p>
                  <CrossStemMatrix
                    stems={session.stems}
                    routes={crossRoutes}
                    onRouteAdd={handleRouteAdd}
                    onRouteChange={handleRouteChange}
                    onRouteRemove={handleRouteRemove}
                  />
                </div>
              )}

              {/* 🎯 MOMENT ROUTING - Advanced: trigger from detected moments */}
              {session && session.stems.length > 0 && (
                <div className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5 text-orange-400" />
                      <span className="text-[10px] font-semibold text-zinc-300 uppercase">Moment Routing</span>
                    </div>
                    <button
                      onClick={() => setMomentRoutingEnabled(v => !v)}
                      className={`w-9 h-5 rounded-full transition-colors ${momentRoutingEnabled ? 'bg-orange-500' : 'bg-zinc-700'}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${momentRoutingEnabled ? 'translate-x-[18px]' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 mb-3">
                    Auto-detect musical moments and route them to trigger other stems
                  </p>

                  <div className="mb-3">
                    <label className="text-[10px] text-zinc-500 block mb-1">Max triggers per loop</label>
                    <input
                      type="range"
                      min={0}
                      max={64}
                      step={1}
                      value={momentMaxPerLoop}
                      onChange={(e) => setMomentMaxPerLoop(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="text-right text-[10px] text-zinc-400">{momentMaxPerLoop}</div>
                  </div>

                  <div className="space-y-2">
                    {session.stems.map((stem) => {
                      const bias = stemMomentBias[stem.id] ?? 'balanced';
                      const isDetecting = !!detectingStemMoments[stem.id];
                      const momentsCount = stemMoments[stem.id]?.length ?? 0;
                      const typeMask = stemMomentTypes[stem.id] ?? { hit: true, phrase: true, texture: true, change: true };
                      return (
                        <div key={stem.id} className="p-2 rounded border border-zinc-800 bg-zinc-900/40">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-zinc-300 capitalize">{stem.role}</div>
                            <div className="flex items-center gap-2">
                              <select
                                value={bias}
                                onChange={(e) => setStemMomentBias(prev => ({ ...prev, [stem.id]: e.target.value as any }))}
                                className="text-[10px] bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-300"
                              >
                                <option value="balanced">balanced</option>
                                <option value="hits">hits</option>
                                <option value="phrases">phrases</option>
                                <option value="textures">textures</option>
                              </select>
                              <button
                                disabled={isDetecting}
                                onClick={() => detectMomentsForStem(stem)}
                                className="px-2 py-1 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 border border-zinc-700"
                              >
                                {isDetecting ? 'Detecting…' : `Detect (${momentsCount})`}
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={typeMask.hit}
                                  onChange={(e) => setStemMomentTypes(prev => ({ ...prev, [stem.id]: { ...(prev[stem.id] ?? typeMask), hit: e.target.checked } }))}
                                  className="accent-red-500"
                                />
                                hit
                              </label>
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={typeMask.phrase}
                                  onChange={(e) => setStemMomentTypes(prev => ({ ...prev, [stem.id]: { ...(prev[stem.id] ?? typeMask), phrase: e.target.checked } }))}
                                  className="accent-blue-500"
                                />
                                phrase
                              </label>
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={typeMask.texture}
                                  onChange={(e) => setStemMomentTypes(prev => ({ ...prev, [stem.id]: { ...(prev[stem.id] ?? typeMask), texture: e.target.checked } }))}
                                  className="accent-purple-500"
                                />
                                texture
                              </label>
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={typeMask.change}
                                  onChange={(e) => setStemMomentTypes(prev => ({ ...prev, [stem.id]: { ...(prev[stem.id] ?? typeMask), change: e.target.checked } }))}
                                  className="accent-yellow-500"
                                />
                                change
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <CrossStemMatrix
                      stems={session.stems}
                      routes={momentRoutes}
                      onRouteAdd={handleMomentRouteAdd}
                      onRouteChange={handleMomentRouteChange}
                      onRouteRemove={handleMomentRouteRemove}
                    />
                  </div>
                </div>
              )}
              
              {/* Rules */}
              <TriggerRuleEditor
                rules={rules}
                onAddRule={addRule}
                onUpdateRule={updateRule}
                onRemoveRule={removeRule}
              />
            </div>
          )}
        </div>
      </div>
      
      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-900/90 border border-red-700 rounded-lg text-sm text-red-200">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-white">×</button>
        </div>
      )}

      {/* Keyboard Shortcuts Help Overlay */}
      {showShortcutsHelp && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => setShowShortcutsHelp(false)}
        >
          <div 
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Keyboard Shortcuts</h2>
              <button 
                onClick={() => setShowShortcutsHelp(false)}
                className="text-zinc-400 hover:text-white text-xl"
              >×</button>
            </div>
            
            <div className="grid grid-cols-2 gap-6 text-sm">
              {/* Transport */}
              <div>
                <h3 className="text-zinc-400 font-semibold mb-2 uppercase text-xs">Transport</h3>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-zinc-300">Play/Pause</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">Space</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Stop</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">Enter</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Rewind</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">0</kbd></div>
                </div>
              </div>
              
              {/* Editing */}
              <div>
                <h3 className="text-zinc-400 font-semibold mb-2 uppercase text-xs">Editing</h3>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-zinc-300">Copy</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">⌘C</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Cut</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">⌘X</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Paste</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">⌘V</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Duplicate</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">⌘D</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Delete</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">⌫</kbd></div>
                </div>
              </div>
              
              {/* Stems */}
              <div>
                <h3 className="text-zinc-400 font-semibold mb-2 uppercase text-xs">Stems</h3>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-zinc-300">Mute Drums</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">1</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Mute Bass</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">2</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Mute Vocals</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">3</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Mute Other</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">4</kbd></div>
                </div>
              </div>
              
              {/* Moments */}
              <div>
                <h3 className="text-zinc-400 font-semibold mb-2 uppercase text-xs">Moments Timeline</h3>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-zinc-300">Mark In</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">I</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Mark Out</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">O</kbd></div>
                </div>
              </div>
              
              {/* Navigation */}
              <div>
                <h3 className="text-zinc-400 font-semibold mb-2 uppercase text-xs">Navigation</h3>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-zinc-300">Nudge Left</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">←</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Nudge Right</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">→</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Microtiming</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">⌥←→</kbd></div>
                </div>
              </div>
              
              {/* Help */}
              <div>
                <h3 className="text-zinc-400 font-semibold mb-2 uppercase text-xs">Help</h3>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-zinc-300">Show Shortcuts</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">?</kbd></div>
                  <div className="flex justify-between"><span className="text-zinc-300">Close</span><kbd className="bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">Esc</kbd></div>
                </div>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-zinc-800 text-center text-xs text-zinc-500">
              Press <kbd className="bg-zinc-800 px-1.5 py-0.5 rounded">?</kbd> anytime to toggle this help
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DAWWorkspace;
