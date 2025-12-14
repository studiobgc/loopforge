/**
 * UnifiedCanvas - A single morphing interface for the entire creative flow
 * 
 * Philosophy (inspired by Scott Jenson):
 * - ONE action verb: DRAG teaches everything
 * - Learning loops: simple actions build to complex workflows
 * - Contextual UI: interface responds to WHERE you are, not mode switching
 * - Zoom levels: same canvas, different granularity (arrangement → sequence → pads → stem)
 * 
 * The "Jump Button" of LoopForge:
 * - Drag file → session
 * - Drag stem → role assignment
 * - Drag on pad → trigger + record
 * - Drag pad → sequence
 * - Drag sequence → arrangement
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Upload, Play, Square, Circle, Plus, Minus,
  ZoomIn, ZoomOut, Layers, Grid3X3, Music,
  ChevronLeft, ChevronRight, Volume2
} from 'lucide-react';
import { useSession, SketchSample, SketchRole, SharedStem, SketchSequence } from '../../contexts/SessionContext';
import { getAudioEngine } from '../../audio/engine';
import { api } from '../../api/client';

// Zoom levels - the canvas morphs between these
type ZoomLevel = 'arrangement' | 'sequence' | 'pads' | 'stem';

const ZOOM_LEVELS: ZoomLevel[] = ['arrangement', 'sequence', 'pads', 'stem'];

// Role colors for consistent visual language
const ROLE_COLORS: Record<SketchRole, string> = {
  drums: '#f97316',   // orange
  bass: '#3b82f6',    // blue
  vocals: '#a855f7',  // purple
  melody: '#10b981',  // emerald
  texture: '#ec4899', // pink
};

// Drag context - what's being dragged
interface DragPayload {
  type: 'file' | 'stem' | 'pad' | 'sequence';
  data: any;
}

export const UnifiedCanvas: React.FC = () => {
  const {
    currentSketch,
    createSketch,
    addSampleToSketch,
    updateSampleStatus,
    assignStemToRole,
    addSequence,
    updateSequence,
    setTargetKey,
    setTargetBpm,
  } = useSession();

  // Zoom state - which level of granularity
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('pads');
  const [zoomTransition, setZoomTransition] = useState(false);
  
  // Focus state - what's currently focused at each level
  const [focusedRole, setFocusedRole] = useState<SketchRole>('drums');
  const [focusedSequenceId, setFocusedSequenceId] = useState<string | null>(null);
  const [focusedSection, setFocusedSection] = useState<number>(0);
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  
  // Drag state
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  
  // Recording buffer
  const recordingBuffer = useRef<{ beat: number; padIndex: number; velocity: number }[]>([]);
  
  const audioEngine = useRef(getAudioEngine());

  // Initialize sketch
  useEffect(() => {
    if (!currentSketch) {
      createSketch('Untitled');
    }
  }, [currentSketch, createSketch]);

  // Zoom with smooth transition
  const changeZoom = useCallback((direction: 'in' | 'out') => {
    const currentIdx = ZOOM_LEVELS.indexOf(zoomLevel);
    const newIdx = direction === 'in' 
      ? Math.min(currentIdx + 1, ZOOM_LEVELS.length - 1)
      : Math.max(currentIdx - 1, 0);
    
    if (newIdx !== currentIdx) {
      setZoomTransition(true);
      setTimeout(() => {
        setZoomLevel(ZOOM_LEVELS[newIdx]);
        setZoomTransition(false);
      }, 150);
    }
  }, [zoomLevel]);

  // Universal drag start
  const handleDragStart = useCallback((payload: DragPayload) => {
    setDragPayload(payload);
  }, []);

  // Universal drag end
  const handleDragEnd = useCallback(() => {
    setDragPayload(null);
    setDropTarget(null);
  }, []);

  // Universal drop handler - the magic of the unified system
  const handleDrop = useCallback(async (targetType: string, targetData: any) => {
    if (!dragPayload || !currentSketch) return;

    // File → anywhere = upload and create session
    if (dragPayload.type === 'file') {
      const file = dragPayload.data as File;
      const sampleId = crypto.randomUUID();
      
      const sample: SketchSample = {
        id: sampleId,
        filename: file.name,
        sessionId: '',
        audioUrl: URL.createObjectURL(file),
        stems: [],
        status: 'uploading',
      };
      addSampleToSketch(sample);
      
      try {
        const result = await api.upload(file, { autoSeparate: true, autoAnalyze: true });
        updateSampleStatus(sampleId, 'separating');
        // Polling would happen here...
      } catch (e) {
        updateSampleStatus(sampleId, 'error');
      }
    }
    
    // Stem → Role = assign
    if (dragPayload.type === 'stem' && targetType === 'role') {
      const stem = dragPayload.data as SharedStem;
      const role = targetData as SketchRole;
      assignStemToRole({
        role,
        sampleId: stem.sessionId,
        stemId: stem.id,
        stem,
      });
    }
    
    // Pad → Sequence position = place hit
    if (dragPayload.type === 'pad' && targetType === 'sequence-slot') {
      const { padIndex, role } = dragPayload.data;
      const { beat } = targetData;
      
      // Find or create sequence for this role
      let seq = currentSketch.sequences.find(s => s.role === role);
      if (!seq) {
        seq = {
          id: crypto.randomUUID(),
          role,
          events: [],
          bars: 4,
        };
        addSequence(seq);
      }
      
      updateSequence(seq.id, [...seq.events, { beat, padIndex, velocity: 0.8 }]);
    }

    handleDragEnd();
  }, [dragPayload, currentSketch, addSampleToSketch, updateSampleStatus, assignStemToRole, addSequence, updateSequence, handleDragEnd]);

  // File drop zone handler
  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleDragStart({ type: 'file', data: files[0] });
      handleDrop('canvas', null);
    }
  }, [handleDragStart, handleDrop]);

  // Get assignment for a role
  const getAssignment = useCallback((role: SketchRole) => {
    return currentSketch?.assignments.find(a => a.role === role);
  }, [currentSketch]);

  // Render based on zoom level
  const renderContent = useMemo(() => {
    if (!currentSketch) return null;

    switch (zoomLevel) {
      case 'arrangement':
        return <ArrangementView 
          sketch={currentSketch}
          focusedSection={focusedSection}
          onSectionClick={setFocusedSection}
          onZoomIn={() => changeZoom('in')}
          currentBeat={currentBeat}
        />;
      
      case 'sequence':
        return <SequenceView
          sketch={currentSketch}
          focusedRole={focusedRole}
          onRoleChange={setFocusedRole}
          onPadDragStart={(padIndex) => handleDragStart({ type: 'pad', data: { padIndex, role: focusedRole } })}
          onSlotDrop={(beat) => handleDrop('sequence-slot', { beat })}
          dropTarget={dropTarget}
          onDropTargetChange={setDropTarget}
          currentBeat={currentBeat}
          isPlaying={isPlaying}
        />;
      
      case 'pads':
        return <PadsView
          sketch={currentSketch}
          focusedRole={focusedRole}
          onRoleChange={setFocusedRole}
          onPadTrigger={(padIndex, velocity) => {
            // Play sound
            const assignment = getAssignment(focusedRole);
            if (assignment) {
              audioEngine.current.triggerSlice(assignment.stemId, padIndex, { velocity });
            }
            // Record if recording
            if (isRecording && isPlaying) {
              recordingBuffer.current.push({ beat: currentBeat, padIndex, velocity });
            }
          }}
          onPadDragStart={(padIndex) => handleDragStart({ type: 'pad', data: { padIndex, role: focusedRole } })}
          isRecording={isRecording}
          currentBeat={currentBeat}
        />;
      
      case 'stem':
        return <StemView
          sketch={currentSketch}
          focusedRole={focusedRole}
          onStemDragStart={(stem) => handleDragStart({ type: 'stem', data: stem })}
          onRoleDrop={(role) => handleDrop('role', role)}
          dropTarget={dropTarget}
          onDropTargetChange={setDropTarget}
        />;
      
      default:
        return null;
    }
  }, [zoomLevel, currentSketch, focusedSection, focusedRole, currentBeat, isPlaying, isRecording, dropTarget, getAssignment, changeZoom, handleDragStart, handleDrop]);

  if (!currentSketch) {
    return <div className="h-full flex items-center justify-center bg-zinc-950 text-zinc-500">Loading...</div>;
  }

  return (
    <div 
      className="h-full flex flex-col bg-zinc-950 text-white overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleFileDrop}
    >
      {/* Top Bar - Zoom Level Indicator + Controls */}
      <div className="flex-shrink-0 h-12 border-b border-zinc-800 px-4 flex items-center justify-between">
        {/* Zoom breadcrumb */}
        <div className="flex items-center gap-1">
          {ZOOM_LEVELS.map((level, idx) => (
            <React.Fragment key={level}>
              <button
                onClick={() => setZoomLevel(level)}
                className={`px-2 py-1 text-xs font-medium rounded transition-all ${
                  zoomLevel === level
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
              {idx < ZOOM_LEVELS.length - 1 && (
                <ChevronRight className="w-3 h-3 text-zinc-600" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeZoom('out')}
            disabled={zoomLevel === 'arrangement'}
            className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30 transition-all"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => changeZoom('in')}
            disabled={zoomLevel === 'stem'}
            className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30 transition-all"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* Key/BPM */}
        <div className="flex items-center gap-3 text-xs">
          <select
            value={currentSketch.targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1"
          >
            {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <input
            type="number"
            value={currentSketch.targetBpm}
            onChange={(e) => setTargetBpm(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-14 text-center"
          />
          <span className="text-zinc-500">BPM</span>
        </div>
      </div>

      {/* Main Canvas - morphs based on zoom */}
      <div className={`flex-1 overflow-hidden transition-all duration-150 ${
        zoomTransition ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}>
        {renderContent}
      </div>

      {/* Transport - always visible */}
      <div className="flex-shrink-0 h-16 border-t border-zinc-800 px-4 flex items-center justify-center gap-4">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`p-3 rounded-full transition-all ${
            isPlaying ? 'bg-green-500' : 'bg-zinc-800 hover:bg-zinc-700'
          }`}
        >
          {isPlaying ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <button
          onClick={() => setIsRecording(!isRecording)}
          className={`p-3 rounded-full transition-all ${
            isRecording ? 'bg-red-500 animate-pulse' : 'bg-zinc-800 hover:bg-zinc-700'
          }`}
        >
          <Circle className="w-5 h-5" fill={isRecording ? 'currentColor' : 'none'} />
        </button>
        
        {/* Beat indicator */}
        <div className="flex items-center gap-1 ml-4">
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentBeat % 16
                  ? 'bg-white scale-125'
                  : i % 4 === 0
                    ? 'bg-zinc-600'
                    : 'bg-zinc-800'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Drag feedback overlay */}
      {dragPayload && (
        <div className="fixed inset-0 pointer-events-none z-50">
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-blue-500/90 rounded-full text-sm font-medium">
            Dragging: {dragPayload.type}
            {dragPayload.type === 'stem' && ` (${(dragPayload.data as SharedStem).role})`}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SUB-VIEWS (each represents a zoom level)
// ============================================================================

// Arrangement View - zoomed out, see whole song structure
const ArrangementView: React.FC<{
  sketch: any;
  focusedSection: number;
  onSectionClick: (idx: number) => void;
  onZoomIn: () => void;
  currentBeat: number;
}> = ({ sketch, focusedSection, onSectionClick, onZoomIn, currentBeat }) => {
  const sections = ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Outro'];
  
  return (
    <div className="h-full p-4 flex flex-col gap-4">
      <div className="text-sm text-zinc-500 mb-2">
        Double-click a section to zoom in
      </div>
      
      {/* Timeline */}
      <div className="flex-1 flex flex-col gap-2">
        {/* Role lanes */}
        {(['drums', 'bass', 'vocals', 'melody', 'texture'] as SketchRole[]).map(role => {
          const assignment = sketch.assignments.find((a: any) => a.role === role);
          const color = ROLE_COLORS[role];
          
          return (
            <div key={role} className="flex items-center gap-2">
              <div className="w-20 text-xs text-zinc-500 capitalize">{role}</div>
              <div className="flex-1 flex gap-1">
                {sections.map((section, idx) => (
                  <div
                    key={idx}
                    onClick={() => onSectionClick(idx)}
                    onDoubleClick={onZoomIn}
                    className={`
                      flex-1 h-12 rounded cursor-pointer transition-all
                      ${focusedSection === idx ? 'ring-2 ring-white' : ''}
                      ${assignment ? '' : 'opacity-30'}
                    `}
                    style={{ backgroundColor: assignment ? color + '40' : '#27272a' }}
                  >
                    {idx === 0 && (
                      <div className="text-[10px] text-zinc-400 p-1">{section}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Sequence View - one loop, see pattern grid
const SequenceView: React.FC<{
  sketch: any;
  focusedRole: SketchRole;
  onRoleChange: (role: SketchRole) => void;
  onPadDragStart: (padIndex: number) => void;
  onSlotDrop: (beat: number) => void;
  dropTarget: string | null;
  onDropTargetChange: (target: string | null) => void;
  currentBeat: number;
  isPlaying: boolean;
}> = ({ sketch, focusedRole, onRoleChange, onSlotDrop, dropTarget, onDropTargetChange, currentBeat, isPlaying }) => {
  const sequence = sketch.sequences.find((s: SketchSequence) => s.role === focusedRole);
  const steps = 64;
  
  return (
    <div className="h-full p-4 flex flex-col">
      {/* Role tabs */}
      <div className="flex gap-1 mb-4">
        {(['drums', 'bass', 'vocals', 'melody', 'texture'] as SketchRole[]).map(role => (
          <button
            key={role}
            onClick={() => onRoleChange(role)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
              focusedRole === role
                ? 'text-white'
                : 'text-zinc-500 hover:text-white bg-zinc-800/50'
            }`}
            style={{ backgroundColor: focusedRole === role ? ROLE_COLORS[role] + '60' : undefined }}
          >
            {role}
          </button>
        ))}
      </div>
      
      {/* Step grid */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-px" style={{ width: `${steps * 20}px` }}>
          {Array.from({ length: steps }).map((_, beat) => {
            const hasHit = sequence?.events.some((e: any) => Math.floor(e.beat * 16) === beat);
            const isCurrentBeat = isPlaying && currentBeat % steps === beat;
            const isDropTarget = dropTarget === `slot-${beat}`;
            
            return (
              <div
                key={beat}
                onDragOver={(e) => { e.preventDefault(); onDropTargetChange(`slot-${beat}`); }}
                onDragLeave={() => onDropTargetChange(null)}
                onDrop={() => onSlotDrop(beat / 16)}
                className={`
                  w-5 h-32 rounded-sm cursor-pointer transition-all
                  ${beat % 16 === 0 ? 'border-l-2 border-zinc-600' : ''}
                  ${beat % 4 === 0 ? 'bg-zinc-800' : 'bg-zinc-900'}
                  ${hasHit ? '' : 'hover:bg-zinc-700'}
                  ${isCurrentBeat ? 'ring-1 ring-white' : ''}
                  ${isDropTarget ? 'ring-2 ring-blue-500' : ''}
                `}
                style={{ backgroundColor: hasHit ? ROLE_COLORS[focusedRole] : undefined }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Pads View - trigger sounds, the main performance view
const PadsView: React.FC<{
  sketch: any;
  focusedRole: SketchRole;
  onRoleChange: (role: SketchRole) => void;
  onPadTrigger: (padIndex: number, velocity: number) => void;
  onPadDragStart: (padIndex: number) => void;
  isRecording: boolean;
  currentBeat: number;
}> = ({ sketch, focusedRole, onRoleChange, onPadTrigger, onPadDragStart, isRecording }) => {
  const [activePads, setActivePads] = useState<Set<number>>(new Set());
  const assignment = sketch.assignments.find((a: any) => a.role === focusedRole);
  const color = ROLE_COLORS[focusedRole];

  const triggerPad = useCallback((index: number, velocity: number = 0.8) => {
    onPadTrigger(index, velocity);
    setActivePads(prev => new Set(prev).add(index));
    setTimeout(() => {
      setActivePads(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }, 150);
  }, [onPadTrigger]);

  // Keyboard triggers
  useEffect(() => {
    const keyMap: Record<string, number> = {
      '1': 0, '2': 1, '3': 2, '4': 3,
      'q': 4, 'w': 5, 'e': 6, 'r': 7,
      'a': 8, 's': 9, 'd': 10, 'f': 11,
      'z': 12, 'x': 13, 'c': 14, 'v': 15,
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const idx = keyMap[e.key.toLowerCase()];
      if (idx !== undefined) {
        e.preventDefault();
        triggerPad(idx);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerPad]);

  return (
    <div className="h-full p-4 flex flex-col items-center justify-center">
      {/* Role tabs - horizontal above pads */}
      <div className="flex gap-2 mb-6">
        {(['drums', 'bass', 'vocals', 'melody', 'texture'] as SketchRole[]).map(role => {
          const hasAssignment = sketch.assignments.some((a: any) => a.role === role);
          return (
            <button
              key={role}
              onClick={() => onRoleChange(role)}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${focusedRole === role ? 'ring-2 ring-white' : 'opacity-60 hover:opacity-100'}
                ${hasAssignment ? '' : 'border border-dashed border-zinc-600'}
              `}
              style={{ backgroundColor: ROLE_COLORS[role] + (focusedRole === role ? '80' : '40') }}
            >
              {role}
              {!hasAssignment && <span className="ml-1 text-xs">+</span>}
            </button>
          );
        })}
      </div>

      {/* 4x4 Pad grid */}
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 16 }).map((_, idx) => {
          const isActive = activePads.has(idx);
          const keyLabel = ['1','2','3','4','Q','W','E','R','A','S','D','F','Z','X','C','V'][idx];
          
          return (
            <button
              key={idx}
              onMouseDown={() => triggerPad(idx)}
              draggable
              onDragStart={() => onPadDragStart(idx)}
              className={`
                w-20 h-20 rounded-xl transition-all duration-75 relative
                ${isActive 
                  ? 'scale-95 shadow-lg' 
                  : 'hover:scale-102 active:scale-95'
                }
                ${!assignment ? 'opacity-40' : ''}
              `}
              style={{
                backgroundColor: isActive ? color : color + '60',
                boxShadow: isActive ? `0 0 30px ${color}80` : 'none',
              }}
              disabled={!assignment}
            >
              <span className="absolute top-1.5 left-2 text-xs font-mono opacity-50">
                {keyLabel}
              </span>
              <span className="text-lg font-bold">{idx + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="mt-6 flex items-center gap-2 text-red-400 text-sm">
          <Circle className="w-3 h-3 fill-current animate-pulse" />
          Recording - tap pads to sequence
        </div>
      )}

      {/* Hint */}
      {!assignment && (
        <div className="mt-6 text-zinc-500 text-sm">
          Zoom in (→) to assign a stem to <span style={{ color }}>{focusedRole}</span>
        </div>
      )}
    </div>
  );
};

// Stem View - source material, assign to roles
const StemView: React.FC<{
  sketch: any;
  focusedRole: SketchRole;
  onStemDragStart: (stem: SharedStem) => void;
  onRoleDrop: (role: SketchRole) => void;
  dropTarget: string | null;
  onDropTargetChange: (target: string | null) => void;
}> = ({ sketch, focusedRole, onStemDragStart, onRoleDrop, dropTarget, onDropTargetChange }) => {
  const readySamples = sketch.samples.filter((s: SketchSample) => s.status === 'ready');

  return (
    <div className="h-full p-4 flex gap-4">
      {/* Samples column */}
      <div className="w-1/2 flex flex-col">
        <h3 className="text-sm font-semibold text-zinc-400 mb-3">SAMPLES</h3>
        <div className="flex-1 overflow-y-auto space-y-3">
          {sketch.samples.map((sample: SketchSample, idx: number) => (
            <div key={sample.id} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded bg-zinc-700 flex items-center justify-center text-xs font-bold">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="text-sm truncate">{sample.filename}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  sample.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                  sample.status === 'error' ? 'bg-red-500/20 text-red-400' :
                  'bg-amber-500/20 text-amber-400'
                }`}>
                  {sample.status}
                </span>
              </div>
              
              {sample.status === 'ready' && (
                <div className="grid grid-cols-2 gap-1">
                  {sample.stems.map((stem: SharedStem) => {
                    const isAssigned = sketch.assignments.some((a: any) => a.stemId === stem.id);
                    return (
                      <div
                        key={stem.id}
                        draggable
                        onDragStart={() => onStemDragStart(stem)}
                        className={`
                          px-2 py-1.5 rounded text-xs cursor-grab active:cursor-grabbing
                          transition-all hover:scale-105
                          ${isAssigned 
                            ? 'bg-zinc-700 text-zinc-400' 
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                          }
                        `}
                      >
                        {stem.role}
                        {isAssigned && ' ✓'}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          
          {sketch.samples.length === 0 && (
            <div className="text-center py-12 text-zinc-600">
              <Upload className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div>Drop audio files anywhere</div>
            </div>
          )}
        </div>
      </div>

      {/* Roles column - drop targets */}
      <div className="w-1/2 flex flex-col">
        <h3 className="text-sm font-semibold text-zinc-400 mb-3">ROLES</h3>
        <div className="flex-1 space-y-2">
          {(['drums', 'bass', 'vocals', 'melody', 'texture'] as SketchRole[]).map(role => {
            const assignment = sketch.assignments.find((a: any) => a.role === role);
            const isDropTarget = dropTarget === `role-${role}`;
            const color = ROLE_COLORS[role];
            
            return (
              <div
                key={role}
                onDragOver={(e) => { e.preventDefault(); onDropTargetChange(`role-${role}`); }}
                onDragLeave={() => onDropTargetChange(null)}
                onDrop={() => onRoleDrop(role)}
                onClick={() => {/* could zoom out to pads */}}
                className={`
                  p-4 rounded-lg border-2 transition-all cursor-pointer
                  ${isDropTarget 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : assignment
                      ? 'border-transparent'
                      : 'border-dashed border-zinc-700 hover:border-zinc-500'
                  }
                `}
                style={{ 
                  backgroundColor: assignment ? color + '20' : undefined,
                  borderColor: assignment && !isDropTarget ? color + '40' : undefined,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize" style={{ color: assignment ? color : undefined }}>
                    {role}
                  </span>
                  {assignment && (
                    <span className="text-xs text-zinc-500">
                      {assignment.stem.role} from {sketch.samples.find((s: any) => s.id === assignment.sampleId)?.filename}
                    </span>
                  )}
                </div>
                {!assignment && (
                  <div className="text-xs text-zinc-600 mt-1">
                    Drag a stem here
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default UnifiedCanvas;
