/**
 * RichPad - MPC-style pad with waveform visualization
 */

import React, { useRef, useEffect } from 'react';
import type { PadData } from '../ForgeWorkstation/hooks/usePads';
import { STEM_COLORS } from '../../design/constants';

interface RichPadProps {
  data: PadData;
  isPlaying: boolean;
  onTrigger: () => void;
  disabled?: boolean;
}

export const RichPad: React.FC<RichPadProps> = ({ 
  data, 
  isPlaying, 
  onTrigger, 
  disabled = false 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw mini waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.loaded || !data.waveformPeaks?.length) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const centerY = h / 2;
    
    ctx.clearRect(0, 0, w, h);
    
    const color = data.stemId ? STEM_COLORS[data.stemId] || '#60b060' : '#60b060';
    ctx.fillStyle = isPlaying ? color : `${color}88`;
    
    const barWidth = w / data.waveformPeaks.length;
    data.waveformPeaks.forEach((peak, i) => {
      const barHeight = peak * (h * 0.8);
      ctx.fillRect(
        i * barWidth,
        centerY - barHeight / 2,
        Math.max(1, barWidth - 1),
        barHeight
      );
    });
  }, [data, isPlaying]);

  const duration = data.loaded ? (data.endTime - data.startTime) * 1000 : 0;

  return (
    <button
      className={`ba-rich-pad ${isPlaying ? 'playing' : ''} ${disabled ? 'disabled' : ''} ${data.loaded ? 'loaded' : ''}`}
      onClick={onTrigger}
      disabled={disabled || !data.loaded}
      aria-label={`Pad ${data.index + 1}${data.loaded ? `, ${duration.toFixed(0)}ms` : ''}`}
    >
      <canvas ref={canvasRef} className="ba-pad-waveform" />
      <div className="ba-pad-info">
        <span className="ba-pad-number">{data.index + 1}</span>
        {data.loaded && (
          <span className="ba-pad-duration">{duration.toFixed(0)}ms</span>
        )}
      </div>
      <div className="ba-pad-glow" />
    </button>
  );
};
