/**
 * Sequencer - Euclidean pattern generator UI
 */

import React, { useState, useCallback } from 'react';
import { Play, Pause, RefreshCw } from 'lucide-react';

interface SequencerProps {
  bankId: string | null;
  sessionId: string | null;
  bpm: number;
  onGenerateSequence: (params: {
    mode: 'euclidean' | 'probability' | 'random';
    euclideanHits: number;
    euclideanSteps: number;
    euclideanRotation: number;
  }) => Promise<void>;
  disabled?: boolean;
}

export const Sequencer: React.FC<SequencerProps> = ({
  bankId,
  sessionId,
  bpm,
  onGenerateSequence,
  disabled = false,
}) => {
  const [mode, setMode] = useState<'euclidean' | 'probability' | 'random'>('euclidean');
  const [hits, setHits] = useState(4);
  const [steps, setSteps] = useState(16);
  const [rotation, setRotation] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Generate Euclidean pattern visualization
  const generatePattern = useCallback(() => {
    const pattern: boolean[] = new Array(steps).fill(false);
    if (hits === 0) return pattern;
    
    // Bresenham's algorithm for Euclidean distribution
    let bucket = 0;
    for (let i = 0; i < steps; i++) {
      bucket += hits;
      if (bucket >= steps) {
        bucket -= steps;
        pattern[(i + rotation) % steps] = true;
      }
    }
    return pattern;
  }, [hits, steps, rotation]);

  const pattern = generatePattern();

  const handleGenerate = async () => {
    if (!bankId || !sessionId) return;
    setIsGenerating(true);
    try {
      await onGenerateSequence({
        mode,
        euclideanHits: hits,
        euclideanSteps: steps,
        euclideanRotation: rotation,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="ba-sequencer">
      <div className="ba-sequencer-header">
        <h3>Sequencer</h3>
        <div className="ba-sequencer-controls">
          <button 
            className="ba-transport-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={disabled}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="ba-lcd-mini">{bpm} BPM</span>
        </div>
      </div>

      {/* Mode selector */}
      <div className="ba-sequencer-mode">
        <label>Mode</label>
        <select 
          value={mode} 
          onChange={e => setMode(e.target.value as typeof mode)}
          className="ba-select-mini"
        >
          <option value="euclidean">Euclidean</option>
          <option value="probability">Probability</option>
          <option value="random">Random</option>
        </select>
      </div>

      {/* Euclidean parameters */}
      {mode === 'euclidean' && (
        <div className="ba-sequencer-params">
          <div className="ba-param">
            <label>Hits</label>
            <input 
              type="range" 
              min={0} 
              max={steps} 
              value={hits}
              onChange={e => setHits(Number(e.target.value))}
              className="ba-slider"
            />
            <span className="ba-param-value">{hits}</span>
          </div>
          <div className="ba-param">
            <label>Steps</label>
            <input 
              type="range" 
              min={4} 
              max={32} 
              value={steps}
              onChange={e => setSteps(Number(e.target.value))}
              className="ba-slider"
            />
            <span className="ba-param-value">{steps}</span>
          </div>
          <div className="ba-param">
            <label>Rotate</label>
            <input 
              type="range" 
              min={0} 
              max={steps - 1} 
              value={rotation}
              onChange={e => setRotation(Number(e.target.value))}
              className="ba-slider"
            />
            <span className="ba-param-value">{rotation}</span>
          </div>
        </div>
      )}

      {/* Pattern visualization */}
      <div className="ba-sequencer-grid">
        {pattern.map((active, i) => (
          <div 
            key={i} 
            className={`ba-sequencer-step ${active ? 'active' : ''}`}
            data-beat={i % 4 === 0}
          />
        ))}
      </div>

      {/* Generate button */}
      <button 
        className="ba-btn ba-btn-primary"
        onClick={handleGenerate}
        disabled={disabled || isGenerating || !bankId}
      >
        <RefreshCw size={14} className={isGenerating ? 'ba-animate-spin' : ''} />
        Generate Pattern
      </button>
    </div>
  );
};
