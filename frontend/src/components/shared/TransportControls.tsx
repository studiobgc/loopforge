/**
 * TransportControls - Play/Stop/Skip transport buttons
 */

import React from 'react';
import { Play, Pause, Square, SkipBack, SkipForward } from 'lucide-react';

interface TransportControlsProps {
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onRewind?: () => void;
  onForward?: () => void;
  disabled?: boolean;
}

export const TransportControls: React.FC<TransportControlsProps> = ({
  isPlaying,
  onPlay,
  onStop,
  onRewind,
  onForward,
  disabled = false,
}) => (
  <div className="ba-forge-transport">
    {onRewind && (
      <button 
        className="ba-transport-btn" 
        onClick={onRewind}
        disabled={disabled}
        aria-label="Rewind"
      >
        <SkipBack size={14} />
      </button>
    )}
    <button 
      className="ba-transport-btn play"
      data-active={isPlaying}
      onClick={onPlay}
      disabled={disabled}
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {isPlaying ? <Pause size={16} /> : <Play size={16} />}
    </button>
    <button 
      className="ba-transport-btn"
      onClick={onStop}
      disabled={disabled}
      aria-label="Stop"
    >
      <Square size={12} />
    </button>
    {onForward && (
      <button 
        className="ba-transport-btn"
        onClick={onForward}
        disabled={disabled}
        aria-label="Forward"
      >
        <SkipForward size={14} />
      </button>
    )}
  </div>
);
