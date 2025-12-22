/**
 * SliceSequencer - Autechre-inspired generative sample slicing UI
 * 
 * Features:
 * - Visual slice grid with waveform
 * - Multiple trigger modes (Sequential, Euclidean, Probability, Follow, Chaos)
 * - Rule engine for conditional behaviors
 * - Real-time fader control of parameters
 * - Cross-stem triggering
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, 
  Square, 
  Shuffle, 
  Grid3X3, 
  Waves,
  Zap,
  Link2,
  Plus,
  Trash2,
  RotateCcw,
  HelpCircle,
  Layers,
} from 'lucide-react';
import { sliceApi, TriggerEvent, TriggerMode, TriggerRule, TriggerPreset } from '../../api/sliceApi';
import * as Tone from 'tone';

// =============================================================================
// TYPES
// =============================================================================

interface SliceInfo {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  energy: number;
  transientStrength: number;
  brightness: number;
}

interface SliceBankInfo {
  id: string;
  sourceFilename: string;
  role: string;
  numSlices: number;
  totalDuration: number;
  slices: SliceInfo[];
}

interface SliceSequencerProps {
  sessionId: string;
  stemPath: string;
  stemRole: string;
  bpm: number;
  audioBuffer?: AudioBuffer;
  onSliceBankCreated?: (bankId: string) => void;
  availableBanks?: SliceBankInfo[];  // For follow mode
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

const ModeIcon: React.FC<{ mode: TriggerMode }> = ({ mode }) => {
  switch (mode) {
    case 'sequential': return <Grid3X3 className="w-4 h-4" />;
    case 'random': return <Shuffle className="w-4 h-4" />;
    case 'euclidean': return <div className="w-4 h-4 rounded-full border-2 border-current" />;
    case 'probability': return <Waves className="w-4 h-4" />;
    case 'follow': return <Link2 className="w-4 h-4" />;
    case 'chaos': return <Zap className="w-4 h-4" />;
    case 'footwork': return <Layers className="w-4 h-4" />;
    default: return <Grid3X3 className="w-4 h-4" />;
  }
};

const SliceBar: React.FC<{
  slice: SliceInfo;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  totalDuration: number;
}> = ({ slice, isActive, isSelected, onClick, totalDuration }) => {
  const widthPercent = (slice.duration / totalDuration) * 100;
  const leftPercent = (slice.startTime / totalDuration) * 100;
  
  // Color based on energy (amber gradient)
  const energyColor = `rgba(245, 158, 11, ${0.3 + slice.energy * 0.7})`;
  
  return (
    <div
      className={`
        absolute top-0 bottom-0 cursor-pointer transition-all duration-100
        border-r border-zinc-700/50 group
        ${isActive ? 'bg-amber-500/40 ring-1 ring-amber-400' : ''}
        ${isSelected ? 'ring-2 ring-white/50' : ''}
      `}
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        backgroundColor: isActive ? undefined : energyColor,
      }}
      onClick={onClick}
    >
      {/* Transient indicator */}
      <div 
        className="absolute top-0 left-0 w-1 bg-white/60"
        style={{ height: `${slice.transientStrength * 100}%` }}
      />
      
      {/* Index label */}
      <span className="absolute bottom-1 left-1 text-[10px] text-zinc-400 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
        {slice.index}
      </span>
    </div>
  );
};

const SequenceGrid: React.FC<{
  events: TriggerEvent[];
  numSlices: number;
  currentBeat: number;
  durationBeats: number;
  onEventClick?: (index: number) => void;
}> = ({ events, numSlices, currentBeat, durationBeats, onEventClick }) => {
  const gridRef = useRef<HTMLDivElement>(null);
  
  // Calculate grid dimensions
  
  return (
    <div className="relative w-full h-32 bg-zinc-900/50 rounded-lg border border-zinc-800 overflow-hidden">
      {/* Grid lines */}
      <div className="absolute inset-0 flex">
        {Array.from({ length: Math.ceil(durationBeats) }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 border-r ${i % 4 === 3 ? 'border-zinc-600' : 'border-zinc-800/50'}`}
          />
        ))}
      </div>
      
      {/* Events */}
      <div ref={gridRef} className="absolute inset-0 flex items-end p-1 gap-0.5">
        {events.map((event, i) => {
          const height = (event.slice_index / Math.max(numSlices - 1, 1)) * 100;
          const isCurrentBeat = event.time <= currentBeat && 
            (i === events.length - 1 || events[i + 1].time > currentBeat);
          
          return (
            <div
              key={i}
              className={`
                relative flex-1 rounded-sm cursor-pointer transition-all
                ${isCurrentBeat ? 'bg-amber-400' : 'bg-amber-600/60'}
                ${event.reverse ? 'bg-purple-500/60' : ''}
                ${event.rule_modified ? 'ring-1 ring-cyan-400/50' : ''}
                hover:brightness-125
              `}
              style={{ 
                height: `${Math.max(10, height)}%`,
                opacity: event.velocity,
              }}
              onClick={() => onEventClick?.(i)}
              title={`Slice ${event.slice_index} @ beat ${event.time.toFixed(2)}${event.reverse ? ' (reversed)' : ''}`}
            >
              {/* Pitch shift indicator */}
              {event.pitch_shift !== 0 && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] text-cyan-400 font-mono">
                  {event.pitch_shift > 0 ? '+' : ''}{event.pitch_shift}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Playhead */}
      <div 
        className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none transition-transform"
        style={{ 
          transform: `translateX(${(currentBeat / durationBeats) * 100}%)`,
          left: 0,
        }}
      />
    </div>
  );
};

const RuleEditor: React.FC<{
  rules: TriggerRule[];
  onAddRule: (rule: Omit<TriggerRule, 'id'>) => void;
  onRemoveRule: (id: string) => void;
  onToggleRule: (id: string) => void;
}> = ({ rules, onAddRule, onRemoveRule, onToggleRule }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newRule, setNewRule] = useState({
    name: '',
    condition: 'consecutive_plays > 3',
    action: 'skip_next',
    probability: 1.0,
  });

  const conditionOptions = [
    { value: 'consecutive_plays > 2', label: 'Same slice plays 2x' },
    { value: 'consecutive_plays > 3', label: 'Same slice plays 3x' },
    { value: 'consecutive_plays > 4', label: 'Same slice plays 4x' },
    { value: 'total_plays % 4', label: 'Every 4th trigger' },
    { value: 'total_plays % 8', label: 'Every 8th trigger' },
    { value: 'slice_index == 0', label: 'First slice played' },
  ];

  const actionOptions = [
    { value: 'skip_next', label: 'Skip next trigger' },
    { value: 'random_slice', label: 'Random slice' },
    { value: 'reverse', label: 'Reverse playback' },
    { value: 'pitch_up_2', label: 'Pitch up +2st' },
    { value: 'pitch_up_5', label: 'Pitch up +5st' },
    { value: 'pitch_down_2', label: 'Pitch down -2st' },
    { value: 'half_velocity', label: 'Half velocity' },
    { value: 'double_velocity', label: 'Double velocity' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          Conditional Rules
        </h4>
        <button
          onClick={() => setIsAdding(true)}
          className="text-xs text-amber-500 hover:text-amber-400 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Rule
        </button>
      </div>

      {/* Existing rules */}
      <div className="space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`
              flex items-center justify-between p-2 rounded-lg text-xs
              ${rule.enabled ? 'bg-zinc-800/50' : 'bg-zinc-900/30 opacity-50'}
            `}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-zinc-200 truncate">{rule.name || 'Unnamed Rule'}</div>
              <div className="text-zinc-500 truncate">
                IF {rule.condition} → {rule.action}
                {rule.probability < 1 && ` (${Math.round(rule.probability * 100)}%)`}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-2">
              <button
                onClick={() => onToggleRule(rule.id)}
                className={`p-1 rounded ${rule.enabled ? 'text-amber-500' : 'text-zinc-600'}`}
              >
                <Zap className="w-3 h-3" />
              </button>
              <button
                onClick={() => onRemoveRule(rule.id)}
                className="p-1 rounded text-zinc-500 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add rule form */}
      {isAdding && (
        <div className="p-3 bg-zinc-800/50 rounded-lg space-y-3">
          <input
            type="text"
            placeholder="Rule name..."
            value={newRule.name}
            onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
            className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-200"
          />
          
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newRule.condition}
              onChange={(e) => setNewRule({ ...newRule, condition: e.target.value })}
              className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200"
            >
              {conditionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            
            <select
              value={newRule.action}
              onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
              className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200"
            >
              {actionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400">Probability:</label>
            <input
              type="range"
              min="0"
              max="100"
              value={newRule.probability * 100}
              onChange={(e) => setNewRule({ ...newRule, probability: Number(e.target.value) / 100 })}
              className="flex-1"
            />
            <span className="text-xs text-zinc-400 w-10">{Math.round(newRule.probability * 100)}%</span>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setIsAdding(false)}
              className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onAddRule({ ...newRule, enabled: true });
                setIsAdding(false);
                setNewRule({ name: '', condition: 'consecutive_plays > 3', action: 'skip_next', probability: 1.0 });
              }}
              className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded"
            >
              Add Rule
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SliceSequencer: React.FC<SliceSequencerProps> = ({
  sessionId,
  stemPath,
  stemRole,
  bpm,
  audioBuffer,
  onSliceBankCreated,
  availableBanks = [],
}) => {
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [sliceBank, setSliceBank] = useState<SliceBankInfo | null>(null);
  const [events, setEvents] = useState<TriggerEvent[]>([]);
  const [rules, setRules] = useState<TriggerRule[]>([]);
  const [presets, setPresets] = useState<TriggerPreset[]>([]);
  
  // Sequencer state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [selectedSlice, setSelectedSlice] = useState<number | null>(null);
  
  // Parameters
  const [mode, setMode] = useState<TriggerMode>('sequential');
  const [durationBeats, setDurationBeats] = useState(16);
  const [subdivision, setSubdivision] = useState(1);
  const [euclideanHits, setEuclideanHits] = useState(5);
  const [euclideanSteps, setEuclideanSteps] = useState(8);
  const [euclideanRotation, setEuclideanRotation] = useState(0);
  const [followBankId, setFollowBankId] = useState<string>('');
  const [probabilities, setProbabilities] = useState<number[]>([]);
  
  // Audio
  const sequencerRef = useRef<Tone.Sequence | null>(null);
  
  // WebSocket

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  // Create slice bank on mount
  useEffect(() => {
    const initSliceBank = async () => {
      try {
        setIsLoading(true);
        
        // Create slice bank
        const result = await sliceApi.createSliceBank(
          sessionId,
          stemPath,
          stemRole,
          bpm
        );
        
        setSliceBank({
          id: result.slice_bank_id,
          sourceFilename: stemPath.split('/').pop() || 'unknown',
          role: result.role,
          numSlices: result.num_slices,
          totalDuration: result.total_duration,
          slices: result.slices.map(s => ({
            index: s.index,
            startTime: s.start_time,
            endTime: s.end_time,
            duration: s.duration,
            energy: s.energy,
            transientStrength: s.transient_strength,
            brightness: s.brightness,
          })),
        });
        
        onSliceBankCreated?.(result.slice_bank_id);
        
        // Initialize probabilities array
        setProbabilities(new Array(result.num_slices).fill(1.0));
        
      } catch (error) {
        console.error('Failed to create slice bank:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initSliceBank();
  }, [sessionId, stemPath, stemRole, bpm]);

  // Load presets
  useEffect(() => {
    sliceApi.getPresets().then(({ presets }) => setPresets(presets));
  }, []);

  // =============================================================================
  // SEQUENCE GENERATION
  // =============================================================================

  const generateSequence = useCallback(async () => {
    if (!sliceBank) return;
    
    try {
      const result = await sliceApi.generateSequence({
        sessionId,
        sliceBankId: sliceBank.id,
        durationBeats,
        bpm,
        mode,
        euclideanHits: mode === 'euclidean' ? euclideanHits : undefined,
        euclideanSteps: mode === 'euclidean' ? euclideanSteps : undefined,
        euclideanRotation: mode === 'euclidean' ? euclideanRotation : undefined,
        subdivision,
        probabilities: mode === 'probability' ? probabilities : undefined,
        followBankId: mode === 'follow' ? followBankId : undefined,
      });
      
      setEvents(result.events);
    } catch (error) {
      console.error('Failed to generate sequence:', error);
    }
  }, [sliceBank, sessionId, durationBeats, bpm, mode, euclideanHits, euclideanSteps, euclideanRotation, subdivision, probabilities, followBankId]);

  // Regenerate when parameters change
  useEffect(() => {
    if (sliceBank) {
      generateSequence();
    }
  }, [sliceBank, mode, durationBeats, subdivision, euclideanHits, euclideanSteps, euclideanRotation, followBankId]);

  // =============================================================================
  // AUDIO PLAYBACK
  // =============================================================================

  const handlePlayStop = useCallback(async () => {
    if (isPlaying) {
      // Stop
      Tone.Transport.stop();
      sequencerRef.current?.stop();
      setIsPlaying(false);
      setCurrentBeat(0);
    } else {
      // Start
      await Tone.start();

      // Ensure transport is configured
      Tone.Transport.stop();
      Tone.Transport.position = 0;
      Tone.Transport.bpm.value = bpm;

      // Dispose any previous sequence
      if (sequencerRef.current) {
        try {
          sequencerRef.current.dispose();
        } catch {
          // ignore
        }
        sequencerRef.current = null;
      }

      // Drive UI beat cursor from generated events.
      // (Audio triggering is intentionally a placeholder in this chimera component.)
      const seq = new Tone.Sequence(
        (time, event: TriggerEvent) => {
          void time;
          setCurrentBeat(event.time);
        },
        events,
        '16n'
      );

      sequencerRef.current = seq;
      seq.start(0);

      Tone.Transport.start();
      setIsPlaying(true);
    }
  }, [isPlaying, bpm, audioBuffer, sliceBank, events]);

  // =============================================================================
  // RULES
  // =============================================================================

  const handleAddRule = useCallback((rule: Omit<TriggerRule, 'id'>) => {
    const newRule: TriggerRule = {
      ...rule,
      id: `rule_${Date.now()}`,
    };
    setRules(prev => [...prev, newRule]);
  }, []);

  const handleRemoveRule = useCallback((id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  }, []);

  const handleToggleRule = useCallback((id: string) => {
    setRules(prev => prev.map(r => 
      r.id === id ? { ...r, enabled: !r.enabled } : r
    ));
  }, []);

  // =============================================================================
  // RENDER
  // =============================================================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-zinc-400">Analyzing transients...</span>
        </div>
      </div>
    );
  }

  if (!sliceBank) {
    return (
      <div className="flex items-center justify-center h-64 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <span className="text-zinc-500">Failed to create slice bank</span>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Grid3X3 className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-zinc-200">Slice Sequencer</h3>
            <p className="text-xs text-zinc-500">
              {sliceBank.numSlices} slices • {sliceBank.totalDuration.toFixed(1)}s • {stemRole}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={generateSequence}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Regenerate sequence"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handlePlayStop}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all
              ${isPlaying 
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
                : 'bg-amber-500 text-black hover:bg-amber-400'}
            `}
          >
            {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isPlaying ? 'Stop' : 'Play'}
          </button>
        </div>
      </div>

      {/* Slice Visualization */}
      <div className="p-4 border-b border-zinc-800">
        <div className="relative h-16 bg-zinc-950 rounded-lg overflow-hidden">
          {sliceBank.slices.map((slice) => (
            <SliceBar
              key={slice.index}
              slice={slice}
              isActive={events.some(e => e.slice_index === slice.index && 
                Math.abs(e.time - currentBeat) < 0.5)}
              isSelected={selectedSlice === slice.index}
              onClick={() => setSelectedSlice(slice.index)}
              totalDuration={sliceBank.totalDuration}
            />
          ))}
        </div>
      </div>

      {/* Mode Selection */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">Trigger Mode</span>
          <div className="group relative">
            <HelpCircle className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400 cursor-help" />
            <div className="absolute right-0 top-6 w-64 p-3 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <div className="text-xs space-y-2">
                <p className="text-zinc-300 font-medium">Trigger Modes</p>
                <p className="text-zinc-500"><strong className="text-zinc-400">Sequential:</strong> Play slices in order</p>
                <p className="text-zinc-500"><strong className="text-zinc-400">Euclidean:</strong> Mathematically-spaced rhythms</p>
                <p className="text-zinc-500"><strong className="text-zinc-400">Probability:</strong> Weighted random selection</p>
                <p className="text-zinc-500"><strong className="text-zinc-400">Follow:</strong> Mirror another stem's rhythm</p>
                <p className="text-zinc-500"><strong className="text-zinc-400">Chaos:</strong> Rule-based generative patterns</p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            { mode: 'sequential' as TriggerMode, tip: 'Play slices 1, 2, 3...' },
            { mode: 'euclidean' as TriggerMode, tip: 'Bjorklund algorithm rhythms' },
            { mode: 'probability' as TriggerMode, tip: 'Weighted random' },
            { mode: 'follow' as TriggerMode, tip: 'Mirror another stem' },
            { mode: 'chaos' as TriggerMode, tip: 'Rule-based mutations' },
            { mode: 'footwork' as TriggerMode, tip: 'Footwork polyrhythmic patterns' },
          ]).map(({ mode: m, tip }) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              title={tip}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all
                ${mode === m 
                  ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/50' 
                  : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}
              `}
            >
              <ModeIcon mode={m} />
              <span className="capitalize">{m}</span>
            </button>
          ))}
        </div>

        {/* Mode-specific parameters */}
        <div className="mt-4 space-y-4">
          {mode === 'euclidean' && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Hits</label>
                <input
                  type="number"
                  min="1"
                  max={euclideanSteps}
                  value={euclideanHits}
                  onChange={(e) => setEuclideanHits(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Steps</label>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={euclideanSteps}
                  onChange={(e) => setEuclideanSteps(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Rotation</label>
                <input
                  type="number"
                  min="0"
                  max={euclideanSteps - 1}
                  value={euclideanRotation}
                  onChange={(e) => setEuclideanRotation(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200"
                />
              </div>
            </div>
          )}

          {mode === 'follow' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Follow Stem</label>
              <select
                value={followBankId}
                onChange={(e) => setFollowBankId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200"
              >
                <option value="">Select a stem to follow...</option>
                {availableBanks.filter(b => b.id !== sliceBank.id).map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.sourceFilename} ({bank.role})
                  </option>
                ))}
              </select>
            </div>
          )}

          {(mode === 'sequential' || mode === 'probability') && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">
                Subdivision (triggers per beat)
              </label>
              <div className="flex gap-2">
                {[1, 2, 4, 8].map((sub) => (
                  <button
                    key={sub}
                    onClick={() => setSubdivision(sub)}
                    className={`
                      px-3 py-2 rounded-lg text-sm font-mono transition-all
                      ${subdivision === sub 
                        ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/50' 
                        : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800'}
                    `}
                  >
                    1/{sub === 1 ? '4' : sub === 2 ? '8' : sub === 4 ? '16' : '32'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'footwork' && (
            <div className="space-y-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <div className="text-xs text-zinc-400 mb-2">
                Footwork Mode: Polyrhythmic patterns with micro-timing
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Saturation</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    defaultValue="0.3"
                    className="w-full"
                    title="Saturation amount (0-1)"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Swing</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    defaultValue="0.0"
                    className="w-full"
                    title="Swing amount (0-1)"
                  />
                </div>
              </div>
              <div className="text-xs text-zinc-500">
                Use presets below for classic footwork patterns
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sequence Grid */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">
            Sequence ({events.length} events)
          </span>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Bars:</label>
            <select
              value={durationBeats / 4}
              onChange={(e) => setDurationBeats(Number(e.target.value) * 4)}
              className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200"
            >
              {[1, 2, 4, 8, 16].map((bars) => (
                <option key={bars} value={bars}>{bars} bar{bars > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
        </div>
        <SequenceGrid
          events={events}
          numSlices={sliceBank.numSlices}
          currentBeat={currentBeat}
          durationBeats={durationBeats}
        />
      </div>

      {/* Rules (Chaos Mode) */}
      {(mode === 'chaos' || rules.length > 0) && (
        <div className="p-4">
          <RuleEditor
            rules={rules}
            onAddRule={handleAddRule}
            onRemoveRule={handleRemoveRule}
            onToggleRule={handleToggleRule}
          />
        </div>
      )}

      {/* Presets */}
      <div className="px-4 py-3 bg-zinc-900/80 border-t border-zinc-800">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-zinc-500 whitespace-nowrap">Presets:</span>
          {presets.map((preset) => (
            <button
              key={preset.name}
              onClick={() => {
                // Apply preset
                if (preset.name.includes('euclidean')) {
                  setMode('euclidean');
                  if (preset.name === 'euclidean_5_8') {
                    setEuclideanHits(5);
                    setEuclideanSteps(8);
                  } else if (preset.name === 'euclidean_7_16') {
                    setEuclideanHits(7);
                    setEuclideanSteps(16);
                  }
                } else if (preset.name.includes('autechre')) {
                  setMode('chaos');
                }
              }}
              className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded whitespace-nowrap transition-colors"
              title={preset.description}
            >
              {preset.name.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SliceSequencer;
