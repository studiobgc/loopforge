/**
 * MomentsTimeline - Octatrack-style moment navigation for long samples
 * 
 * Features:
 * - Visual timeline showing detected moments (hits, phrases, textures, changes)
 * - Click moment → jump to that region
 * - Mark In/Out for manual region selection
 * - "Send to Pads" to create slice bank from region
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  Zap, 
  Mic2, 
  Waves, 
  TrendingUp,
  Play,
  Square,
  Scissors,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../api/client';
import { cn } from '../../lib/utils';

interface Moment {
  id: string;
  type: 'hit' | 'phrase' | 'texture' | 'change';
  start_time: number;
  end_time: number;
  duration: number;
  energy: number;
  brightness: number;
  label: string;
  confidence: number;
}

interface MomentsTimelineProps {
  sessionId: string;
  audioPath: string;
  duration: number;
  initialMoments?: Moment[];  // Pre-detected moments from upload flow
  onRegionSlicesCreated?: (bankId: string, slices: any[]) => void;
  className?: string;
}

const MOMENT_COLORS = {
  hit: { bg: 'bg-orange-500', border: 'border-orange-400', text: 'text-orange-400' },
  phrase: { bg: 'bg-purple-500', border: 'border-purple-400', text: 'text-purple-400' },
  texture: { bg: 'bg-cyan-500', border: 'border-cyan-400', text: 'text-cyan-400' },
  change: { bg: 'bg-yellow-500', border: 'border-yellow-400', text: 'text-yellow-400' },
};

const MOMENT_ICONS = {
  hit: Zap,
  phrase: Mic2,
  texture: Waves,
  change: TrendingUp,
};

export const MomentsTimeline: React.FC<MomentsTimelineProps> = ({
  sessionId,
  audioPath,
  duration,
  initialMoments,
  onRegionSlicesCreated,
  className = '',
}) => {
  const [moments, setMoments] = useState<Moment[]>(initialMoments ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [bias, setBias] = useState<'balanced' | 'hits' | 'phrases' | 'textures'>('balanced');
  
  // Mark In/Out state
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [isCreatingSlices, setIsCreatingSlices] = useState(false);
  
  // Playback preview
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewMoment, setPreviewMoment] = useState<Moment | null>(null);
  
  const timelineRef = useRef<HTMLDivElement>(null);

  // I/O keyboard shortcuts for Mark In/Out (Octatrack style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        // Set Mark In to current playhead position (use 0 for now, could be connected to transport)
        const currentTime = markIn ?? 0;
        setMarkIn(currentTime);
        console.log('[Moments] Mark IN:', currentTime);
      }
      if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        // Set Mark Out
        const currentTime = markOut ?? duration;
        setMarkOut(currentTime);
        console.log('[Moments] Mark OUT:', currentTime);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [duration, markIn, markOut]);

  // Detect moments
  const detectMoments = useCallback(async () => {
    if (!audioPath) return;
    
    setIsLoading(true);
    try {
      const result = await api.detectMoments(audioPath, bias);
      setMoments(result.moments);
    } catch (e) {
      console.error('[MomentsTimeline] Failed to detect moments:', e);
    } finally {
      setIsLoading(false);
    }
  }, [audioPath, bias]);

  // Auto-detect on mount or bias change (skip if pre-detected moments provided)
  useEffect(() => {
    if (audioPath && moments.length === 0) {
      detectMoments();
    }
  }, [audioPath, bias, detectMoments, moments.length]);

  // Group moments by type for stats
  const momentStats = useMemo(() => {
    const stats = { hit: 0, phrase: 0, texture: 0, change: 0 };
    for (const m of moments) {
      stats[m.type]++;
    }
    return stats;
  }, [moments]);

  // Handle moment click - jump to that time
  const handleMomentClick = useCallback((moment: Moment) => {
    // Set mark in/out to this moment's region
    setMarkIn(moment.start_time);
    setMarkOut(moment.end_time);
    setPreviewMoment(moment);
  }, []);

  // Preview the selected region
  const handlePreview = useCallback(async () => {
    if (markIn === null || markOut === null) return;
    
    // For now, just log - full preview would need streaming audio
    console.log(`[MomentsTimeline] Preview region: ${markIn.toFixed(2)}s - ${markOut.toFixed(2)}s`);
    setIsPreviewPlaying(true);
    
    // Auto-stop after region duration
    setTimeout(() => setIsPreviewPlaying(false), (markOut - markIn) * 1000);
  }, [markIn, markOut]);

  // Send region to pads (create slice bank from region)
  const handleSendToPads = useCallback(async () => {
    if (markIn === null || markOut === null) return;
    
    setIsCreatingSlices(true);
    try {
      const result = await api.createRegionSlices({
        sessionId,
        audioPath,
        startTime: markIn,
        endTime: markOut,
        role: previewMoment?.type === 'hit' ? 'drums' : 
              previewMoment?.type === 'phrase' ? 'vocals' : 'other',
      });
      
      onRegionSlicesCreated?.(result.id, result.slices);
      console.log(`[MomentsTimeline] Created ${result.num_slices} slices from region`);
    } catch (e) {
      console.error('[MomentsTimeline] Failed to create region slices:', e);
    } finally {
      setIsCreatingSlices(false);
    }
  }, [markIn, markOut, sessionId, audioPath, previewMoment, onRegionSlicesCreated]);

  // Handle timeline click for manual mark in/out
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * duration;
    
    // Shift-click sets mark out, regular click sets mark in
    if (e.shiftKey && markIn !== null) {
      setMarkOut(Math.max(markIn, time));
    } else {
      setMarkIn(time);
      setMarkOut(null);
    }
  }, [duration, markIn]);

  // Format time as mm:ss.ms
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn('bg-zinc-900/50 rounded-lg border border-zinc-800', className)}>
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800/30"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
            Moments
          </span>
          <span className="text-[10px] text-zinc-500">
            ({moments.length} found)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Bias selector */}
          <select
            value={bias}
            onChange={(e) => setBias(e.target.value as any)}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-300"
          >
            <option value="balanced">Balanced</option>
            <option value="hits">Hits</option>
            <option value="phrases">Phrases</option>
            <option value="textures">Textures</option>
          </select>
          
          <button
            onClick={(e) => { e.stopPropagation(); detectMoments(); }}
            disabled={isLoading}
            className="p-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3 h-3', isLoading && 'animate-spin')} />
          </button>
          
          {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
        </div>
      </div>

      {isExpanded && (
        <div className="p-3 space-y-3">
          {/* Stats row */}
          <div className="flex items-center gap-4 text-[10px]">
            {Object.entries(momentStats).map(([type, count]) => {
              const Icon = MOMENT_ICONS[type as keyof typeof MOMENT_ICONS];
              const colors = MOMENT_COLORS[type as keyof typeof MOMENT_COLORS];
              return (
                <div key={type} className={cn('flex items-center gap-1', colors.text)}>
                  <Icon className="w-3 h-3" />
                  <span>{count}</span>
                </div>
              );
            })}
          </div>

          {/* Timeline visualization */}
          <div
            ref={timelineRef}
            className="relative h-16 bg-zinc-800/50 rounded cursor-crosshair overflow-hidden"
            onClick={handleTimelineClick}
          >
            {/* Time markers */}
            <div className="absolute inset-x-0 top-0 h-4 flex text-[8px] text-zinc-600">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex-1 border-r border-zinc-700/50 px-1">
                  {formatTime((duration / 4) * i)}
                </div>
              ))}
            </div>

            {/* Moments */}
            <div className="absolute inset-x-0 top-4 bottom-0">
              {moments.map((m) => {
                const left = (m.start_time / duration) * 100;
                const width = Math.max(0.5, ((m.end_time - m.start_time) / duration) * 100);
                const colors = MOMENT_COLORS[m.type];
                const isSelected = previewMoment?.id === m.id;
                
                return (
                  <button
                    key={m.id}
                    className={cn(
                      'absolute top-1 h-8 rounded-sm transition-all hover:brightness-125',
                      colors.bg,
                      isSelected && 'ring-2 ring-white/50',
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      minWidth: '4px',
                      opacity: 0.3 + m.confidence * 0.7,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMomentClick(m);
                    }}
                    title={m.label}
                  />
                );
              })}

              {/* Mark In/Out region */}
              {markIn !== null && markOut !== null && (
                <div
                  className="absolute top-0 bottom-0 bg-amber-500/20 border-l-2 border-r-2 border-amber-400"
                  style={{
                    left: `${(markIn / duration) * 100}%`,
                    width: `${((markOut - markIn) / duration) * 100}%`,
                  }}
                />
              )}

              {/* Mark In line */}
              {markIn !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-green-400"
                  style={{ left: `${(markIn / duration) * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* Mark In/Out controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px]">
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">IN:</span>
                <span className="text-green-400 font-mono">
                  {markIn !== null ? formatTime(markIn) : '--:--'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">OUT:</span>
                <span className="text-red-400 font-mono">
                  {markOut !== null ? formatTime(markOut) : '--:--'}
                </span>
              </div>
              {markIn !== null && markOut !== null && (
                <div className="text-zinc-400">
                  ({(markOut - markIn).toFixed(2)}s)
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePreview}
                disabled={markIn === null || markOut === null}
                className={cn(
                  'px-2 py-1 text-[10px] rounded flex items-center gap-1 transition-all',
                  markIn !== null && markOut !== null
                    ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed',
                )}
              >
                {isPreviewPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                Preview
              </button>

              <button
                onClick={handleSendToPads}
                disabled={markIn === null || markOut === null || isCreatingSlices}
                className={cn(
                  'px-2 py-1 text-[10px] rounded flex items-center gap-1 transition-all',
                  markIn !== null && markOut !== null
                    ? 'bg-amber-600 text-white hover:bg-amber-500'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed',
                )}
              >
                <Scissors className="w-3 h-3" />
                {isCreatingSlices ? 'Creating...' : 'Send to Pads'}
              </button>
            </div>
          </div>

          {/* Moment list (compact) */}
          {moments.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-1">
              {moments.slice(0, 20).map((m) => {
                const Icon = MOMENT_ICONS[m.type];
                const colors = MOMENT_COLORS[m.type];
                const isSelected = previewMoment?.id === m.id;
                
                return (
                  <button
                    key={m.id}
                    onClick={() => handleMomentClick(m)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-all',
                      'hover:bg-zinc-800/50',
                      isSelected && 'bg-zinc-800 ring-1 ring-amber-500/50',
                    )}
                  >
                    <Icon className={cn('w-3 h-3 flex-shrink-0', colors.text)} />
                    <span className="text-[10px] text-zinc-400 font-mono w-12">
                      {formatTime(m.start_time)}
                    </span>
                    <span className="text-[10px] text-zinc-300 truncate flex-1">
                      {m.label}
                    </span>
                    <span className="text-[9px] text-zinc-600">
                      {m.duration.toFixed(1)}s
                    </span>
                  </button>
                );
              })}
              {moments.length > 20 && (
                <div className="text-[10px] text-zinc-600 text-center py-1">
                  +{moments.length - 20} more moments
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && moments.length === 0 && (
            <div className="text-center py-4 text-zinc-600 text-xs">
              No moments detected. Try a different bias or check the audio file.
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="text-center py-4 text-zinc-500 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Analyzing audio...
            </div>
          )}

          {/* Instructions */}
          <div className="text-[9px] text-zinc-600 border-t border-zinc-800 pt-2">
            Click timeline to set Mark In • Shift+click to set Mark Out • Click moment to select region
          </div>
        </div>
      )}
    </div>
  );
};

export default MomentsTimeline;
