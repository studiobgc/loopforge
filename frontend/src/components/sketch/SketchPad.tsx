/**
 * SketchPad - Multi-sample composition workflow
 * 
 * Workflow:
 * 1. Upload 3-5 samples (drops, loops, vocals, anything)
 * 2. Each sample gets separated into stems
 * 3. Pick: drums from sample A, vocals from sample B, melody from C
 * 4. Audition pads, record sequences
 * 5. Auto-warp everything to same key/tempo
 * 6. Arrange sections, preview mix, export
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload, Music, Drum, Mic2, Piano, Waves,
  Play, Square, Circle, Check, X, Loader2,
  Trash2, Settings, Clock, Key
} from 'lucide-react';
import { api } from '../../api/client';
import { getAudioEngine } from '../../audio/engine';
import { useSession, SketchSample, SketchRole, SharedStem } from '../../contexts/SessionContext';

const ROLE_CONFIG: Record<SketchRole, { icon: React.ReactNode; color: string; label: string }> = {
  drums: { icon: <Drum className="w-4 h-4" />, color: 'orange', label: 'Drums' },
  bass: { icon: <Waves className="w-4 h-4" />, color: 'blue', label: 'Bass' },
  vocals: { icon: <Mic2 className="w-4 h-4" />, color: 'purple', label: 'Vocals' },
  melody: { icon: <Piano className="w-4 h-4" />, color: 'emerald', label: 'Melody' },
  texture: { icon: <Music className="w-4 h-4" />, color: 'pink', label: 'Texture' },
};


export const SketchPad: React.FC = () => {
  const {
    currentSketch,
    createSketch,
    addSampleToSketch,
    updateSampleStatus,
    assignStemToRole,
    removeAssignment,
    setTargetKey,
    setTargetBpm,
    clearSketch,
  } = useSession();

  const [isDragging, setIsDragging] = useState(false);
  const [activeRole, setActiveRole] = useState<SketchRole>('drums');
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const audioEngine = useRef(getAudioEngine());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize sketch on mount
  useEffect(() => {
    if (!currentSketch) {
      createSketch('New Sketch');
    }
  }, [currentSketch, createSketch]);

  // Handle file upload
  const handleFiles = useCallback(async (files: FileList) => {
    if (!currentSketch) return;
    
    for (const file of Array.from(files).slice(0, 5 - (currentSketch.samples.length || 0))) {
      const sampleId = crypto.randomUUID();
      
      // Add sample in uploading state
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
        // Upload and start separation
        const result = await api.upload(file, { autoSeparate: true, autoAnalyze: true });
        
        updateSampleStatus(sampleId, 'separating');
        
        // Poll for completion
        const pollForStems = async () => {
          const session = await api.getSession(result.session_id) as any;
          if (session.stems && session.stems.length > 0) {
            const stems: SharedStem[] = session.stems.map((s: any) => ({
              id: s.id,
              name: s.role,
              path: s.path,
              role: s.role,
              sessionId: result.session_id,
              audioUrl: `/files/${s.path}`,
              detected_key: session.detected_key || undefined,
              detected_bpm: session.bpm || undefined,
            }));
            updateSampleStatus(sampleId, 'ready', stems);
            
            // Auto-detect key/bpm from first sample
            if (currentSketch.samples.length === 0 && session.detected_key) {
              setTargetKey(session.detected_key);
            }
            if (currentSketch.samples.length === 0 && session.bpm) {
              setTargetBpm(session.bpm);
            }
          } else {
            setTimeout(pollForStems, 2000);
          }
        };
        setTimeout(pollForStems, 3000);
        
      } catch (error) {
        console.error('Upload failed:', error);
        updateSampleStatus(sampleId, 'error');
      }
    }
  }, [currentSketch, addSampleToSketch, updateSampleStatus, setTargetKey, setTargetBpm]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  // Get assignment for a role
  const getAssignment = (role: SketchRole) => 
    currentSketch?.assignments.find(a => a.role === role);

  // Assign a stem to the active role
  const handleStemClick = useCallback((sample: SketchSample, stem: SharedStem) => {
    assignStemToRole({
      role: activeRole,
      sampleId: sample.id,
      stemId: stem.id,
      stem,
    });
  }, [activeRole, assignStemToRole]);

  // Play a stem preview
  const playPreview = useCallback(async (stem: SharedStem) => {
    const ctx = audioEngine.current.getContext();
    if (!ctx) return;
    
    try {
      const response = await fetch(stem.audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0, 0, 3); // Play first 3 seconds
    } catch (e) {
      console.error('Preview failed:', e);
    }
  }, []);

  if (!currentSketch) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
      </div>
    );
  }

  const readySamples = currentSketch.samples.filter(s => s.status === 'ready');
  const canRecord = Object.keys(ROLE_CONFIG).some(role => getAssignment(role as SketchRole));

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">🎨 Sketch Pad</h1>
          <span className="text-zinc-500 text-sm">{currentSketch.name}</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Target Key/BPM */}
          <div className="flex items-center gap-2 text-sm">
            <Key className="w-4 h-4 text-zinc-500" />
            <select
              value={currentSketch.targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
            >
              {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-zinc-500" />
            <input
              type="number"
              value={currentSketch.targetBpm}
              onChange={(e) => setTargetBpm(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-16 text-sm"
            />
            <span className="text-zinc-500">BPM</span>
          </div>
          <button
            onClick={() => { clearSketch(); createSketch(); }}
            className="text-zinc-500 hover:text-white text-sm flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sample Pool */}
        <div className="w-80 border-r border-zinc-800 flex flex-col">
          <div className="p-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400 mb-2">
              SAMPLE POOL ({currentSketch.samples.length}/5)
            </h2>
            
            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all
                ${isDragging 
                  ? 'border-blue-500 bg-blue-500/10' 
                  : 'border-zinc-700 hover:border-zinc-500'
                }
                ${currentSketch.samples.length >= 5 ? 'opacity-50 pointer-events-none' : ''}
              `}
            >
              <Upload className="w-6 h-6 mx-auto mb-2 text-zinc-500" />
              <div className="text-sm text-zinc-400">
                Drop samples here
              </div>
              <div className="text-xs text-zinc-600 mt-1">
                MP3, WAV, FLAC • Max 5 samples
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
              className="hidden"
            />
          </div>

          {/* Sample List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {currentSketch.samples.map((sample, idx) => (
              <div
                key={sample.id}
                className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden"
              >
                <div className="px-3 py-2 flex items-center justify-between border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-zinc-700 flex items-center justify-center text-xs font-bold">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="text-sm font-medium truncate max-w-[150px]">
                      {sample.filename}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {sample.status === 'uploading' && (
                      <span className="text-xs text-blue-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Uploading
                      </span>
                    )}
                    {sample.status === 'separating' && (
                      <span className="text-xs text-amber-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Splitting
                      </span>
                    )}
                    {sample.status === 'ready' && (
                      <Check className="w-4 h-4 text-green-500" />
                    )}
                    {sample.status === 'error' && (
                      <X className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                </div>
                
                {/* Stems */}
                {sample.status === 'ready' && sample.stems.length > 0 && (
                  <div className="p-2 grid grid-cols-2 gap-1">
                    {sample.stems.map(stem => {
                      const isAssigned = currentSketch.assignments.some(
                        a => a.stemId === stem.id
                      );
                      const assignedTo = currentSketch.assignments.find(
                        a => a.stemId === stem.id
                      );
                      
                      return (
                        <button
                          key={stem.id}
                          onClick={() => handleStemClick(sample, stem)}
                          onDoubleClick={() => playPreview(stem)}
                          className={`
                            px-2 py-1.5 rounded text-xs font-medium transition-all
                            flex items-center justify-between gap-1
                            ${isAssigned 
                              ? `bg-${ROLE_CONFIG[assignedTo!.role].color}-500/20 
                                 border border-${ROLE_CONFIG[assignedTo!.role].color}-500/50
                                 text-${ROLE_CONFIG[assignedTo!.role].color}-400`
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                            }
                          `}
                        >
                          <span className="capitalize">{stem.role}</span>
                          {isAssigned && (
                            <span className="text-[10px] opacity-70">
                              → {assignedTo!.role}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            
            {currentSketch.samples.length === 0 && (
              <div className="text-center py-8 text-zinc-600">
                <Music className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">No samples yet</div>
                <div className="text-xs mt-1">Upload 3-5 songs to start</div>
              </div>
            )}
          </div>
        </div>

        {/* Center: Role Assignment + Pads */}
        <div className="flex-1 flex flex-col">
          {/* Role Tabs */}
          <div className="flex-shrink-0 border-b border-zinc-800 px-4 py-2 flex items-center gap-2">
            {(Object.entries(ROLE_CONFIG) as [SketchRole, typeof ROLE_CONFIG[SketchRole]][]).map(([role, config]) => {
              const assignment = getAssignment(role);
              const isActive = activeRole === role;
              
              return (
                <button
                  key={role}
                  onClick={() => setActiveRole(role)}
                  className={`
                    px-4 py-2 rounded-lg flex items-center gap-2 transition-all
                    ${isActive 
                      ? `bg-${config.color}-500/20 border border-${config.color}-500/50 text-${config.color}-400` 
                      : 'bg-zinc-800/50 border border-transparent text-zinc-400 hover:text-white'
                    }
                  `}
                >
                  {config.icon}
                  <span className="text-sm font-medium">{config.label}</span>
                  {assignment && (
                    <Check className="w-3 h-3 text-green-500" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Current Role Assignment */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
            {(() => {
              const assignment = getAssignment(activeRole);
              const config = ROLE_CONFIG[activeRole];
              
              if (assignment) {
                const sample = currentSketch.samples.find(s => s.id === assignment.sampleId);
                return (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-${config.color}-500/20`}>
                        {config.icon}
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{config.label}</div>
                        <div className="text-xs text-zinc-500">
                          {sample?.filename} → {assignment.stem.role}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeAssignment(activeRole)}
                      className="text-zinc-500 hover:text-red-400 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              }
              
              return (
                <div className="text-center py-2 text-zinc-500 text-sm">
                  Click a stem from the sample pool to assign it to <strong>{config.label}</strong>
                </div>
              );
            })()}
          </div>

          {/* Pad Grid Placeholder */}
          <div className="flex-1 p-4 flex items-center justify-center">
            {canRecord ? (
              <div className="text-center">
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <button
                      key={i}
                      className="w-16 h-16 rounded-lg bg-zinc-800 border border-zinc-700 
                                 hover:bg-zinc-700 active:bg-zinc-600 transition-all
                                 flex items-center justify-center text-zinc-500 font-mono text-sm"
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <div className="text-zinc-500 text-sm">
                  Keys: 1-4, Q-R, A-F, Z-V
                </div>
              </div>
            ) : (
              <div className="text-center text-zinc-600">
                <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <div className="text-lg font-medium mb-1">Assign stems first</div>
                <div className="text-sm">
                  Upload samples and click stems to assign them to roles
                </div>
              </div>
            )}
          </div>

          {/* Transport */}
          <div className="flex-shrink-0 border-t border-zinc-800 px-4 py-3 flex items-center justify-center gap-4">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!canRecord}
              className={`
                p-3 rounded-full transition-all
                ${isPlaying 
                  ? 'bg-green-500 text-white' 
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }
                ${!canRecord ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {isPlaying ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setIsRecording(!isRecording)}
              disabled={!canRecord}
              className={`
                p-3 rounded-full transition-all
                ${isRecording 
                  ? 'bg-red-500 text-white animate-pulse' 
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }
                ${!canRecord ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <Circle className="w-5 h-5" fill={isRecording ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>

        {/* Right: Sequences */}
        <div className="w-64 border-l border-zinc-800 flex flex-col">
          <div className="p-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400">SEQUENCES</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {currentSketch.sequences.length === 0 ? (
              <div className="text-center py-8 text-zinc-600 text-sm">
                <div className="mb-2">No sequences yet</div>
                <div className="text-xs">Record pads to create sequences</div>
              </div>
            ) : (
              currentSketch.sequences.map(seq => (
                <div
                  key={seq.id}
                  className="bg-zinc-900 rounded-lg p-3 mb-2 border border-zinc-800"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium capitalize">{seq.role}</span>
                    <span className="text-xs text-zinc-500">{seq.bars} bars</span>
                  </div>
                  <div className="h-8 bg-zinc-800 rounded flex items-end gap-px px-1">
                    {seq.events.slice(0, 32).map((ev, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-blue-500 rounded-t"
                        style={{ height: `${ev.velocity * 100}%` }}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SketchPad;
