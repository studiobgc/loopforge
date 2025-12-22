/**
 * DrumSynthesizer - TR-808 style drum synthesis UI
 * 
 * Features:
 * - Kick/Snare/Hat synthesis tabs
 * - Frequency/Decay/Saturation controls
 * - Real-time preview
 * - Export to slice bank
 */

import React, { useState, useCallback, useRef } from 'react';
import { 
  Play, 
  Square,
  Download,
  Volume2,
  Settings,
} from 'lucide-react';
import * as Tone from 'tone';

// =============================================================================
// TYPES
// =============================================================================

type DrumType = 'kick' | 'snare' | 'hat';

interface DrumParams {
  // Kick
  freqStart: number;
  freqEnd: number;
  // All
  decay: number;
  saturation: number;
  duration: number;
  // Hat
  filterCutoff: number;
  brightness: number;
}

interface DrumSynthesizerProps {
  onExport?: (audioData: ArrayBuffer, drumType: DrumType, params: DrumParams) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const DrumSynthesizer: React.FC<DrumSynthesizerProps> = ({
  onExport,
}) => {
  const [activeTab, setActiveTab] = useState<DrumType>('kick');
  const [isPlaying, setIsPlaying] = useState(false);
  const [params, setParams] = useState<DrumParams>({
    freqStart: 60,
    freqEnd: 20,
    decay: 0.5,
    saturation: 0.0,
    duration: 0.5,
    filterCutoff: 8000,
    brightness: 0.8,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const handleParamChange = useCallback((key: keyof DrumParams, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const handlePreview = useCallback(async () => {
    if (isPlaying) {
      // Stop
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch (e) {
          // Already stopped
        }
        sourceRef.current = null;
      }
      setIsPlaying(false);
      return;
    }

    try {
      await Tone.start();
      
      // Call API to synthesize
      const response = await fetch('/api/footwork/synthesize-drum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drum_type: activeTab,
          freq_start: activeTab === 'kick' ? params.freqStart : undefined,
          freq_end: activeTab === 'kick' ? params.freqEnd : undefined,
          decay: params.decay,
          saturation: params.saturation,
          duration: params.duration,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `HTTP ${response.status}: Failed to synthesize drum`);
      }

      const data = await response.json();
      
      if (!data.audio_data) {
        throw new Error('No audio data returned from server');
      }
      
      // Decode base64 audio
      const audioData = Uint8Array.from(atob(data.audio_data), c => c.charCodeAt(0));
      const audioBuffer = await Tone.context.decodeAudioData(audioData.buffer);
      
      // Play
      const source = Tone.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(Tone.context.destination);
      source.start(0);
      
      sourceRef.current = source;
      setIsPlaying(true);
      
      // Auto-stop when done
      source.onended = () => {
        setIsPlaying(false);
        sourceRef.current = null;
      };
    } catch (error) {
      console.error('Error previewing drum:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Failed to preview drum'}`);
      setIsPlaying(false);
    }
  }, [activeTab, params, isPlaying]);

  const handleExport = useCallback(async () => {
    try {
      const response = await fetch('/api/footwork/synthesize-drum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drum_type: activeTab,
          freq_start: activeTab === 'kick' ? params.freqStart : undefined,
          freq_end: activeTab === 'kick' ? params.freqEnd : undefined,
          decay: params.decay,
          saturation: params.saturation,
          duration: params.duration,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `HTTP ${response.status}: Failed to synthesize drum`);
      }

      const data = await response.json();
      
      if (!data.audio_data) {
        throw new Error('No audio data returned from server');
      }
      
      const audioData = Uint8Array.from(atob(data.audio_data), c => c.charCodeAt(0));
      
      onExport?.(audioData.buffer, activeTab, params);
    } catch (error) {
      console.error('Error exporting drum:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Failed to export drum'}`);
    }
  }, [activeTab, params, onExport]);

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 text-white p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Drum Synthesizer</h2>
          <p className="text-sm text-zinc-400">TR-808 style synthesis</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg flex items-center gap-2"
          >
            {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isPlaying ? 'Stop' : 'Preview'}
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-800">
        {(['kick', 'snare', 'hat'] as DrumType[]).map(type => (
          <button
            key={type}
            onClick={() => setActiveTab(type)}
            className={`
              px-4 py-2 text-sm font-medium transition-colors
              ${activeTab === type 
                ? 'border-b-2 border-amber-600 text-amber-400' 
                : 'text-zinc-400 hover:text-zinc-300'
              }
            `}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4">
          {/* Kick-specific controls */}
          {activeTab === 'kick' && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-400">Start Frequency (Hz)</label>
                  <span className="text-xs text-zinc-500">{params.freqStart.toFixed(1)} Hz</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="200"
                  step="1"
                  value={params.freqStart}
                  onChange={(e) => handleParamChange('freqStart', parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-400">End Frequency (Hz)</label>
                  <span className="text-xs text-zinc-500">{params.freqEnd.toFixed(1)} Hz</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={params.freqEnd}
                  onChange={(e) => handleParamChange('freqEnd', parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </>
          )}

          {/* Hat-specific controls */}
          {activeTab === 'hat' && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-400">Filter Cutoff (Hz)</label>
                  <span className="text-xs text-zinc-500">{params.filterCutoff.toFixed(0)} Hz</span>
                </div>
                <input
                  type="range"
                  min="1000"
                  max="20000"
                  step="100"
                  value={params.filterCutoff}
                  onChange={(e) => handleParamChange('filterCutoff', parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-400">Brightness</label>
                  <span className="text-xs text-zinc-500">{Math.round(params.brightness * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={params.brightness}
                  onChange={(e) => handleParamChange('brightness', parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </>
          )}

          {/* Common controls */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-zinc-400">Decay (seconds)</label>
              <span className="text-xs text-zinc-500">{params.decay.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="2.0"
              step="0.05"
              value={params.decay}
              onChange={(e) => handleParamChange('decay', parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-zinc-400">Saturation</label>
              <span className="text-xs text-zinc-500">{Math.round(params.saturation * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={params.saturation}
              onChange={(e) => handleParamChange('saturation', parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-zinc-400">Duration (seconds)</label>
              <span className="text-xs text-zinc-500">{params.duration.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.1"
              value={params.duration}
              onChange={(e) => handleParamChange('duration', parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

