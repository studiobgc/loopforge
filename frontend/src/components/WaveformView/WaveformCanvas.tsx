/**
 * WaveformCanvas - Real waveform rendering from peak data
 */

import React, { useRef, useEffect, useState } from 'react';

interface WaveformCanvasProps {
  peaksUrl: string | null;
  color: string;
  height?: number;
  className?: string;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaksUrl,
  color,
  height = 60,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [error, setError] = useState(false);

  // Fetch peaks from backend
  useEffect(() => {
    if (!peaksUrl) {
      setPeaks(null);
      return;
    }

    setError(false);
    fetch(peaksUrl)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch peaks');
        return res.json();
      })
      .then(data => {
        // Backend returns { peaks: number[] } or just number[]
        const peakData = Array.isArray(data) ? data : data.peaks;
        setPeaks(peakData);
      })
      .catch(() => {
        setError(true);
        setPeaks(null);
      });
  }, [peaksUrl]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle resize
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = height;
    const centerY = h / 2;

    // Clear
    ctx.clearRect(0, 0, w, h);

    if (!peaks || peaks.length === 0) {
      // Draw placeholder line
      ctx.strokeStyle = `${color}30`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.stroke();
      return;
    }

    // Draw waveform bars
    const barWidth = w / peaks.length;
    ctx.fillStyle = color;

    peaks.forEach((peak, i) => {
      const barHeight = Math.max(2, peak * (h * 0.9));
      ctx.fillRect(
        i * barWidth,
        centerY - barHeight / 2,
        Math.max(1, barWidth - 0.5),
        barHeight
      );
    });
  }, [peaks, color, height]);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      // Trigger redraw by updating peaks reference
      setPeaks(p => p ? [...p] : null);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={`ba-waveform-canvas-container ${className}`} style={{ height }}>
      <canvas ref={canvasRef} className="ba-waveform-canvas" />
      {error && <div className="ba-waveform-error">⚠</div>}
    </div>
  );
};
