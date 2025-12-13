/**
 * SpectrumAnalyzer - Real-time frequency spectrum visualization
 * 
 * Professional-grade spectrum analyzer with:
 * - Logarithmic frequency scale
 * - Peak hold
 * - Smoothed falloff
 * - Multiple display modes
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { getAudioEngine, AudioAnalysis } from '../../audio/engine';

interface SpectrumAnalyzerProps {
  className?: string;
  mode?: 'bars' | 'line' | 'mirror' | 'radial';
  barCount?: number;
  colorScheme?: 'spectrum' | 'fire' | 'ice' | 'neon';
  showPeaks?: boolean;
  smoothing?: number;
}

const COLOR_GRADIENTS = {
  spectrum: ['#22c55e', '#eab308', '#ef4444'],
  fire: ['#f97316', '#ef4444', '#fef08a'],
  ice: ['#06b6d4', '#3b82f6', '#8b5cf6'],
  neon: ['#00ffff', '#ff00ff', '#ffff00'],
};

export const SpectrumAnalyzer: React.FC<SpectrumAnalyzerProps> = ({
  className = '',
  mode = 'bars',
  barCount = 64,
  colorScheme = 'spectrum',
  showPeaks = true,
  smoothing = 0.8,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const peaksRef = useRef<Float32Array>(new Float32Array(barCount));
  const smoothedRef = useRef<Float32Array>(new Float32Array(barCount));
  
  const render = useCallback((analysis: AudioAnalysis) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    
    const { width, height } = rect;
    const spectrum = analysis.spectrum;
    
    // Clear
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);
    
    // Calculate bar values with logarithmic frequency mapping
    const nyquist = 22050; // Assuming 44100Hz sample rate
    const minFreq = 20;
    const maxFreq = 20000;
    
    const colors = COLOR_GRADIENTS[colorScheme];
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.5, colors[1]);
    gradient.addColorStop(1, colors[2]);
    
    const barWidth = width / barCount;
    const gap = Math.max(1, barWidth * 0.1);
    
    for (let i = 0; i < barCount; i++) {
      // Logarithmic frequency mapping
      const freqRatio = Math.pow(i / barCount, 2);
      const freq = minFreq * Math.pow(maxFreq / minFreq, freqRatio);
      const binIndex = Math.floor((freq / nyquist) * spectrum.length);
      
      // Get dB value and normalize
      const db = spectrum[Math.min(binIndex, spectrum.length - 1)] || -100;
      const normalized = Math.max(0, (db + 100) / 100); // -100dB to 0dB -> 0 to 1
      
      // Apply smoothing
      const current = smoothedRef.current[i];
      const target = normalized;
      smoothedRef.current[i] = current + (target - current) * (1 - smoothing);
      
      const value = smoothedRef.current[i];
      const barHeight = value * height * 0.9;
      
      // Update peaks
      if (showPeaks) {
        if (value > peaksRef.current[i]) {
          peaksRef.current[i] = value;
        } else {
          peaksRef.current[i] *= 0.995; // Slow falloff
        }
      }
      
      const x = i * barWidth + gap / 2;
      const actualBarWidth = barWidth - gap;
      
      if (mode === 'bars') {
        // Draw bar
        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - barHeight, actualBarWidth, barHeight);
        
        // Draw peak
        if (showPeaks) {
          const peakY = height - peaksRef.current[i] * height * 0.9;
          ctx.fillStyle = colors[2];
          ctx.fillRect(x, peakY - 2, actualBarWidth, 2);
        }
      } else if (mode === 'mirror') {
        const halfHeight = barHeight / 2;
        ctx.fillStyle = gradient;
        ctx.fillRect(x, height / 2 - halfHeight, actualBarWidth, halfHeight * 2);
      }
    }
    
    if (mode === 'line') {
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      for (let i = 0; i < barCount; i++) {
        const value = smoothedRef.current[i];
        const x = (i / barCount) * width;
        const y = height - value * height * 0.9;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      
      ctx.stroke();
      
      // Fill under the line
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    
    // Draw dB scale
    ctx.font = '9px monospace';
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'right';
    for (let db = 0; db >= -60; db -= 12) {
      const y = height - ((db + 100) / 100) * height * 0.9;
      ctx.fillText(`${db}dB`, width - 4, y + 3);
    }
    
  }, [barCount, colorScheme, mode, showPeaks, smoothing]);
  
  useEffect(() => {
    const engine = getAudioEngine();
    
    // Subscribe to audio analysis
    const unsubscribe = engine.onAnalysis(render);
    
    return () => {
      unsubscribe();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [render]);
  
  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default SpectrumAnalyzer;
