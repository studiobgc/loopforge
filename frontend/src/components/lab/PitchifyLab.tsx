/**
 * Pitchify Lab - Harmonic Instrument Mode
 * 
 * Transform any audio material into pitched, playable instruments.
 * 
 * Workflow: Pick sample → Pitchify preset → Slice → Jam → Keep/Discard
 * 
 * Inspired by instruments that filter complex sounds through harmonic series,
 * allowing timbre to evolve naturally from the source material.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload, Check, X, Download,
  Waves, Music, Sparkles, Trash2,
  Loader2, Grid3X3, Archive,
  Zap, Keyboard, ArrowRight
} from 'lucide-react';
import { api } from '../../api/client';
import { getAudioEngine } from '../../audio/engine';
import { WaveformCanvas } from '../visualizers/WaveformCanvas';
import { useSession } from '../../contexts/SessionContext';


// Types
interface PitchifyPreset {
  id: string;
  name: string;
  description: string;
  color: string;
  params: {
    preset?: string;
    voicing: string;
    motion: string;
    resonance: number;
    spectralTilt: number;
    numHarmonics: number;
    motionRate: number;
    motionDepth: number;
  };
}

interface SampleLayer {
  id: string;
  name: string;
  type: 'original' | 'pitchified';
  audioBuffer: AudioBuffer | null;
  audioUrl: string;
  filePath: string;
  preset?: string;
  rootNote?: string;
  mode?: string;
  slices: LabSlice[];
  isActive: boolean;
}

interface LabSlice {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  energy?: number;
}

interface ExportItem {
  id: string;
  name: string;
  layers: SampleLayer[];
  status: 'pending' | 'exported';
  createdAt: Date;
}

// Presets optimized for turning noise/field recordings into pitched material
const PITCHIFY_PRESETS: PitchifyPreset[] = [
  // === ENVELOPE FOLLOWING (timbre shaped by input dynamics) ===
  {
    id: 'responsive',
    name: 'Responsive',
    description: 'Timbre follows input dynamics',
    color: 'from-amber-500 to-orange-600',
    params: {
      preset: 'responsive',
      voicing: 'natural',
      motion: 'follow',
      resonance: 0.6,
      spectralTilt: 0,
      numHarmonics: 20,
      motionRate: 0,
      motionDepth: 0.7,
    },
  },
  {
    id: 'vocal',
    name: 'Vocal',
    description: 'For voice memos, speech',
    color: 'from-rose-500 to-pink-600',
    params: {
      preset: 'vocal',
      voicing: 'natural',
      motion: 'follow',
      resonance: 0.5,
      spectralTilt: -2,
      numHarmonics: 16,
      motionRate: 0,
      motionDepth: 0.8,
    },
  },
  {
    id: 'field',
    name: 'Field',
    description: 'For field recordings, ambience',
    color: 'from-emerald-500 to-green-600',
    params: {
      preset: 'field',
      voicing: 'natural',
      motion: 'follow',
      resonance: 0.65,
      spectralTilt: -1,
      numHarmonics: 28,
      motionRate: 0,
      motionDepth: 0.6,
    },
  },
  {
    id: 'percussive',
    name: 'Percussive',
    description: 'Responds to transients/hits',
    color: 'from-red-600 to-orange-500',
    params: {
      preset: 'percussive',
      voicing: 'spread',
      motion: 'transient',
      resonance: 0.8,
      spectralTilt: 3,
      numHarmonics: 24,
      motionRate: 0,
      motionDepth: 0.9,
    },
  },
  // === LFO-BASED (traditional modulation) ===
  {
    id: 'drone',
    name: 'Drone',
    description: 'Deep, breathing pad',
    color: 'from-purple-600 to-indigo-600',
    params: {
      preset: 'drone',
      voicing: 'natural',
      motion: 'breathe',
      resonance: 0.7,
      spectralTilt: -3,
      numHarmonics: 24,
      motionRate: 0.1,
      motionDepth: 0.3,
    },
  },
  {
    id: 'crystalline',
    name: 'Crystal',
    description: 'Bright, shimmering',
    color: 'from-cyan-500 to-blue-500',
    params: {
      preset: 'crystalline',
      voicing: 'spread',
      motion: 'shimmer',
      resonance: 0.85,
      spectralTilt: 2,
      numHarmonics: 32,
      motionRate: 3.0,
      motionDepth: 0.15,
    },
  },
  {
    id: 'hollow',
    name: 'Hollow',
    description: 'Odd harmonics, clarinet-like',
    color: 'from-zinc-500 to-zinc-600',
    params: {
      preset: 'hollow',
      voicing: 'odd_only',
      motion: 'static',
      resonance: 0.6,
      spectralTilt: -1,
      numHarmonics: 16,
      motionRate: 0,
      motionDepth: 0,
    },
  },
  {
    id: 'warm',
    name: 'Warm',
    description: 'Dark, dense low-end',
    color: 'from-orange-700 to-amber-700',
    params: {
      preset: 'warm',
      voicing: 'dense',
      motion: 'breathe',
      resonance: 0.4,
      spectralTilt: -6,
      numHarmonics: 12,
      motionRate: 0.05,
      motionDepth: 0.2,
    },
  },
];

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MODES = ['major', 'minor', 'pentatonic', 'dorian', 'chromatic'];

export const PitchifyLab: React.FC = () => {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Sample state
  const [currentSample, setCurrentSample] = useState<{
    name: string;
    file?: File;
    url?: string;
    path?: string;
  } | null>(null);
  const [layers, setLayers] = useState<SampleLayer[]>([]);
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  
  // Pitchify controls
  const [selectedPreset, setSelectedPreset] = useState<PitchifyPreset>(PITCHIFY_PRESETS[0]);
  const [targetKey, setTargetKey] = useState({ root: 'C', mode: 'major' });
  
  // Processing state
  const [isUploading, setIsUploading] = useState(false);
  const [isPitchifying, setIsPitchifying] = useState(false);
  const [isSlicing, setIsSlicing] = useState(false);
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingSliceIndex, setPlayingSliceIndex] = useState<number | null>(null);
  
  // Export queue
  const [exportQueue, setExportQueue] = useState<ExportItem[]>([]);
  const [showExportPanel, setShowExportPanel] = useState(false);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  
  // Audio playback refs for exclusive playback with crossfade
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentGainRef = useRef<GainNode | null>(null);
  
  // Shared session context for DAW integration
  const { selectedStemForPitchify, clearPitchifySelection, availableStems } = useSession();

  // Session will be created on first upload
  
  // Handle stem sent from DAW workflow (via context or localStorage)
  useEffect(() => {
    // Check context first
    if (selectedStemForPitchify && !currentSample) {
      loadStemFromDaw(selectedStemForPitchify);
      clearPitchifySelection();
      return;
    }
    
    // Check localStorage for stem sent from DAW (handles page refresh scenario)
    if (!currentSample) {
      const pendingStem = localStorage.getItem('pitchify_pending_stem');
      if (pendingStem) {
        try {
          const stem = JSON.parse(pendingStem);
          localStorage.removeItem('pitchify_pending_stem');
          loadStemFromDaw(stem);
        } catch (e) {
          console.error('Failed to parse pending stem:', e);
          localStorage.removeItem('pitchify_pending_stem');
        }
      }
    }
  }, [selectedStemForPitchify, currentSample, clearPitchifySelection]);
  
  // Load a stem that was sent from DAW
  const loadStemFromDaw = async (stem: typeof selectedStemForPitchify) => {
    if (!stem) return;
    
    setIsUploading(true);
    setLayers([]);
    setActiveLayerIndex(0);
    
    try {
      setSessionId(stem.sessionId);
      
      // Load audio buffer
      const engine = getAudioEngine();
      await engine.init();
      const ctx = engine.getContext();
      if (!ctx) throw new Error('Audio context not available');
      
      const audioUrl = stem.audioUrl || `/files/${stem.path}`;
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      // Create original layer
      const originalLayer: SampleLayer = {
        id: `original-${Date.now()}`,
        name: stem.name,
        type: 'original',
        audioBuffer,
        audioUrl: stem.audioUrl,
        filePath: stem.path,
        slices: [],
        isActive: true,
      };
      
      setCurrentSample({
        name: stem.name,
        url: stem.audioUrl,
        path: stem.path,
      });
      
      setLayers([originalLayer]);
      
      // Auto-slice the original
      await sliceLayer(originalLayer, 0, stem.sessionId);
      
    } catch (err) {
      console.error('Failed to load stem from DAW:', err);
    } finally {
      setIsUploading(false);
    }
  };

  // Get active layer
  const activeLayer = layers[activeLayerIndex] || null;

  // Handle file drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files);
    const audioFile = files.find(f => 
      f.type.startsWith('audio/') || 
      f.name.endsWith('.mp3') || 
      f.name.endsWith('.wav')
    );
    
    if (audioFile) {
      await loadSample(audioFile);
    }
  }, [sessionId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Load a sample file
  const loadSample = async (file: File) => {
    setIsUploading(true);
    setLayers([]);
    setActiveLayerIndex(0);
    
    try {
      // Upload file (creates session automatically)
      const result = await api.upload(file, { autoSeparate: false, autoAnalyze: false });
      setSessionId(result.session_id);
      
      // Load audio buffer
      const engine = getAudioEngine();
      await engine.init();
      const ctx = engine.getContext();
      if (!ctx) throw new Error('Audio context not available');
      
      const audioUrl = result.source?.url || `/files/${result.source?.path}`;
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      // Create original layer
      const originalLayer: SampleLayer = {
        id: `original-${Date.now()}`,
        name: file.name,
        type: 'original',
        audioBuffer,
        audioUrl: result.source?.url || '',
        filePath: result.source?.path || '',
        slices: [],
        isActive: true,
      };
      
      setCurrentSample({
        name: file.name,
        file,
        url: result.source?.url,
        path: result.source?.path,
      });
      
      setLayers([originalLayer]);
      
      // Auto-slice the original
      await sliceLayer(originalLayer, 0, result.session_id);
      
    } catch (err) {
      console.error('Failed to load sample:', err);
    } finally {
      setIsUploading(false);
    }
  };

  // Slice a layer into playable segments
  const sliceLayer = async (layer: SampleLayer, layerIndex: number, sid?: string) => {
    const activeSessionId = sid || sessionId;
    if (!activeSessionId || !layer.filePath) return;
    
    setIsSlicing(true);
    
    try {
      const result = await api.createSliceBank(
        activeSessionId,
        layer.filePath,
        'other'
      );
      
      const slices: LabSlice[] = result.slices.map((s: any, i: number) => ({
        index: i,
        startTime: s.start_time,
        endTime: s.end_time,
        duration: s.duration,
        energy: s.rms_energy,
      }));
      
      setLayers(prev => prev.map((l, i) => 
        i === layerIndex ? { ...l, slices } : l
      ));
      
    } catch (err) {
      console.error('Failed to slice:', err);
    } finally {
      setIsSlicing(false);
    }
  };

  // Apply pitchify effect
  const handlePitchify = async () => {
    if (!sessionId || !currentSample?.path || layers.length === 0) return;
    
    setIsPitchifying(true);
    
    try {
      const result = await api.applyHarmonicFilter({
        sessionId,
        stemPath: currentSample.path,
        rootNote: targetKey.root,
        mode: targetKey.mode as 'major' | 'minor' | 'pentatonic' | 'dorian' | 'chromatic',
        numHarmonics: selectedPreset.params.numHarmonics,
        resonance: selectedPreset.params.resonance,
        spectralTilt: selectedPreset.params.spectralTilt,
        voicing: selectedPreset.params.voicing as 'natural' | 'odd_only' | 'fifth' | 'spread' | 'dense',
        motion: selectedPreset.params.motion as 'static' | 'breathe' | 'pulse' | 'shimmer' | 'drift',
        motionRate: selectedPreset.params.motionRate,
        motionDepth: selectedPreset.params.motionDepth,
        preset: selectedPreset.params.preset,
        mix: 1.0,
      });
      
      // Load the pitchified audio
      const engine = getAudioEngine();
      const ctx = engine.getContext();
      if (!ctx) throw new Error('Audio context not available');
      const response = await fetch(result.output_url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      // Create pitchified layer
      const pitchifiedLayer: SampleLayer = {
        id: `pitchified-${Date.now()}`,
        name: `${currentSample.name} [${selectedPreset.name} ${targetKey.root}${targetKey.mode}]`,
        type: 'pitchified',
        audioBuffer,
        audioUrl: result.output_url,
        filePath: result.output_path,
        preset: selectedPreset.name,
        rootNote: targetKey.root,
        mode: targetKey.mode,
        slices: [],
        isActive: true,
      };
      
      // Add to layers
      setLayers(prev => [...prev, pitchifiedLayer]);
      const newIndex = layers.length;
      setActiveLayerIndex(newIndex);
      
      // Auto-slice the pitchified version
      await sliceLayer(pitchifiedLayer, newIndex);
      
    } catch (err) {
      console.error('Failed to pitchify:', err);
    } finally {
      setIsPitchifying(false);
    }
  };

  // Play a slice with exclusive playback and smooth crossfade
  const playSlice = useCallback((sliceIndex: number) => {
    if (!activeLayer?.audioBuffer || !activeLayer.slices[sliceIndex]) return;
    
    const engine = getAudioEngine();
    const slice = activeLayer.slices[sliceIndex];
    const ctx = engine.getContext();
    if (!ctx) return;
    
    const now = ctx.currentTime;
    const crossfadeTime = 0.015; // 15ms crossfade for smooth transition
    
    // Stop previous slice with quick fade-out (exclusive/monophonic playback)
    if (currentSourceRef.current && currentGainRef.current) {
      try {
        // Quick fade out to avoid clicks
        currentGainRef.current.gain.setValueAtTime(currentGainRef.current.gain.value, now);
        currentGainRef.current.gain.linearRampToValueAtTime(0, now + crossfadeTime);
        // Schedule stop after fade
        currentSourceRef.current.stop(now + crossfadeTime + 0.001);
      } catch {
        // Source may have already ended
      }
    }
    
    // Also stop any engine-tracked voices
    engine.stopAll(crossfadeTime);
    
    // Create new source with gain envelope
    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    
    source.buffer = activeLayer.audioBuffer;
    
    // Connect: Source → Gain → Destination
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Fade in for smooth transition
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + crossfadeTime);
    
    // Start playback from slice start time
    source.start(now, slice.startTime, slice.duration);
    
    // Store refs for next exclusive playback
    currentSourceRef.current = source;
    currentGainRef.current = gainNode;
    
    // Clear refs when playback ends
    source.onended = () => {
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null;
        currentGainRef.current = null;
      }
    };
    
    setPlayingSliceIndex(sliceIndex);
    setTimeout(() => setPlayingSliceIndex(null), slice.duration * 1000);
  }, [activeLayer]);

  // Keep current sample (add to export queue)
  const handleKeep = () => {
    if (!currentSample || layers.length === 0) return;
    
    const exportItem: ExportItem = {
      id: `export-${Date.now()}`,
      name: currentSample.name,
      layers: [...layers],
      status: 'pending',
      createdAt: new Date(),
    };
    
    setExportQueue(prev => [...prev, exportItem]);
    
    // Clear for next sample
    setCurrentSample(null);
    setLayers([]);
    setActiveLayerIndex(0);
  };

  // Discard current sample
  const handleDiscard = () => {
    setCurrentSample(null);
    setLayers([]);
    setActiveLayerIndex(0);
  };

  // Export all queued items
  const handleExportAll = async () => {
    for (const item of exportQueue) {
      if (item.status === 'pending') {
        // Trigger download for each layer
        for (const layer of item.layers) {
          if (layer.audioUrl) {
            const a = document.createElement('a');
            a.href = layer.audioUrl;
            a.download = `${layer.name.replace(/[^a-z0-9]/gi, '_')}.wav`;
            a.click();
          }
        }
        
        // Mark as exported
        setExportQueue(prev => prev.map(e => 
          e.id === item.id ? { ...e, status: 'exported' } : e
        ));
      }
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Number keys 1-9 play slices
      if (e.key >= '1' && e.key <= '9' && activeLayer?.slices) {
        const index = parseInt(e.key) - 1;
        if (index < activeLayer.slices.length) {
          playSlice(index);
        }
      }
      
      // Space = toggle play
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        if (activeLayer?.audioBuffer) {
          const engine = getAudioEngine();
          const ctx = engine.getContext();
          if (isPlaying) {
            engine.stopAll(0.01);
            setIsPlaying(false);
          } else if (ctx) {
            // Play full sample
            const source = ctx.createBufferSource();
            source.buffer = activeLayer.audioBuffer;
            source.connect(ctx.destination);
            source.start(0);
            setIsPlaying(true);
            source.onended = () => setIsPlaying(false);
          }
        }
      }
      
      // P = pitchify
      if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
        if (currentSample && !isPitchifying) {
          handlePitchify();
        }
      }
      
      // K = keep
      if (e.key === 'k' && !e.metaKey && !e.ctrlKey) {
        handleKeep();
      }
      
      // D = discard
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        handleDiscard();
      }
      
      // Tab = switch layers
      if (e.key === 'Tab' && layers.length > 1) {
        e.preventDefault();
        setActiveLayerIndex(prev => (prev + 1) % layers.length);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeLayer, isPlaying, isPitchifying, layers, playSlice, currentSample]);

  return (
    <div className="h-screen bg-zinc-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                <Waves className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Pitchify Lab</h1>
                <p className="text-xs text-zinc-500">Turn any sound into an instrument</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Export queue badge */}
              <button
                onClick={() => setShowExportPanel(!showExportPanel)}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-lg transition-all
                  ${exportQueue.length > 0 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}
                `}
              >
                <Archive className="w-4 h-4" />
                <span className="text-sm font-medium">{exportQueue.length} queued</span>
              </button>
              
              {/* Help */}
              <button className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                <Keyboard className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Main workspace */}
        <main className="flex-1 p-6 overflow-y-auto">
          {!currentSample ? (
            /* Drop zone */
            <div className="h-full flex flex-col">
              {/* Available stems from DAW */}
              {availableStems.length > 0 && (
                <div className="mb-4 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                  <div className="flex items-center gap-2 mb-3">
                    <ArrowRight className="w-4 h-4 text-purple-400" />
                    <span className="text-sm font-medium text-zinc-300">From DAW Session</span>
                    <span className="text-xs text-zinc-500">({availableStems.length} stems)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableStems.map((stem) => (
                      <button
                        key={stem.id}
                        onClick={() => loadStemFromDaw(stem)}
                        className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-purple-500/20 hover:border-purple-500/50 border border-zinc-700 rounded-lg transition-all group"
                      >
                        <Music className="w-4 h-4 text-zinc-500 group-hover:text-purple-400" />
                        <span className="text-sm text-zinc-300 group-hover:text-purple-300">{stem.name}</span>
                        <span className="text-xs text-zinc-600 capitalize">({stem.role})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div
                ref={dropZoneRef}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 rounded-2xl bg-zinc-900/30 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all cursor-pointer"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
                  onChange={(e) => e.target.files?.[0] && loadSample(e.target.files[0])}
                  className="hidden"
                />
                
                {isUploading ? (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 text-purple-400 animate-spin" />
                    <p className="text-zinc-400">Loading sample...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-6 rounded-full bg-zinc-800/50">
                      <Upload className="w-12 h-12 text-zinc-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-medium text-zinc-300">Drop a sample here</p>
                      <p className="text-sm text-zinc-500 mt-1">
                        MP3, WAV, FLAC, or any audio file
                      </p>
                    </div>
                    <button className="mt-4 px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors">
                      Browse files
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Sample workspace */
            <div className="space-y-6">
              {/* Sample header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-zinc-800">
                    <Music className="w-5 h-5 text-zinc-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-zinc-200">{currentSample.name}</h2>
                    <p className="text-xs text-zinc-500">
                      {layers.length} layer{layers.length !== 1 ? 's' : ''} • 
                      {activeLayer?.slices.length || 0} slices
                    </p>
                  </div>
                </div>
                
                {/* Keep / Discard */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDiscard}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-all"
                  >
                    <X className="w-4 h-4" />
                    <span className="text-sm">Discard</span>
                    <kbd className="ml-2 px-1.5 py-0.5 text-[10px] bg-zinc-700 rounded">D</kbd>
                  </button>
                  <button
                    onClick={handleKeep}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg transition-all"
                  >
                    <Check className="w-4 h-4" />
                    <span className="text-sm">Keep</span>
                    <kbd className="ml-2 px-1.5 py-0.5 text-[10px] bg-emerald-500/30 rounded">K</kbd>
                  </button>
                </div>
              </div>

              {/* Layer tabs */}
              <div className="flex items-center gap-2">
                {layers.map((layer, i) => (
                  <button
                    key={layer.id}
                    onClick={() => setActiveLayerIndex(i)}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                      ${i === activeLayerIndex 
                        ? layer.type === 'pitchified'
                          ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/50'
                          : 'bg-zinc-700 text-white'
                        : 'bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'}
                    `}
                  >
                    {layer.type === 'original' ? (
                      <Music className="w-3.5 h-3.5" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span className="truncate max-w-[150px]">
                      {layer.type === 'original' ? 'Original' : layer.preset}
                    </span>
                    {layer.rootNote && (
                      <span className="text-xs opacity-60">{layer.rootNote}</span>
                    )}
                  </button>
                ))}
                
                {layers.length > 1 && (
                  <span className="text-[10px] text-zinc-600 ml-2">
                    Tab to switch
                  </span>
                )}
              </div>

              {/* Waveform */}
              <div className="h-32 bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                {activeLayer?.audioBuffer && (
                  <WaveformCanvas
                    audioBuffer={activeLayer.audioBuffer}
                    slices={activeLayer.slices.map(s => ({
                      startTime: s.startTime,
                      endTime: s.endTime,
                      energy: s.energy ?? 0.5,
                    }))}
                    playingSliceIndex={playingSliceIndex ?? undefined}
                    className="w-full h-full"
                    colorScheme="neon"
                  />
                )}
              </div>

              {/* Slice pads */}
              <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Grid3X3 className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm font-medium text-zinc-300">Pads</span>
                  </div>
                  <span className="text-xs text-zinc-600">Keys 1-9 to play</span>
                </div>
                
                {isSlicing ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                    <span className="ml-3 text-zinc-400">Creating slices...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {activeLayer?.slices.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => playSlice(i)}
                        className={`
                          aspect-square rounded-lg font-bold text-sm transition-all
                          ${playingSliceIndex === i
                            ? 'bg-purple-500 text-white scale-95 shadow-lg shadow-purple-500/50'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'}
                        `}
                      >
                        {i + 1}
                      </button>
                    ))}
                    
                    {(!activeLayer?.slices || activeLayer.slices.length === 0) && (
                      <div className="col-span-full text-center py-8 text-zinc-600">
                        No slices yet
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Right panel - Pitchify controls */}
        <aside className="w-80 flex-shrink-0 border-l border-zinc-800 bg-zinc-900/50 p-4 overflow-y-auto">
          <div className="space-y-6">
            {/* Pitchify section */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Pitchify</h3>
              </div>
              
              {/* Preset buttons */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                {PITCHIFY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPreset(preset)}
                    className={`
                      p-3 rounded-lg text-left transition-all
                      ${selectedPreset.id === preset.id
                        ? `bg-gradient-to-r ${preset.color} text-white shadow-lg`
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}
                    `}
                  >
                    <div className="text-sm font-medium">{preset.name}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{preset.description}</div>
                  </button>
                ))}
              </div>
              
              {/* Target key */}
              <div className="space-y-2 mb-4">
                <label className="text-xs text-zinc-500">Target Key</label>
                <div className="flex gap-2">
                  <select
                    value={targetKey.root}
                    onChange={(e) => setTargetKey(prev => ({ ...prev, root: e.target.value }))}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  >
                    {NOTES.map(note => (
                      <option key={note} value={note}>{note}</option>
                    ))}
                  </select>
                  <select
                    value={targetKey.mode}
                    onChange={(e) => setTargetKey(prev => ({ ...prev, mode: e.target.value }))}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                  >
                    {MODES.map(mode => (
                      <option key={mode} value={mode}>{mode}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              {/* Pitchify button */}
              <button
                onClick={handlePitchify}
                disabled={!currentSample || isPitchifying}
                className={`
                  w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                  text-sm font-semibold transition-all
                  ${!currentSample || isPitchifying
                    ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                    : `bg-gradient-to-r ${selectedPreset.color} text-white hover:opacity-90 shadow-lg`}
                `}
              >
                {isPitchifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Pitchifying...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Pitchify
                    <kbd className="ml-2 px-1.5 py-0.5 text-[10px] bg-white/20 rounded">P</kbd>
                  </>
                )}
              </button>
            </div>
            
            {/* Preset details */}
            <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              <div className="text-xs text-zinc-500 mb-2">Current preset settings</div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-zinc-600">Voicing</span>
                  <span className="text-zinc-400">{selectedPreset.params.voicing}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600">Motion</span>
                  <span className="text-zinc-400">{selectedPreset.params.motion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600">Resonance</span>
                  <span className="text-zinc-400">{Math.round(selectedPreset.params.resonance * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600">Tilt</span>
                  <span className="text-zinc-400">{selectedPreset.params.spectralTilt} dB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600">Harmonics</span>
                  <span className="text-zinc-400">{selectedPreset.params.numHarmonics}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600">Rate</span>
                  <span className="text-zinc-400">{selectedPreset.params.motionRate} Hz</span>
                </div>
              </div>
            </div>
            
            {/* Keyboard shortcuts */}
            <div className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
              <div className="text-xs font-medium text-zinc-400 mb-2">Shortcuts</div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Play slice</span>
                  <span className="text-zinc-400 font-mono">1-9</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Play/Stop full</span>
                  <span className="text-zinc-400 font-mono">Space</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Pitchify</span>
                  <span className="text-zinc-400 font-mono">P</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Keep sample</span>
                  <span className="text-zinc-400 font-mono">K</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Discard</span>
                  <span className="text-zinc-400 font-mono">D</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Switch layer</span>
                  <span className="text-zinc-400 font-mono">Tab</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Export panel (slide-out) */}
        {showExportPanel && (
          <aside className="w-80 flex-shrink-0 border-l border-zinc-800 bg-zinc-900 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-300">Export Queue</h3>
              <button
                onClick={() => setShowExportPanel(false)}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {exportQueue.length === 0 ? (
              <div className="text-center py-8 text-zinc-600">
                <Archive className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No samples queued</p>
                <p className="text-xs mt-1">Press K to keep samples</p>
              </div>
            ) : (
              <div className="space-y-3">
                {exportQueue.map((item) => (
                  <div
                    key={item.id}
                    className={`
                      p-3 rounded-lg border
                      ${item.status === 'exported'
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-zinc-800/50 border-zinc-700'}
                    `}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-300 truncate">{item.name}</p>
                        <p className="text-xs text-zinc-500">
                          {item.layers.length} layer{item.layers.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      {item.status === 'exported' ? (
                        <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <button
                          onClick={() => setExportQueue(prev => prev.filter(e => e.id !== item.id))}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    
                    {/* Layer tags */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.layers.map((layer) => (
                        <span
                          key={layer.id}
                          className={`
                            px-2 py-0.5 rounded text-[10px] font-medium
                            ${layer.type === 'pitchified'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-zinc-700 text-zinc-400'}
                          `}
                        >
                          {layer.type === 'original' ? 'Original' : `${layer.preset} ${layer.rootNote}`}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                
                {/* Export all button */}
                <button
                  onClick={handleExportAll}
                  disabled={exportQueue.every(e => e.status === 'exported')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-semibold transition-all"
                >
                  <Download className="w-4 h-4" />
                  Export All ({exportQueue.filter(e => e.status === 'pending').length})
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};

export default PitchifyLab;
