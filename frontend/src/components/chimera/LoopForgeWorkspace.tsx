/**
 * LoopForgeWorkspace - Main application workspace
 * 
 * Chimera Design Language: Arrival meets Sneakers meets Google meets MIT
 * 
 * Workflow:
 * 1. Upload → 2. Separate → 3. Slice → 4. Sequence → 5. Export
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload,
  Scissors,
  Grid3X3,
  Download,
  Play,
  Pause,
  Settings,
  Check,
  AlertCircle,
  Music,
  Drum,
  Mic2,
  Waves,
  ChevronRight,
  X,
  FolderOpen,
  Sparkles,
  Copy,
  Keyboard,
  Loader2,
  Zap,
  Clock,
  Send,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { api } from '../../api/client';
import SliceSequencer from './SliceSequencer';
import HarmonicFilterPanel from '../effects/HarmonicFilterPanel';
import { useSession, SharedStem } from '../../contexts/SessionContext';

// =============================================================================
// TYPES
// =============================================================================

type WorkflowStage = 'upload' | 'separating' | 'slicing' | 'sequencing' | 'export';

interface StemInfo {
  name: string;
  path: string;
  role: 'drums' | 'bass' | 'vocals' | 'other';
  sliceBankId?: string;
  // Per-stem analysis
  detected_key?: string;
  detected_bpm?: number;
  key_confidence?: number;
}

interface SessionState {
  id: string;
  filename: string;
  bpm: number;
  key: string;
  stems: StemInfo[];
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

const StageIndicator: React.FC<{
  stages: { id: WorkflowStage; label: string; icon: React.ReactNode }[];
  currentStage: WorkflowStage;
}> = ({ stages, currentStage }) => {
  const currentIndex = stages.findIndex(s => s.id === currentStage);
  
  return (
    <div className="flex items-center gap-2">
      {stages.map((stage, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        
        return (
          <React.Fragment key={stage.id}>
            <div
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all
                ${isComplete ? 'bg-emerald-500/20 text-emerald-400' : ''}
                ${isCurrent ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/50' : ''}
                ${!isComplete && !isCurrent ? 'bg-zinc-800/50 text-zinc-500' : ''}
              `}
            >
              <span className="w-4 h-4">
                {isComplete ? <Check className="w-4 h-4" /> : stage.icon}
              </span>
              <span className="hidden sm:inline">{stage.label}</span>
            </div>
            {index < stages.length - 1 && (
              <ChevronRight className={`w-4 h-4 ${index < currentIndex ? 'text-emerald-500' : 'text-zinc-700'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const GlyphLoader: React.FC<{ progress: number; stage: string }> = ({ progress, stage }) => {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Arrival-inspired circular glyph */}
      <div className="relative w-32 h-32">
        {/* Outer ring */}
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            className="text-zinc-800"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="text-amber-500 transition-all duration-300"
          />
        </svg>
        
        {/* Inner content */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <span className="text-2xl font-mono text-amber-400">{Math.round(progress)}%</span>
          </div>
        </div>
        
        {/* Rotating elements */}
        <div 
          className="absolute inset-0 animate-spin"
          style={{ animationDuration: '8s' }}
        >
          {[0, 90, 180, 270].map((angle) => (
            <div
              key={angle}
              className="absolute w-2 h-2 bg-amber-500/30 rounded-full"
              style={{
                top: '50%',
                left: '50%',
                transform: `rotate(${angle}deg) translateY(-40px) translateX(-50%)`,
              }}
            />
          ))}
        </div>
      </div>
      
      {/* Status text - Sneakers style */}
      <div className="text-center space-y-1">
        <div className="font-mono text-sm text-amber-400">{stage}</div>
        <div className="font-mono text-xs text-zinc-500">
          {progress < 30 && 'LOADING NEURAL NETWORKS...'}
          {progress >= 30 && progress < 60 && 'SEPARATING SOURCES...'}
          {progress >= 60 && progress < 90 && 'ANALYZING TRANSIENTS...'}
          {progress >= 90 && 'FINALIZING...'}
        </div>
      </div>
    </div>
  );
};

const StemRoleIcon: React.FC<{ role: string; className?: string }> = ({ role, className = "w-4 h-4" }) => {
  switch (role) {
    case 'drums': return <Drum className={className} />;
    case 'bass': return <Waves className={className} />;
    case 'vocals': return <Mic2 className={className} />;
    default: return <Music className={className} />;
  }
};

// Role-based styling (static classes for Tailwind compilation)
const ROLE_STYLES = {
  drums: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/50',
    ring: 'ring-amber-500/30',
    iconBg: 'bg-amber-500/20',
    iconText: 'text-amber-400',
    accent: 'text-amber-400',
  },
  bass: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/50',
    ring: 'ring-purple-500/30',
    iconBg: 'bg-purple-500/20',
    iconText: 'text-purple-400',
    accent: 'text-purple-400',
  },
  vocals: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/50',
    ring: 'ring-cyan-500/30',
    iconBg: 'bg-cyan-500/20',
    iconText: 'text-cyan-400',
    accent: 'text-cyan-400',
  },
  other: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/50',
    ring: 'ring-emerald-500/30',
    iconBg: 'bg-emerald-500/20',
    iconText: 'text-emerald-400',
    accent: 'text-emerald-400',
  },
};

const StemCard: React.FC<{
  stem: StemInfo;
  isSelected: boolean;
  isAnalyzing?: boolean;
  onClick: () => void;
  onDownload: () => void;
  onPreview: () => void;
  onSendToPitchify: () => void;
  isPlaying?: boolean;
  sessionKey?: string;
}> = ({ stem, isSelected, isAnalyzing, onClick, onDownload, onPreview, onSendToPitchify, isPlaying, sessionKey }) => {
  const style = ROLE_STYLES[stem.role] || ROLE_STYLES.other;
  
  // Check for key mismatch with session
  const keyMismatch = sessionKey && stem.detected_key && 
    !stem.detected_key.startsWith(sessionKey.split(' ')[0]);
  
  return (
    <div
      className={`
        relative p-4 rounded-xl border transition-all cursor-pointer group
        ${isSelected 
          ? `${style.bg} ${style.border} ring-2 ${style.ring}` 
          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'}
      `}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`
            w-10 h-10 rounded-lg flex items-center justify-center
            ${isSelected ? style.iconBg : 'bg-zinc-800'}
          `}>
            <StemRoleIcon 
              role={stem.role} 
              className={`w-5 h-5 ${isSelected ? style.iconText : 'text-zinc-400'}`}
            />
          </div>
          <div>
            <h4 className="text-sm font-medium text-zinc-200 capitalize flex items-center gap-2">
              {stem.role}
              {isAnalyzing && (
                <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />
              )}
            </h4>
            <p className="text-xs text-zinc-500 truncate max-w-[120px]">{stem.name}</p>
          </div>
        </div>
        
        {/* Quick actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onPreview(); }}
            className={`p-1.5 rounded-lg transition-colors ${
              isPlaying 
                ? 'bg-amber-500/20 text-amber-400' 
                : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
            title="Preview (Space)"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSendToPitchify(); }}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-purple-400 hover:bg-purple-500/20 transition-colors"
            title="Send to Pitchify Lab"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(); }}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Download stem"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      {/* Per-stem key/bpm analysis */}
      {(stem.detected_key || stem.detected_bpm) && (
        <div className="mt-3 pt-3 border-t border-zinc-800/50">
          <div className="flex items-center justify-between">
            {stem.detected_key && (
              <div className="flex items-center gap-1.5">
                <Music className="w-3 h-3 text-zinc-500" />
                <span className={`text-xs font-mono ${keyMismatch ? 'text-amber-400' : 'text-zinc-300'}`}>
                  {stem.detected_key}
                </span>
                {keyMismatch && (
                  <span className="text-[10px] text-amber-500" title="Different from session key">⚠</span>
                )}
                {stem.key_confidence !== undefined && stem.key_confidence < 0.5 && (
                  <span className="text-[10px] text-zinc-600" title="Low confidence">?</span>
                )}
              </div>
            )}
            {stem.detected_bpm && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-zinc-500" />
                <span className="text-xs font-mono text-zinc-300">{Math.round(stem.detected_bpm)}</span>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Status badges */}
      {stem.sliceBankId && (
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400">
            <Grid3X3 className="w-2.5 h-2.5" />
            Sliced
          </span>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const LoopForgeWorkspace: React.FC = () => {
  // State
  const [stage, setStage] = useState<WorkflowStage>('upload');
  const [session, setSession] = useState<SessionState | null>(null);
  const [selectedStem, setSelectedStem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEffects, setShowEffects] = useState(false);
  const [playingStem, setPlayingStem] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Shared session context for Pitchify Lab integration
  const { sendToPitchifyLab } = useSession();
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  
  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);
  
  const stages = [
    { id: 'upload' as const, label: 'Upload', icon: <Upload className="w-4 h-4" /> },
    { id: 'separating' as const, label: 'Separate', icon: <Scissors className="w-4 h-4" /> },
    { id: 'slicing' as const, label: 'Slice', icon: <Grid3X3 className="w-4 h-4" /> },
    { id: 'sequencing' as const, label: 'Sequence', icon: <Play className="w-4 h-4" /> },
    { id: 'export' as const, label: 'Export', icon: <Download className="w-4 h-4" /> },
  ];

  // =============================================================================
  // FILE UPLOAD & SEPARATION
  // =============================================================================

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    
    setError(null);
    setIsProcessing(true);
    setStage('separating');
    setProgress(0);
    setProgressStage('Uploading...');
    
    try {
      // Upload using new API client
      const uploadResult = await api.upload(file, {
        autoSeparate: true,
        autoAnalyze: true,
      });
      
      const sessionId = uploadResult.session_id;
      
      // Connect to WebSocket for progress
      const wsUrl = api.getWebSocketUrl(sessionId);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Handle job progress events
        if (data.type === 'job.progress' && data.data) {
          setProgress(data.data.progress || 0);
          setProgressStage(data.data.stage || 'Processing...');
        }
        
        // Handle job completion - only separation jobs have stems
        if (data.type === 'job.completed' && data.data) {
          const jobType = data.data.job_type;
          const outputPaths = data.data.output_paths || {};
          const stemNames = Object.keys(outputPaths);
          
          // Only process separation jobs with stems
          if (jobType === 'separation' && stemNames.length > 0) {
            const stems: StemInfo[] = stemNames.map((name: string) => ({
              name: `${file.name.replace(/\.[^/.]+$/, '')}_${name}.wav`,
              path: outputPaths[name],
              role: name as StemInfo['role'],
            }));
            
            // Fetch full session data
            api.getSession(sessionId).then((sess) => {
              setSession({
                id: sessionId,
                filename: file.name,
                bpm: sess.bpm || 120,
                key: sess.key || 'C',
                stems,
              });
              
              setIsProcessing(false);
              setStage('slicing');
              
              if (stems.length > 0) {
                setSelectedStem(stems[0].role);
              }
            });
          }
          
          // Refresh session when stem analysis completes (to get key/bpm per stem)
          if (jobType === 'stem_analysis') {
            setIsAnalyzing(false);
            api.getSession(sessionId).then((sess) => {
              setSession(prev => {
                if (!prev) return prev;
                // Update stems with analysis data from API
                const updatedStems = prev.stems.map(stem => {
                  const apiStem = sess.stems?.find((s: any) => s.name === stem.role);
                  if (apiStem) {
                    return {
                      ...stem,
                      detected_key: apiStem.detected_key,
                      detected_bpm: apiStem.detected_bpm,
                      key_confidence: apiStem.key_confidence,
                    };
                  }
                  return stem;
                });
                return { ...prev, stems: updatedStems };
              });
            });
          }
          
          // Track when stem analysis starts
          if (data.data.job_type === 'stem_analysis' && data.type === 'job.started') {
            setIsAnalyzing(true);
          }
        }
        
        // Handle job failure
        if (data.type === 'job.failed' && data.data) {
          setError(data.data.error || 'Processing failed');
          setIsProcessing(false);
          setStage('upload');
        }
      };
      
      ws.onerror = () => {
        setError('Connection lost. Please try again.');
        setIsProcessing(false);
        setStage('upload');
      };
      
    } catch (err) {
      console.error('Upload error:', err);
      setError('Upload failed. Please try again.');
      setIsProcessing(false);
      setStage('upload');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aiff'],
    },
    maxFiles: 1,
  });

  // =============================================================================
  // STEM OPERATIONS
  // =============================================================================

  const handleDownloadStem = useCallback((stem: StemInfo) => {
    if (!session) return;
    const url = api.getStemDownloadUrl(session.id, stem.role);
    window.open(url, '_blank');
  }, [session]);

  const handleDownloadAll = useCallback(() => {
    if (!session) return;
    const url = api.getAllStemsDownloadUrl(session.id);
    window.open(url, '_blank');
  }, [session]);

  const handleSliceBankCreated = useCallback((stemRole: string, bankId: string) => {
    setSession(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        stems: prev.stems.map(s => 
          s.role === stemRole ? { ...s, sliceBankId: bankId } : s
        ),
      };
    });
  }, []);

  // Send stem to Pitchify Lab
  const handleSendToPitchify = useCallback((stem: StemInfo) => {
    if (!session) return;
    
    const sharedStem: SharedStem = {
      id: `${session.id}-${stem.role}`,
      name: stem.name,
      path: stem.path,
      role: stem.role,
      sessionId: session.id,
      audioUrl: `/files/${stem.path}`,
      detected_key: stem.detected_key,
      detected_bpm: stem.detected_bpm,
    };
    
    // Store in localStorage for persistence across view switch
    localStorage.setItem('pitchify_pending_stem', JSON.stringify(sharedStem));
    
    // Add to context (for same-session access)
    sendToPitchifyLab(sharedStem);
    
    // Switch to Pitchify Lab via hash change (App.tsx listens to this)
    window.location.hash = '#pitchify';
  }, [session, sendToPitchifyLab]);

  // Audio preview
  const handlePreviewStem = useCallback((stem: StemInfo) => {
    if (!session) return;
    
    // If already playing this stem, stop
    if (playingStem === stem.role) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingStem(null);
      return;
    }
    
    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    // Start new playback
    const url = `/files/${stem.path}`;
    const audio = new Audio(url);
    audioRef.current = audio;
    
    audio.onended = () => {
      setPlayingStem(null);
      audioRef.current = null;
    };
    
    audio.onerror = () => {
      setPlayingStem(null);
      audioRef.current = null;
    };
    
    audio.play();
    setPlayingStem(stem.role);
  }, [session, playingStem]);

  // Copy to clipboard helper
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  // =============================================================================
  // RENDER
  // =============================================================================

  const selectedStemData = session?.stems.find(s => s.role === selectedStem);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <Scissors className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">Loop Forge</h1>
                <p className="text-xs text-zinc-500 -mt-0.5">Generative Sample Lab</p>
              </div>
            </div>
            
            {/* Stage Indicator */}
            <StageIndicator stages={stages} currentStage={stage} />
            
            {/* Actions */}
            <div className="flex items-center gap-2">
              {session && (
                <button
                  onClick={handleDownloadAll}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Export All</span>
                </button>
              )}
              <button className="p-2 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
            <button 
              onClick={() => setError(null)}
              className="ml-auto p-1 text-red-400 hover:text-red-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Upload Stage */}
        {stage === 'upload' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div
              {...getRootProps()}
              className={`
                w-full max-w-2xl p-12 rounded-2xl border-2 border-dashed transition-all cursor-pointer
                ${isDragActive 
                  ? 'border-amber-500 bg-amber-500/10' 
                  : 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/30'}
              `}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center text-center gap-4">
                <div className={`
                  w-16 h-16 rounded-2xl flex items-center justify-center transition-colors
                  ${isDragActive ? 'bg-amber-500/20' : 'bg-zinc-800'}
                `}>
                  <Upload className={`w-8 h-8 ${isDragActive ? 'text-amber-400' : 'text-zinc-400'}`} />
                </div>
                <div>
                  <h2 className="text-xl font-medium text-zinc-200">
                    {isDragActive ? 'Drop to upload' : 'Drop your audio file'}
                  </h2>
                  <p className="text-sm text-zinc-500 mt-1">
                    MP3, WAV, FLAC, M4A, OGG, AIFF supported
                  </p>
                </div>
                <button className="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black font-medium rounded-lg transition-colors">
                  Browse Files
                </button>
              </div>
            </div>
            
            {/* Workflow preview */}
            <div className="mt-10 w-full max-w-2xl">
              <h3 className="text-xs text-zinc-600 uppercase tracking-wide mb-4 text-center">What happens next</h3>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { icon: <Scissors className="w-5 h-5" />, label: 'Separate', desc: 'AI splits stems' },
                  { icon: <Zap className="w-5 h-5" />, label: 'Analyze', desc: 'Key & BPM detection' },
                  { icon: <Grid3X3 className="w-5 h-5" />, label: 'Slice', desc: 'Transient detection' },
                  { icon: <Sparkles className="w-5 h-5" />, label: 'Transform', desc: 'Effects & export' },
                ].map((step, i) => (
                  <div key={i} className="text-center p-3 rounded-xl bg-zinc-900/30 border border-zinc-800/50">
                    <div className="w-10 h-10 mx-auto rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500 mb-2">
                      {step.icon}
                    </div>
                    <div className="text-xs font-medium text-zinc-400">{step.label}</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">{step.desc}</div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Recent files */}
            <div className="mt-8 text-center">
              <button className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                <FolderOpen className="w-4 h-4" />
                View Recent Sessions
              </button>
            </div>
          </div>
        )}

        {/* Separating Stage */}
        {stage === 'separating' && isProcessing && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <GlyphLoader progress={progress} stage={progressStage} />
          </div>
        )}

        {/* Slicing & Sequencing Stage */}
        {(stage === 'slicing' || stage === 'sequencing') && session && (
          <div className="grid grid-cols-12 gap-6">
            {/* Stem Sidebar */}
            <div className="col-span-12 lg:col-span-3 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">Stems</h2>
                <span className="text-xs text-zinc-600">{session.stems.length} tracks</span>
              </div>
              
              <div className="space-y-3">
                {session.stems.map((stem) => (
                  <StemCard
                    key={stem.role}
                    stem={stem}
                    isSelected={selectedStem === stem.role}
                    isAnalyzing={isAnalyzing}
                    onClick={() => setSelectedStem(stem.role)}
                    onDownload={() => handleDownloadStem(stem)}
                    onPreview={() => handlePreviewStem(stem)}
                    onSendToPitchify={() => handleSendToPitchify(stem)}
                    isPlaying={playingStem === stem.role}
                    sessionKey={session.key}
                  />
                ))}
              </div>
              
              {/* Session Info */}
              <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Session</h3>
                  <button
                    onClick={() => copyToClipboard(`${session.key} ${session.bpm}bpm`)}
                    className="p-1 rounded text-zinc-600 hover:text-zinc-400 transition-colors"
                    title="Copy key & BPM"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500">File</span>
                    <span className="text-zinc-300 truncate ml-2 max-w-[130px]" title={session.filename}>
                      {session.filename}
                    </span>
                  </div>
                  <div className="flex justify-between items-center group">
                    <span className="text-zinc-500">BPM</span>
                    <button 
                      onClick={() => copyToClipboard(String(session.bpm))}
                      className="flex items-center gap-1 text-zinc-300 font-mono hover:text-amber-400 transition-colors"
                    >
                      {session.bpm}
                      <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-50" />
                    </button>
                  </div>
                  <div className="flex justify-between items-center group">
                    <span className="text-zinc-500">Key</span>
                    <button 
                      onClick={() => copyToClipboard(session.key)}
                      className="flex items-center gap-1 text-zinc-300 font-mono hover:text-amber-400 transition-colors"
                    >
                      {session.key}
                      <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-50" />
                    </button>
                  </div>
                </div>
                
                {/* Keyboard shortcuts hint */}
                <div className="pt-2 border-t border-zinc-800/50">
                  <button className="w-full flex items-center justify-between text-[10px] text-zinc-600 hover:text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Keyboard className="w-3 h-3" />
                      Shortcuts
                    </span>
                    <span className="font-mono">?</span>
                  </button>
                </div>
              </div>
              
              {/* Harmonic Filter Effect */}
              {selectedStemData && (
                <div className="space-y-2">
                  <button
                    onClick={() => setShowEffects(!showEffects)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900/50 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-3 h-3" />
                      Effects
                    </span>
                    <ChevronRight className={`w-3 h-3 transition-transform ${showEffects ? 'rotate-90' : ''}`} />
                  </button>
                  
                  {showEffects && (
                    <HarmonicFilterPanel
                      sessionId={session.id}
                      stemPath={selectedStemData.path}
                      stemRole={selectedStemData.role}
                      detectedKey={selectedStemData.detected_key}
                      sessionKey={session.key}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Main Workspace */}
            <div className="col-span-12 lg:col-span-9 space-y-6">
              {selectedStemData ? (
                <SliceSequencer
                  sessionId={session.id}
                  stemPath={selectedStemData.path}
                  stemRole={selectedStemData.role}
                  bpm={session.bpm}
                  onSliceBankCreated={(bankId) => handleSliceBankCreated(selectedStemData.role, bankId)}
                  availableBanks={session.stems
                    .filter(s => s.sliceBankId)
                    .map(s => ({
                      id: s.sliceBankId!,
                      sourceFilename: s.name,
                      role: s.role,
                      numSlices: 0,
                      totalDuration: 0,
                      slices: [],
                    }))}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-64 bg-zinc-900/50 rounded-xl border border-zinc-800 border-dashed">
                  <Grid3X3 className="w-10 h-10 text-zinc-700 mb-3" />
                  <p className="text-zinc-500 font-medium">Select a stem to begin</p>
                  <p className="text-xs text-zinc-600 mt-1">Click a stem on the left to slice and sequence</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between text-xs text-zinc-600">
            <span>Loop Forge v1.0 • Generative Sample Laboratory</span>
            <span className="font-mono">
              "How we play the system dictates how the system responds"
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LoopForgeWorkspace;
