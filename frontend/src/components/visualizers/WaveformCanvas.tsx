/**
 * WaveformCanvas - GPU-accelerated waveform visualization
 * 
 * Features:
 * - Responsive canvas rendering
 * - Slice markers with hover states
 * - Playhead tracking
 * - Zoom & scroll
 * - Click-to-seek
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';

interface Slice {
  startTime: number;
  endTime: number;
  energy: number;
}

interface WaveformCanvasProps {
  audioBuffer: AudioBuffer | null;
  slices?: Slice[];
  playheadPosition?: number;  // 0-1
  zoom?: number;             // 1 = fit to width
  scrollOffset?: number;     // 0-1
  selectedSliceIndex?: number;
  playingSliceIndex?: number; // Currently playing slice - highlights region
  onSliceClick?: (index: number) => void;
  onSeek?: (position: number) => void;
  className?: string;
  colorScheme?: 'default' | 'neon' | 'minimal';
}

const COLOR_SCHEMES = {
  default: {
    background: '#0a0a0f',
    waveform: '#3b82f6',
    waveformPeak: '#60a5fa',
    sliceLine: 'rgba(239, 68, 68, 0.8)',
    sliceActive: 'rgba(34, 197, 94, 0.9)',
    sliceHover: 'rgba(250, 204, 21, 0.8)',
    playhead: '#22c55e',
    grid: 'rgba(255, 255, 255, 0.05)',
  },
  neon: {
    background: '#000000',
    waveform: '#00ffff',
    waveformPeak: '#ff00ff',
    sliceLine: '#ff0080',
    sliceActive: '#00ff80',
    sliceHover: '#ffff00',
    playhead: '#00ff00',
    grid: 'rgba(0, 255, 255, 0.1)',
  },
  minimal: {
    background: '#18181b',
    waveform: '#a1a1aa',
    waveformPeak: '#e4e4e7',
    sliceLine: 'rgba(161, 161, 170, 0.5)',
    sliceActive: '#ffffff',
    sliceHover: '#d4d4d8',
    playhead: '#f4f4f5',
    grid: 'rgba(255, 255, 255, 0.03)',
  },
};

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  audioBuffer,
  slices = [],
  playheadPosition = 0,
  zoom = 1,
  scrollOffset = 0,
  selectedSliceIndex,
  playingSliceIndex,
  onSliceClick,
  onSeek,
  className = '',
  colorScheme = 'default',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  const colors = COLOR_SCHEMES[colorScheme];
  
  // Cache computed waveform data
  const waveformCache = useRef<Float32Array | null>(null);
  const lastBufferRef = useRef<AudioBuffer | null>(null);
  
  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setDimensions({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  
  // Compute waveform peaks
  const computeWaveform = useCallback((buffer: AudioBuffer, targetSamples: number): Float32Array => {
    const channelData = buffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / targetSamples);
    const peaks = new Float32Array(targetSamples * 2); // min and max for each pixel
    
    for (let i = 0; i < targetSamples; i++) {
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      
      let min = 0;
      let max = 0;
      
      for (let j = start; j < end; j++) {
        const sample = channelData[j];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      
      peaks[i * 2] = min;
      peaks[i * 2 + 1] = max;
    }
    
    return peaks;
  }, []);
  
  // Main render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;
    
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    
    // Set canvas resolution for HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    ctx.scale(dpr, dpr);
    
    const { width, height } = dimensions;
    const centerY = height / 2;
    
    // Clear
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    const gridSpacing = 50;
    for (let x = 0; x < width; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    // Draw waveform
    if (audioBuffer) {
      // Recompute if buffer changed
      if (audioBuffer !== lastBufferRef.current || !waveformCache.current) {
        waveformCache.current = computeWaveform(audioBuffer, width * zoom);
        lastBufferRef.current = audioBuffer;
      }
      
      const peaks = waveformCache.current;
      const visibleWidth = width / zoom;
      const startPixel = Math.floor(scrollOffset * (peaks.length / 2 - visibleWidth));
      
      // Create gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, colors.waveformPeak);
      gradient.addColorStop(0.5, colors.waveform);
      gradient.addColorStop(1, colors.waveformPeak);
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      
      for (let x = 0; x < width; x++) {
        const dataIndex = Math.floor(startPixel + x * zoom) * 2;
        if (dataIndex >= peaks.length) break;
        
        const min = peaks[dataIndex] || 0;
        const max = peaks[dataIndex + 1] || 0;
        
        const yMin = centerY + min * centerY * 0.9;
        const yMax = centerY + max * centerY * 0.9;
        
        ctx.moveTo(x, yMin);
        ctx.lineTo(x, yMax);
      }
      
      ctx.stroke();
      ctx.fillStyle = colors.waveform;
      ctx.globalAlpha = 0.3;
      
      // Fill waveform
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const dataIndex = Math.floor(startPixel + x * zoom) * 2;
        if (dataIndex >= peaks.length) break;
        
        const max = peaks[dataIndex + 1] || 0;
        const y = centerY - max * centerY * 0.9;
        
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      
      for (let x = width - 1; x >= 0; x--) {
        const dataIndex = Math.floor(startPixel + x * zoom) * 2;
        if (dataIndex >= peaks.length) continue;
        
        const min = peaks[dataIndex] || 0;
        const y = centerY - min * centerY * 0.9;
        ctx.lineTo(x, y);
      }
      
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    
    // Draw slices
    if (audioBuffer && slices.length > 0) {
      const duration = audioBuffer.duration;
      
      // Draw playing slice highlight first (behind everything)
      if (playingSliceIndex !== undefined && slices[playingSliceIndex]) {
        const playingSlice = slices[playingSliceIndex];
        const x1 = (playingSlice.startTime / duration) * width;
        const x2 = (playingSlice.endTime / duration) * width;
        
        // Bright highlight for playing region
        ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
        ctx.fillRect(x1, 0, x2 - x1, height);
        
        // Animated border glow
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, 0, x2 - x1, height);
      }
      
      slices.forEach((slice, index) => {
        const x = (slice.startTime / duration) * width;
        
        // Determine color
        let color = colors.sliceLine;
        if (index === playingSliceIndex) color = '#22c55e';
        else if (index === selectedSliceIndex) color = colors.sliceActive;
        else if (index === hoveredSlice) color = colors.sliceHover;
        
        // Draw line
        ctx.strokeStyle = color;
        ctx.lineWidth = index === selectedSliceIndex ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        
        // Draw energy indicator
        const barHeight = slice.energy * 20;
        ctx.fillStyle = color;
        ctx.fillRect(x - 1, height - barHeight, 3, barHeight);
        
        // Draw slice index
        if (index === hoveredSlice || index === selectedSliceIndex) {
          ctx.font = '10px monospace';
          ctx.fillStyle = color;
          ctx.fillText(`${index}`, x + 4, 12);
        }
      });
    }
    
    // Draw playhead
    if (audioBuffer && playheadPosition > 0) {
      const x = playheadPosition * width;
      
      ctx.strokeStyle = colors.playhead;
      ctx.lineWidth = 2;
      ctx.shadowColor = colors.playhead;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.shadowBlur = 0;
      
      // Triangle head
      ctx.fillStyle = colors.playhead;
      ctx.beginPath();
      ctx.moveTo(x - 6, 0);
      ctx.lineTo(x + 6, 0);
      ctx.lineTo(x, 10);
      ctx.closePath();
      ctx.fill();
    }
    
  }, [audioBuffer, slices, playheadPosition, zoom, scrollOffset, selectedSliceIndex, hoveredSlice, dimensions, colors, computeWaveform]);
  
  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!audioBuffer || slices.length === 0) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const position = x / rect.width;
    const time = position * audioBuffer.duration;
    
    // Find hovered slice
    const tolerance = audioBuffer.duration * 0.01; // 1% tolerance
    const hoveredIndex = slices.findIndex((slice, i) => 
      Math.abs(slice.startTime - time) < tolerance ||
      (time >= slice.startTime && time < (slices[i + 1]?.startTime ?? audioBuffer.duration))
    );
    
    setHoveredSlice(hoveredIndex >= 0 ? hoveredIndex : null);
  }, [audioBuffer, slices]);
  
  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const position = x / rect.width;
    
    if (hoveredSlice !== null && onSliceClick) {
      onSliceClick(hoveredSlice);
    } else if (onSeek) {
      onSeek(position);
    }
  }, [hoveredSlice, onSliceClick, onSeek]);
  
  return (
    <div 
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ minHeight: 100 }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        style={{ width: '100%', height: '100%' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredSlice(null)}
        onClick={handleClick}
      />
      
      {/* Slice count overlay */}
      {slices.length > 0 && (
        <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-zinc-400 font-mono">
          {slices.length} slices
        </div>
      )}
    </div>
  );
};

export default WaveformCanvas;
