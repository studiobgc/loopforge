/**
 * WaveformView - Main waveform display with stem lanes and moments
 */

import React from 'react';
import { Upload } from 'lucide-react';
import type { Session, Moment } from '../../api/client';
import { WaveformCanvas } from './WaveformCanvas';
import { STEM_COLORS, MOMENT_COLORS } from '../../design/constants';

interface WaveformViewProps {
  session: Session | null;
  moments: Moment[];
  selectedStem: string | null;
  onStemSelect: (stemName: string) => void;
  isProcessing: boolean;
  processingStage: string;
  processingProgress: number;
  isDragActive: boolean;
}

export const WaveformView: React.FC<WaveformViewProps> = ({
  session,
  moments,
  selectedStem,
  onStemSelect,
  isProcessing,
  processingStage,
  processingProgress,
  isDragActive,
}) => {
  const hasSession = !!session;
  const stems = session?.stems || [];
  const duration = session?.duration_seconds || 60;

  // Empty state - drop zone
  if (!hasSession && !isProcessing) {
    return (
      <div className={`ba-forge-drop ${isDragActive ? 'active' : ''}`}>
        <div className="ba-drop-content">
          <Upload size={48} strokeWidth={1} />
          <h2>Drop audio to start</h2>
          <p>MP3, WAV, FLAC, M4A, or video with audio track</p>
          <div className="ba-drop-shortcuts">
            <kbd>⌘O</kbd> to browse
          </div>
        </div>
      </div>
    );
  }

  // Processing state
  if (isProcessing) {
    return (
      <div className="ba-forge-processing">
        <div className="ba-processing-content">
          <div className="ba-processing-spinner" />
          <h2>{processingStage}</h2>
          <div className="ba-processing-bar">
            <div 
              className="ba-processing-fill" 
              style={{ width: `${processingProgress}%` }} 
            />
          </div>
          <p>{Math.round(processingProgress)}%</p>
        </div>
      </div>
    );
  }

  // Active state - waveform with stem lanes
  return (
    <div className="ba-forge-waveform">
      <div className="ba-waveform-lanes">
        {stems.map(stem => (
          <div 
            key={stem.id} 
            className={`ba-waveform-lane ${selectedStem === stem.name ? 'selected' : ''}`}
            onClick={() => onStemSelect(stem.name)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onStemSelect(stem.name)}
            aria-label={`${stem.name} stem`}
            aria-pressed={selectedStem === stem.name}
          >
            <div 
              className="ba-lane-label" 
              style={{ color: STEM_COLORS[stem.name] || '#888' }}
            >
              {stem.name}
            </div>
            <div className="ba-lane-waveform">
              <WaveformCanvas
                peaksUrl={session ? `/api/assets/session/${session.id}/peaks/${stem.name}` : null}
                color={STEM_COLORS[stem.name] || '#888'}
                height={50}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Moments overlay */}
      {moments.length > 0 && (
        <div className="ba-moments-overlay">
          {moments.slice(0, 20).map((m, i) => (
            <div
              key={i}
              className="ba-moment-region"
              style={{
                left: `${(m.start / duration) * 100}%`,
                width: `${((m.end - m.start) / duration) * 100}%`,
                backgroundColor: MOMENT_COLORS[m.type] || MOMENT_COLORS.change,
              }}
              title={m.label}
            />
          ))}
        </div>
      )}
    </div>
  );
};
