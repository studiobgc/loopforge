/**
 * ContextualPanel - Shows only what's relevant to what you're doing RIGHT NOW
 * 
 * Jenson's philosophy:
 * - Controls appear when RELEVANT, not all at once
 * - Progressive disclosure: start minimal, reveal depth on interaction
 * - Learning loops: simple actions lead to complex ones
 * 
 * States:
 * - IDLE: Just drop zone + key/bpm
 * - STEM_SELECTED: Slices + basic playback
 * - RECORDING: Feel + grid controls
 * - HAS_PATTERN: Clip editor + bounce
 * - ADVANCED: Euclidean, routing (collapsed by default)
 */

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight,
  Drum, Music, Scissors, Zap,
  Grid3X3, Cpu, Activity,
  Play, Square, Circle
} from 'lucide-react';

// Types
interface PatternEvent {
  id: string;
  stemId: string;
  sliceIndex: number;
  beat: number;
  microOffset: number;
  velocity: number;
}

interface ContextualPanelProps {
  // Current state
  isPlaying: boolean;
  isRecording: boolean;
  selectedStemId: string | null;
  selectedStemRole?: string;
  patternHits: number;
  
  // Values
  bpm: number;
  sessionKey: string;
  gridDivision: 32 | 64;
  swingAmount: number;
  feelPreset: string;
  
  // Pattern
  pattern: PatternEvent[];
  
  // Callbacks
  onBpmChange: (bpm: number) => void;
  onKeyChange: (key: string) => void;
  onGridChange: (grid: 32 | 64) => void;
  onSwingChange: (swing: number) => void;
  onFeelChange: (feel: string) => void;
  onRecordToggle: () => void;
  onPlayToggle: () => void;
  onClearPattern: () => void;
  onBounce: () => void;
  
  // Advanced controls (render props - only rendered when expanded)
  renderEuclidean?: () => React.ReactNode;
  renderCrossStem?: () => React.ReactNode;
  renderMomentRouting?: () => React.ReactNode;
}

const FEEL_PRESETS = {
  tight: { label: 'Tight', swing: 0 },
  dilla: { label: 'Dilla', swing: 0.62 },
  drunk: { label: 'Drunk', swing: 0.45 },
  machine: { label: 'Machine', swing: 0 },
};

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const ContextualPanel: React.FC<ContextualPanelProps> = ({
  isPlaying,
  isRecording,
  selectedStemId,
  selectedStemRole,
  patternHits,
  bpm,
  sessionKey,
  gridDivision,
  swingAmount,
  feelPreset,
  pattern,
  onBpmChange,
  onKeyChange,
  onGridChange,
  onSwingChange,
  onFeelChange,
  onRecordToggle,
  onPlayToggle,
  onClearPattern,
  onBounce,
  renderEuclidean,
  renderCrossStem,
  renderMomentRouting,
}) => {
  // Which advanced sections are expanded
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  
  const toggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Determine what to show based on current state
  const showRecordControls = isRecording || patternHits > 0;
  const showClipEditor = patternHits > 0;
  const hasAdvanced = renderEuclidean || renderCrossStem || renderMomentRouting;

  return (
    <div className="h-full flex flex-col bg-zinc-900/50 overflow-hidden">
      {/* ═══════════════════════════════════════════════════════════════════
          ALWAYS VISIBLE: Transport + Key/BPM (the essentials)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex-shrink-0 p-3 border-b border-zinc-800">
        {/* Transport */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <button
            onClick={onPlayToggle}
            className={`p-2.5 rounded-full transition-all ${
              isPlaying 
                ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' 
                : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={onRecordToggle}
            className={`p-2.5 rounded-full transition-all ${
              isRecording 
                ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse' 
                : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            <Circle className="w-4 h-4" fill={isRecording ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Key + BPM - always need these */}
        <div className="flex items-center gap-2">
          <select
            value={sessionKey}
            onChange={(e) => onKeyChange(e.target.value)}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center"
          >
            {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={bpm}
              onChange={(e) => onBpmChange(Number(e.target.value))}
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center"
            />
            <span className="text-xs text-zinc-500">BPM</span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          CONTEXTUAL: Shows based on what you're doing
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto">
        
        {/* No stem selected - show hint */}
        {!selectedStemId && !isRecording && patternHits === 0 && (
          <div className="p-6 text-center text-zinc-500">
            <Drum className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <div className="text-sm">Select a stem to start</div>
            <div className="text-xs mt-1 text-zinc-600">
              Click a stem on the left, then tap pads
            </div>
          </div>
        )}

        {/* Stem selected - show basic info */}
        {selectedStemId && (
          <div className="p-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                selectedStemRole === 'drums' ? 'bg-orange-500' :
                selectedStemRole === 'bass' ? 'bg-blue-500' :
                selectedStemRole === 'vocals' ? 'bg-purple-500' :
                'bg-emerald-500'
              }`} />
              <span className="text-sm font-medium capitalize">{selectedStemRole || 'Stem'}</span>
              <span className="text-xs text-zinc-500 ml-auto">
                {isRecording ? 'Recording...' : 'Ready'}
              </span>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────
            RECORDING/PATTERN CONTROLS - only when relevant
            ───────────────────────────────────────────────────────────────── */}
        {showRecordControls && (
          <div className="p-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <Drum className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs font-semibold text-zinc-300 uppercase">Pattern</span>
              {patternHits > 0 && (
                <span className="ml-auto text-xs text-amber-400">{patternHits} hits</span>
              )}
            </div>

            {/* Feel presets - simple row */}
            <div className="flex gap-1 mb-3">
              {Object.entries(FEEL_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => {
                    onFeelChange(key);
                    onSwingChange(preset.swing);
                  }}
                  className={`flex-1 py-1.5 text-[10px] font-medium rounded transition-all ${
                    feelPreset === key
                      ? 'bg-purple-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Grid - only two options, keep it simple */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => onGridChange(32)}
                className={`flex-1 py-1.5 text-xs rounded ${
                  gridDivision === 32 ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                1/32
              </button>
              <button
                onClick={() => onGridChange(64)}
                className={`flex-1 py-1.5 text-xs rounded ${
                  gridDivision === 64 ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                1/64
              </button>
            </div>

            {/* Actions */}
            {patternHits > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={onBounce}
                  className="flex-1 py-2 text-xs font-medium bg-green-600 hover:bg-green-500 text-white rounded transition-all"
                >
                  Bounce
                </button>
                <button
                  onClick={onClearPattern}
                  className="px-3 py-2 text-xs text-zinc-400 hover:text-white bg-zinc-800 rounded transition-all"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────
            CLIP EDITOR - only when pattern has hits
            ───────────────────────────────────────────────────────────────── */}
        {showClipEditor && (
          <div className="p-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 mb-2">
              <Scissors className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-semibold text-zinc-300 uppercase">Clip</span>
              <span className="ml-auto text-[9px] text-zinc-600 font-mono">⌘C ⌘V Del</span>
            </div>
            
            {/* Mini pattern view */}
            <div className="h-8 bg-zinc-900 rounded flex items-end gap-px px-1">
              {pattern.slice(0, 64).map((ev, i) => (
                <div
                  key={ev.id || i}
                  className="flex-1 bg-amber-500 rounded-t min-w-[2px]"
                  style={{ height: `${ev.velocity * 100}%` }}
                />
              ))}
              {pattern.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-[10px] text-zinc-600">
                  No hits yet
                </div>
              )}
            </div>
            
            <div className="mt-2 text-[10px] text-zinc-500">
              ←/→ nudge • Alt for micro • Del remove
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────
            ADVANCED - collapsed by default, expand on demand
            ───────────────────────────────────────────────────────────────── */}
        {hasAdvanced && (
          <div className="p-3">
            <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">
              Advanced
            </div>

            {/* Euclidean */}
            {renderEuclidean && (
              <CollapsibleSection
                icon={<Grid3X3 className="w-3.5 h-3.5 text-blue-400" />}
                title="Euclidean"
                expanded={expanded.euclidean}
                onToggle={() => toggleExpand('euclidean')}
              >
                {renderEuclidean()}
              </CollapsibleSection>
            )}

            {/* Cross-stem */}
            {renderCrossStem && (
              <CollapsibleSection
                icon={<Cpu className="w-3.5 h-3.5 text-pink-400" />}
                title="Cross-Stem"
                expanded={expanded.crossStem}
                onToggle={() => toggleExpand('crossStem')}
              >
                {renderCrossStem()}
              </CollapsibleSection>
            )}

            {/* Moment routing */}
            {renderMomentRouting && (
              <CollapsibleSection
                icon={<Activity className="w-3.5 h-3.5 text-orange-400" />}
                title="Moments"
                expanded={expanded.moments}
                onToggle={() => toggleExpand('moments')}
              >
                {renderMomentRouting()}
              </CollapsibleSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Collapsible section for advanced features
const CollapsibleSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ icon, title, expanded, onToggle, children }) => (
  <div className="mb-2">
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 p-2 rounded bg-zinc-800/50 hover:bg-zinc-800 transition-all"
    >
      {icon}
      <span className="text-xs text-zinc-300">{title}</span>
      <div className="ml-auto">
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-500" />
        )}
      </div>
    </button>
    {expanded && (
      <div className="mt-2 p-2 bg-zinc-900/50 rounded border border-zinc-800">
        {children}
      </div>
    )}
  </div>
);

export default ContextualPanel;
