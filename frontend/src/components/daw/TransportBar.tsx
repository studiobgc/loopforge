/**
 * TransportBar - DAW-style transport controls
 * 
 * Professional transport with:
 * - Play/Stop/Record controls
 * - BPM with tap tempo
 * - Time display (beats/bars/time)
 * - Master volume with meter
 * - MIDI sync indicator
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Play, 
  Square, 
  SkipBack, 
  Circle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getAudioEngine, AudioAnalysis } from '../../audio/engine';

interface TransportBarProps {
  bpm: number;
  isPlaying: boolean;
  currentBeat: number;
  masterVolume: number;
  onBpmChange: (bpm: number) => void;
  onPlay: () => void;
  onStop: () => void;
  onSeek: (beat: number) => void;
  onVolumeChange: (volume: number) => void;
  className?: string;
}

export const TransportBar: React.FC<TransportBarProps> = ({
  bpm,
  isPlaying,
  currentBeat,
  masterVolume,
  onBpmChange,
  onPlay,
  onStop,
  onSeek,
  onVolumeChange,
  className = '',
}) => {
  const [meterLevel, setMeterLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);
  const tapTimesRef = useRef<number[]>([]);
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(bpm.toString());
  
  // Format time display
  const formatTime = (beats: number) => {
    const bars = Math.floor(beats / 4) + 1;
    const beatInBar = Math.floor(beats % 4) + 1;
    const sixteenths = Math.floor((beats % 1) * 4) + 1;
    return `${bars.toString().padStart(3, '0')}:${beatInBar}:${sixteenths}`;
  };
  
  const formatSeconds = (beats: number) => {
    const seconds = (beats / bpm) * 60;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };
  
  // Tap tempo
  const handleTap = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    
    // Reset if last tap was more than 2 seconds ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      taps.length = 0;
    }
    
    taps.push(now);
    
    // Keep only last 8 taps
    if (taps.length > 8) taps.shift();
    
    // Calculate average interval
    if (taps.length >= 2) {
      let totalInterval = 0;
      for (let i = 1; i < taps.length; i++) {
        totalInterval += taps[i] - taps[i - 1];
      }
      const avgInterval = totalInterval / (taps.length - 1);
      const newBpm = Math.round(60000 / avgInterval);
      
      if (newBpm >= 20 && newBpm <= 999) {
        onBpmChange(newBpm);
        setBpmInput(newBpm.toString());
      }
    }
  }, [onBpmChange]);
  
  // BPM input handling
  const handleBpmSubmit = useCallback(() => {
    const value = parseInt(bpmInput, 10);
    if (!isNaN(value) && value >= 20 && value <= 999) {
      onBpmChange(value);
    } else {
      setBpmInput(bpm.toString());
    }
    setIsEditingBpm(false);
  }, [bpmInput, bpm, onBpmChange]);
  
  // Audio metering
  useEffect(() => {
    const engine = getAudioEngine();
    
    const unsubscribe = engine.onAnalysis((analysis: AudioAnalysis) => {
      // Convert RMS to dB
      const rmsDb = 20 * Math.log10(Math.max(analysis.rms, 0.0001));
      const peakDb = 20 * Math.log10(Math.max(analysis.peak, 0.0001));
      
      // Normalize to 0-1 range (-60dB to 0dB)
      const normalizedRms = Math.max(0, Math.min(1, (rmsDb + 60) / 60));
      const normalizedPeak = Math.max(0, Math.min(1, (peakDb + 60) / 60));
      
      setMeterLevel(normalizedRms);
      setPeakLevel(normalizedPeak);
    });
    
    return unsubscribe;
  }, []);
  
  return (
    <div className={`flex items-center gap-6 px-5 py-3 glass-panel border-t-0 border-x-0 rounded-none ${className}`}>
      {/* Transport controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSeek(0)}
          className="p-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-white 
                     transition-all duration-150 active:scale-95 border border-zinc-700/50"
          title="Go to start"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        
        <button
          onClick={isPlaying ? onStop : onPlay}
          className={`p-4 rounded-xl transition-all duration-150 active:scale-95 ${
            isPlaying 
              ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-[0_0_20px_rgba(16,185,129,0.4),inset_0_1px_0_rgba(255,255,255,0.2)]' 
              : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 hover:text-white border border-zinc-600/50 hover:border-zinc-500/50 shadow-lg'
          }`}
          title={isPlaying ? 'Stop' : 'Play'}
        >
          {isPlaying ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        
        <button
          onClick={() => {}}
          className="p-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-500 hover:text-rose-400 
                     transition-all duration-150 active:scale-95 border border-zinc-700/50"
          title="Record (coming soon)"
        >
          <Circle className="w-4 h-4" />
        </button>
      </div>
      
      {/* Time display - Premium LCD style */}
      <div className="flex flex-col items-center min-w-[160px] px-4 py-2 rounded-xl bg-zinc-950/80 border border-zinc-800/50
                      shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]">
        <div className="font-mono text-2xl font-bold text-emerald-400 tracking-wider tabular-nums
                        text-glow-emerald">
          {formatTime(currentBeat)}
        </div>
        <div className="font-mono text-[10px] text-zinc-500 tracking-wide">
          {formatSeconds(currentBeat)}
        </div>
      </div>
      
      {/* BPM control - Premium style */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleTap}
          className="px-4 py-2 text-[10px] font-bold tracking-wider bg-gradient-to-b from-zinc-700 to-zinc-800 
                     hover:from-zinc-600 hover:to-zinc-700 rounded-lg transition-all duration-150 
                     text-zinc-300 hover:text-white border border-zinc-600/50 shadow-sm
                     active:scale-95"
          title="Tap to set tempo"
        >
          TAP
        </button>
        
        <div className="relative">
          {isEditingBpm ? (
            <input
              type="number"
              value={bpmInput}
              onChange={(e) => setBpmInput(e.target.value)}
              onBlur={handleBpmSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleBpmSubmit()}
              className="w-24 px-3 py-2 text-center font-mono text-xl font-bold bg-zinc-950 
                         border border-amber-500/50 rounded-xl text-amber-400 
                         focus:outline-none focus:border-amber-400 focus:shadow-[0_0_12px_rgba(245,158,11,0.3)]
                         shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]"
              min={20}
              max={999}
              autoFocus
            />
          ) : (
            <button
              onClick={() => {
                setIsEditingBpm(true);
                setBpmInput(bpm.toString());
              }}
              className="w-24 px-3 py-2 text-center font-mono text-xl font-bold bg-zinc-950/80 
                         hover:bg-zinc-900 rounded-xl transition-all duration-150 text-amber-400 
                         border border-zinc-800/50 hover:border-amber-500/30
                         shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]
                         text-glow-amber tabular-nums"
            >
              {bpm}
            </button>
          )}
          <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-zinc-600 uppercase tracking-widest">
            BPM
          </span>
        </div>
      </div>
      
      {/* Spacer */}
      <div className="flex-1" />
      
      {/* Master volume with premium meter */}
      <div className="flex items-center gap-4 px-4 py-2 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
        <button
          onClick={() => onVolumeChange(masterVolume > 0 ? 0 : 0.8)}
          className="text-zinc-400 hover:text-white transition-colors"
        >
          {masterVolume === 0 ? (
            <VolumeX className="w-5 h-5" />
          ) : (
            <Volume2 className="w-5 h-5" />
          )}
        </button>
        
        {/* Volume slider */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-28"
        />
        
        {/* Premium vertical meter */}
        <div className="flex gap-[2px] h-8 px-2 py-1 rounded-lg bg-zinc-950/80 border border-zinc-800/30">
          {[...Array(16)].map((_, i) => {
            const threshold = i / 16;
            const isActive = meterLevel > threshold;
            const isPeak = peakLevel > threshold && peakLevel <= (i + 1) / 16;
            
            let colorClass = 'bg-zinc-800/60';
            if (isActive) {
              if (threshold > 0.85) colorClass = 'bg-gradient-to-t from-red-500 to-red-400 shadow-[0_0_4px_rgba(239,68,68,0.6)]';
              else if (threshold > 0.7) colorClass = 'bg-gradient-to-t from-amber-500 to-amber-400';
              else colorClass = 'bg-gradient-to-t from-emerald-500 to-emerald-400';
            }
            if (isPeak) colorClass = 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]';
            
            return (
              <div
                key={i}
                className={`w-1.5 rounded-sm transition-all duration-75 ${colorClass}`}
              />
            );
          })}
        </div>
        
        {/* dB display */}
        <span className="font-mono text-[10px] font-medium text-zinc-500 w-10 text-right tabular-nums">
          {meterLevel > 0 
            ? `${Math.round(20 * Math.log10(meterLevel))}` 
            : '-∞'}
          <span className="text-zinc-600">dB</span>
        </span>
      </div>
      
      {/* Sync indicator */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Internal</span>
      </div>
    </div>
  );
};

export default TransportBar;
