/**
 * RegionSelector - Mark In/Out region selection for waveform
 * 
 * Allows users to select a region of audio for slicing operations.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Scissors } from 'lucide-react';

interface RegionSelectorProps {
  duration: number;
  onRegionSelect: (start: number, end: number) => void;
  onSliceRegion?: (start: number, end: number) => void;
  disabled?: boolean;
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({
  duration,
  onRegionSelect,
  onSliceRegion,
  disabled = false,
}) => {
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const time = x * duration;
    
    setMarkIn(time);
    setMarkOut(null);
    setIsDragging(true);
  }, [duration, disabled]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || disabled || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = x * duration;
    
    setMarkOut(time);
  }, [isDragging, duration, disabled]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    
    if (markIn !== null && markOut !== null) {
      const start = Math.min(markIn, markOut);
      const end = Math.max(markIn, markOut);
      if (end - start > 0.1) { // Minimum 100ms region
        onRegionSelect(start, end);
      }
    }
  }, [isDragging, markIn, markOut, onRegionSelect]);

  const handleSlice = useCallback(() => {
    if (markIn !== null && markOut !== null && onSliceRegion) {
      const start = Math.min(markIn, markOut);
      const end = Math.max(markIn, markOut);
      onSliceRegion(start, end);
    }
  }, [markIn, markOut, onSliceRegion]);

  const clearRegion = useCallback(() => {
    setMarkIn(null);
    setMarkOut(null);
  }, []);

  const hasRegion = markIn !== null && markOut !== null;
  const regionStart = hasRegion ? Math.min(markIn!, markOut!) : 0;
  const regionEnd = hasRegion ? Math.max(markIn!, markOut!) : 0;
  const regionWidth = hasRegion ? ((regionEnd - regionStart) / duration) * 100 : 0;
  const regionLeft = hasRegion ? (regionStart / duration) * 100 : 0;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  };

  return (
    <div className="ba-region-selector">
      <div 
        ref={containerRef}
        className={`ba-region-track ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {hasRegion && (
          <div 
            className="ba-region-selection"
            style={{ 
              left: `${regionLeft}%`, 
              width: `${regionWidth}%` 
            }}
          />
        )}
        {markIn !== null && (
          <div 
            className="ba-region-marker in"
            style={{ left: `${(markIn / duration) * 100}%` }}
          />
        )}
        {markOut !== null && (
          <div 
            className="ba-region-marker out"
            style={{ left: `${(markOut / duration) * 100}%` }}
          />
        )}
      </div>
      
      {hasRegion && (
        <div className="ba-region-info">
          <span className="ba-region-times">
            {formatTime(regionStart)} → {formatTime(regionEnd)} 
            ({formatTime(regionEnd - regionStart)})
          </span>
          <div className="ba-region-actions">
            {onSliceRegion && (
              <button 
                className="ba-btn ba-btn-sm ba-btn-primary"
                onClick={handleSlice}
              >
                <Scissors size={12} /> Slice Region
              </button>
            )}
            <button 
              className="ba-btn ba-btn-sm"
              onClick={clearRegion}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
