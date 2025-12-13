/**
 * SliceGrid - Interactive slice pad with real playback
 * 
 * Features:
 * - Click/tap to play slices with velocity sensitivity
 * - Drag to reorder
 * - Visual feedback during playback
 * - Energy/transient visualization per slice
 * - MIDI-style velocity (click position = velocity)
 * - Keyboard triggers (1-8, Q-I for 16 pads)
 * - Cross-stem trigger visualization
 */

import React, { useState, useCallback, useRef } from 'react';
import { getAudioEngine } from '../../audio/engine';
import { cn } from '../../lib/utils';

interface Slice {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  energy: number;
  transientStrength: number;
  brightness: number;
}

interface SliceGridProps {
  slices: Slice[];
  stemId: string;
  stemRole: 'drums' | 'bass' | 'vocals' | 'other';
  columns?: number;
  onSlicePlay?: (index: number, velocity: number) => void;
  onSliceSelect?: (index: number) => void;
  selectedSlice?: number;
  activeSlices?: Set<number>;  // Currently playing slices
  sliceProbabilities?: number[];  // Per-slice probability (0-1)
  onProbabilityChange?: (index: number, probability: number) => void;
  showProbabilities?: boolean;  // Show probability controls
  className?: string;
}

// Keyboard mapping for quick triggers
const KEY_MAP: Record<string, number> = {
  '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7,
  'q': 8, 'w': 9, 'e': 10, 'r': 11, 't': 12, 'y': 13, 'u': 14, 'i': 15,
  'a': 16, 's': 17, 'd': 18, 'f': 19, 'g': 20, 'h': 21, 'j': 22, 'k': 23,
  'z': 24, 'x': 25, 'c': 26, 'v': 27, 'b': 28, 'n': 29, 'm': 30, ',': 31,
};

// Premium MPC-style pad colors with depth and glow
const ROLE_COLORS = {
  drums: {
    bg: 'from-orange-950/60 to-orange-950/30',
    border: 'border-orange-600/40',
    active: 'from-orange-500 to-orange-600',
    glow: 'shadow-[0_0_20px_rgba(249,115,22,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]',
    ring: 'ring-orange-500/70',
    accent: 'bg-orange-500',
    text: 'text-orange-400',
  },
  bass: {
    bg: 'from-blue-950/60 to-blue-950/30',
    border: 'border-blue-600/40',
    active: 'from-blue-500 to-blue-600',
    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]',
    ring: 'ring-blue-500/70',
    accent: 'bg-blue-500',
    text: 'text-blue-400',
  },
  vocals: {
    bg: 'from-purple-950/60 to-purple-950/30',
    border: 'border-purple-600/40',
    active: 'from-purple-500 to-purple-600',
    glow: 'shadow-[0_0_20px_rgba(168,85,247,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]',
    ring: 'ring-purple-500/70',
    accent: 'bg-purple-500',
    text: 'text-purple-400',
  },
  other: {
    bg: 'from-emerald-950/60 to-emerald-950/30',
    border: 'border-emerald-600/40',
    active: 'from-emerald-500 to-emerald-600',
    glow: 'shadow-[0_0_20px_rgba(16,185,129,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]',
    ring: 'ring-emerald-500/70',
    accent: 'bg-emerald-500',
    text: 'text-emerald-400',
  },
};

export const SliceGrid: React.FC<SliceGridProps> = ({
  slices,
  stemId,
  stemRole,
  columns = 8,
  onSlicePlay,
  onSliceSelect,
  selectedSlice,
  activeSlices = new Set(),
  sliceProbabilities = [],
  onProbabilityChange,
  showProbabilities = false,
  className = '',
}) => {
  const [playingSlices, setPlayingSlices] = useState<Set<number>>(new Set());
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const audioEngine = useRef(getAudioEngine());
  
  const colors = ROLE_COLORS[stemRole];
  
  // Calculate velocity from click position within pad
  const getVelocityFromEvent = useCallback((e: React.MouseEvent, rect: DOMRect): number => {
    // Click higher = louder (like MPC pads)
    const y = e.clientY - rect.top;
    const normalizedY = 1 - (y / rect.height);  // 0 at bottom, 1 at top
    return 0.3 + normalizedY * 0.7;  // 0.3 to 1.0 range
  }, []);
  
  // Play a slice
  const playSlice = useCallback((index: number, velocity: number = 0.8) => {
    const slice = slices[index];
    if (!slice) return;
    
    // Trigger in audio engine
    audioEngine.current.triggerSlice(stemId, index, {
      velocity,
      pitch: 0,
      pan: 0,
    });
    
    // Visual feedback
    setPlayingSlices(prev => new Set(prev).add(index));
    setTimeout(() => {
      setPlayingSlices(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }, Math.min(slice.duration * 1000, 300));
    
    // Callbacks
    onSlicePlay?.(index, velocity);
  }, [slices, stemId, onSlicePlay]);
  
  // Keyboard handler - DISABLED: DAWWorkspace handles keyboard input to avoid duplicate triggers
  // useEffect(() => {
  //   const handleKeyDown = (e: KeyboardEvent) => {
  //     if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  //     if (e.metaKey || e.ctrlKey || e.altKey) return;
  //     const sliceIndex = KEY_MAP[e.key.toLowerCase()];
  //     if (sliceIndex !== undefined && sliceIndex < slices.length) {
  //       e.preventDefault();
  //       playSlice(sliceIndex, 0.8);
  //     }
  //   };
  //   window.addEventListener('keydown', handleKeyDown);
  //   return () => window.removeEventListener('keydown', handleKeyDown);
  // }, [slices.length, playSlice]);
  
  // Get the key hint for a slice
  const getKeyHint = (index: number): string | null => {
    const entry = Object.entries(KEY_MAP).find(([_, i]) => i === index);
    return entry ? entry[0].toUpperCase() : null;
  };
  
  // Compute energy gradient for a slice
  const getEnergyGradient = (slice: Slice) => {
    const hue = slice.brightness * 60;  // 0 = red (bass), 60 = yellow (high)
    const saturation = 50 + slice.energy * 50;
    return `linear-gradient(180deg, 
      hsla(${hue}, ${saturation}%, 50%, ${slice.energy * 0.5}) 0%,
      transparent 100%
    )`;
  };
  
  // Empty state
  if (slices.length === 0) {
    return (
      <div className={cn('flex items-center justify-center p-12 text-zinc-500', className)}>
        <div className="text-center animate-fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-zinc-800/80 to-zinc-900/80 
                          border border-zinc-700/50 flex items-center justify-center
                          shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <div className="text-sm font-medium text-zinc-400">No slices loaded</div>
          <div className="text-xs text-zinc-600 mt-1">Select a moment or process stem to create slices</div>
        </div>
      </div>
    );
  }
  
  return (
    <div
      ref={gridRef}
      className={cn('select-none p-1', className)}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: '6px',
      }}
    >
      {slices.map((slice, index) => {
        const isPlaying = playingSlices.has(index) || activeSlices.has(index);
        const isSelected = selectedSlice === index;
        const isHovered = hoveredSlice === index;
        const keyHint = getKeyHint(index);
        const probability = sliceProbabilities[index] ?? 1;
        
        return (
          <div
            key={`${stemId}-${index}`}
            className={cn(
              'group relative aspect-square rounded-xl cursor-pointer',
              'border backdrop-blur-sm',
              'transition-all duration-100 ease-out',
              // Base gradient background
              `bg-gradient-to-b ${colors.bg}`,
              colors.border,
              // Playing state - vibrant glow
              isPlaying && `bg-gradient-to-b ${colors.active} ${colors.glow} scale-95`,
              // Selected state
              isSelected && `ring-2 ${colors.ring} ring-offset-1 ring-offset-zinc-950`,
              // Hover state - subtle lift
              isHovered && !isPlaying && 'scale-[1.02] border-opacity-60 shadow-lg',
              // Pressed state
              'active:scale-95 active:brightness-90',
            )}
            onMouseDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const velocity = getVelocityFromEvent(e, rect);
              playSlice(index, velocity);
              onSliceSelect?.(index);
            }}
            onMouseEnter={() => setHoveredSlice(index)}
            onMouseLeave={() => setHoveredSlice(null)}
          >
            {/* Inner highlight gradient */}
            <div className={cn(
              'absolute inset-0 rounded-xl opacity-0 transition-opacity duration-100',
              'bg-gradient-to-t from-transparent via-transparent to-white/5',
              isHovered && !isPlaying && 'opacity-100',
            )} />
            
            {/* Energy visualization background */}
            {!isPlaying && (
              <div 
                className="absolute inset-0 rounded-xl opacity-40"
                style={{ background: getEnergyGradient(slice) }}
              />
            )}
            
            {/* Slice index - premium badge style */}
            <div className={cn(
              'absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold',
              'bg-black/40 backdrop-blur-sm',
              isPlaying ? 'text-white' : colors.text,
            )}>
              {index + 1}
            </div>
            
            {/* Key hint - subtle */}
            {keyHint && (
              <div className={cn(
                'absolute top-1.5 right-1.5 text-[8px] font-mono font-medium uppercase',
                'px-1 py-0.5 rounded bg-black/30',
                isPlaying ? 'text-white/80' : 'text-zinc-500',
              )}>
                {keyHint}
              </div>
            )}
            
            {/* Center content area */}
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Transient strength indicator */}
              {slice.transientStrength > 0.5 && !showProbabilities && (
                <div className={cn(
                  'w-3 h-3 rounded-full transition-all duration-75',
                  isPlaying 
                    ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]' 
                    : 'bg-zinc-600/60',
                  slice.transientStrength > 0.8 && !isPlaying && 'animate-pulse',
                )} 
                style={{
                  transform: `scale(${0.5 + slice.transientStrength * 0.5})`,
                }}
                />
              )}
              
              {/* Probability control overlay */}
              {showProbabilities && (
                <div 
                  className="absolute inset-2 flex flex-col items-center justify-center bg-black/40 rounded-lg backdrop-blur-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={cn(
                    'text-xs font-bold tabular-nums mb-1',
                    probability < 0.3 ? 'text-zinc-500' : probability < 0.7 ? 'text-zinc-300' : 'text-white',
                  )}>
                    {Math.round(probability * 100)}%
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(probability * 100)}
                    onChange={(e) => onProbabilityChange?.(index, parseInt(e.target.value) / 100)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-4/5"
                  />
                </div>
              )}
            </div>
            
            {/* Energy meter bar - premium style */}
            <div className="absolute bottom-1.5 left-1.5 right-1.5 h-1 rounded-full bg-black/40 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-75',
                  isPlaying ? 'bg-white' : colors.accent,
                )}
                style={{ 
                  width: `${slice.energy * 100}%`,
                  boxShadow: isPlaying ? '0 0 8px rgba(255,255,255,0.6)' : 'none',
                }}
              />
            </div>
            
            {/* Playing ripple effect */}
            {isPlaying && (
              <>
                <div className="absolute inset-0 rounded-xl bg-white/20 animate-ping pointer-events-none" />
                <div className="absolute inset-0 rounded-xl border-2 border-white/40 animate-pulse pointer-events-none" />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SliceGrid;
