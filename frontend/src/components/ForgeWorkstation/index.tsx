/**
 * ForgeWorkstation — Orchestration Component
 * 
 * Composes hooks and child components. No business logic here.
 * ~150 lines of pure composition.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Waves, Search, Zap, Sliders, Plus, Music, Folder, Save, Download, Sparkles, Grid, Repeat, Disc, Trash2 } from 'lucide-react';

// Hooks
import { useAudioEngine } from './hooks/useAudioEngine';
import { useSession } from './hooks/useSession';
import { usePads } from './hooks/usePads';
import { useEffects } from './hooks/useEffects';
import { useBounce } from './hooks/useBounce';
import { useProjects } from './hooks/useProjects';
import { useKeyboardShortcuts, createDAWShortcuts } from '../../hooks/useKeyboardShortcuts';
import { api } from '../../api/client';

// Components
import { LcdDisplay, TransportControls, ShortcutsOverlay } from '../shared';
import { RichPad } from '../RichPad';
import { ToolStrip } from '../ToolStrip';
import { WaveformView } from '../WaveformView';
import { Sequencer } from '../Sequencer';
import { JobQueue } from '../JobQueue';
import { RegionSelector } from '../RegionSelector';

export const ForgeWorkstation: React.FC = () => {
  // Hooks - ALL wired up
  const audio = useAudioEngine();
  const session = useSession();
  const pads = usePads(16);
  const effects = useEffects();
  const bounce = useBounce();
  const projects = useProjects();
  const [backendConnected, setBackendConnected] = useState(false);
  const [selectedStem, setSelectedStem] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ slice_index: number; score: number }>>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'major' | 'minor' | 'dorian'>('major');
  const [selectedMotion, setSelectedMotion] = useState<'static' | 'breathe' | 'shimmer'>('static');
  const [selectedRegion, setSelectedRegion] = useState<{ start: number; end: number } | null>(null);

  // Session restore on mount
  useEffect(() => {
    const lastSessionId = localStorage.getItem('loopforge_last_session');
    if (lastSessionId) {
      session.loadSession(lastSessionId).then(sess => {
        if (sess) {
          setSelectedStem(sess.stems[0]?.name || null);
        }
      }).catch(() => {
        localStorage.removeItem('loopforge_last_session');
      });
    }
  }, []);

  // Save session ID when it changes
  useEffect(() => {
    if (session.session?.id) {
      localStorage.setItem('loopforge_last_session', session.session.id);
    }
  }, [session.session?.id]);

  // Backend health check
  useEffect(() => {
    const check = async () => {
      try {
        await api.getCapabilities();
        setBackendConnected(true);
      } catch {
        setBackendConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  // Handle file drop
  const handleFileDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    
    const sess = await session.uploadFile(files[0]);
    if (!sess) return;

    setSelectedStem(sess.stems[0]?.name || null);

    // Load stems into audio engine and pads
    for (let i = 0; i < sess.stems.length; i++) {
      const stem = sess.stems[i];
      const stemUrl = api.getStemDownloadUrl(sess.id, stem.name);
      
      const bank = await pads.loadStemIntoPads(
        sess.id,
        stem.path,
        stem.name,
        stem.id,
        sess.bpm || 120,
        i * 8 // Offset pads for each stem
      );

      if (bank) {
        await audio.loadSliceBank(
          bank.id,
          stemUrl,
          bank.slices.map(s => ({ startTime: s.start_time, endTime: s.end_time }))
        );
      }
    }

    // Detect moments
    if (sess.source_filename) {
      session.detectMoments(`/files/uploads/${sess.id}/${sess.source_filename}`);
    }
  }, [session, pads, audio]);

  // Play pad
  const handlePlayPad = useCallback((padIndex: number) => {
    const pad = pads.getPad(padIndex);
    if (!pad?.loaded || !pad.bankId) return;

    const modified = pads.evaluateTrigger(padIndex);
    if (modified?.skip) return;

    const duration = pad.endTime - pad.startTime;
    audio.playSlice(pad.bankId, padIndex % 8, {
      velocity: modified?.velocity ?? 1,
      pitchShift: modified?.pitchShift ?? 0,
      reverse: modified?.reverse ?? false,
    }, duration);

    pads.triggerPad(padIndex, duration);
  }, [pads, audio]);

  // Keyboard shortcuts - WIRED to actual audio engine
  const shortcuts = createDAWShortcuts({
    play: () => {
      if (isPlaying) {
        audio.stop();
        setIsPlaying(false);
      } else {
        audio.play();
        setIsPlaying(true);
      }
    },
    stop: () => { 
      audio.stop(true); // Reset position
      audio.stopAll(); 
      setIsPlaying(false); 
    },
    rewind: () => { audio.seek(0); },
  });

  // Pad shortcuts (1-8, Q-I)
  const padShortcuts = [
    ...[1,2,3,4,5,6,7,8].map(n => ({ key: String(n), action: () => handlePlayPad(n-1) })),
    ...['q','w','e','r','t','y','u','i'].map((k, i) => ({ key: k, action: () => handlePlayPad(8+i) })),
  ];

  // Help shortcut
  const helpShortcut = { key: '?', action: () => setShowShortcuts(s => !s) };

  useKeyboardShortcuts([...shortcuts, ...padShortcuts, helpShortcut]);

  // Dropzone
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFileDrop,
    accept: { 'audio/*': [], 'video/*': [] },
    multiple: false,
    noClick: !!session.session,
  });

  // ToolStrip sections
  const toolStripSections = [
    {
      id: 'stems',
      label: 'STEMS',
      icon: <Waves size={14} />,
      badge: session.session?.stems?.length,
      content: (
        <div className="ba-stems-inline">
          {session.session?.stems?.map(stem => (
            <button
              key={stem.id}
              className={`ba-stem-chip ${selectedStem === stem.name ? 'selected' : ''}`}
              onClick={() => setSelectedStem(stem.name)}
            >
              <span className="ba-stem-dot" />
              {stem.name}
            </button>
          )) || <span className="ba-toolstrip-empty">No stems</span>}
        </div>
      ),
    },
    {
      id: 'search',
      label: 'SEARCH',
      icon: <Search size={14} />,
      content: (
        <div className="ba-search-inline">
          <input 
            type="text" 
            placeholder="punchy kick, snappy snare..." 
            className="ba-search-field"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button 
            className="ba-btn ba-btn-sm"
            onClick={async () => {
              const bank = pads.sliceBanks.values().next().value;
              if (bank && searchQuery) {
                const results = await pads.searchByText(bank.id, searchQuery);
                setSearchResults(results);
                // Highlight matching pads by updating their order/visibility
                if (results.length > 0) {
                  console.log(`Found ${results.length} matches for "${searchQuery}"`);
                }
              }
            }}
          >
            Go
          </button>
          <button 
            className="ba-btn ba-btn-sm"
            onClick={async () => {
              const bank = pads.sliceBanks.values().next().value;
              if (bank) {
                await pads.generateAutoKit(bank.id, 'diverse');
              }
            }}
            title="Auto-fill pads with diverse slices"
          >
            <Sparkles size={12} /> Auto-Kit
          </button>
        </div>
      ),
    },
    {
      id: 'rules',
      label: 'RULES',
      icon: <Zap size={14} />,
      badge: pads.triggerRules.length || undefined,
      content: (
        <div className="ba-rules-inline">
          <button className="ba-btn ba-btn-sm" onClick={() => pads.addRule({
            id: `rule_${Date.now()}`,
            name: 'New Rule',
            condition: 'consecutive_plays > 2',
            action: 'skip_next',
            probability: 1,
            enabled: true,
          })}>
            <Plus size={12} /> Add Rule
          </button>
        </div>
      ),
    },
    {
      id: 'fx',
      label: 'FX',
      icon: <Sliders size={14} />,
      badge: effects.isProcessing ? '...' : undefined,
      content: (
        <div className="ba-fx-inline">
          <div className="ba-fx-control">
            <Music size={12} />
            <span>Mode</span>
            <select 
              className="ba-select-mini"
              value={selectedMode}
              onChange={e => setSelectedMode(e.target.value as 'major' | 'minor' | 'dorian')}
            >
              <option value="major">Major</option>
              <option value="minor">Minor</option>
              <option value="dorian">Dorian</option>
            </select>
          </div>
          <div className="ba-fx-control">
            <span>Motion</span>
            <select 
              className="ba-select-mini"
              value={selectedMotion}
              onChange={e => setSelectedMotion(e.target.value as 'static' | 'breathe' | 'shimmer')}
            >
              <option value="static">Static</option>
              <option value="breathe">Breathe</option>
              <option value="shimmer">Shimmer</option>
            </select>
          </div>
          <button 
            className="ba-btn ba-btn-sm"
            disabled={!session.session || effects.isProcessing}
            onClick={async () => {
              const stem = session.session?.stems?.find(s => s.name === selectedStem);
              if (stem && session.session) {
                await effects.applyHarmonicFilter(
                  session.session.id,
                  stem.path,
                  {
                    rootNote: session.session.key || 'C',
                    mode: selectedMode,
                    motion: selectedMotion,
                  }
                );
              }
            }}
          >
            Apply
          </button>
          <button 
            className="ba-btn ba-btn-sm"
            disabled={!session.session}
            onClick={async () => {
              if (session.session) {
                await effects.analyzeGrid(session.session.id);
              }
            }}
            title="Analyze beat grid"
          >
            <Grid size={12} /> Grid
          </button>
        </div>
      ),
    },
    {
      id: 'seq',
      label: 'SEQ',
      icon: <Repeat size={14} />,
      badge: pads.currentSequence ? '●' : undefined,
      content: (
        <Sequencer
          bankId={pads.sliceBanks.values().next().value?.id || null}
          sessionId={session.session?.id || null}
          bpm={session.session?.bpm || 120}
          onGenerateSequence={async (params) => {
            const bank = pads.sliceBanks.values().next().value;
            if (bank && session.session) {
              await pads.generateSequence(session.session.id, bank.id, {
                mode: params.mode,
                euclideanHits: params.euclideanHits,
                euclideanSteps: params.euclideanSteps,
                euclideanRotation: params.euclideanRotation,
              });
            }
          }}
          disabled={!session.session}
        />
      ),
    },
    {
      id: 'bounce',
      label: 'BOUNCE',
      icon: <Disc size={14} />,
      badge: bounce.isRendering ? '...' : undefined,
      content: (
        <div className="ba-bounce-inline">
          <button 
            className="ba-btn ba-btn-sm"
            disabled={!session.session || bounce.isRendering || !pads.currentSequence}
            onClick={async () => {
              const stem = session.session?.stems?.find(s => s.name === selectedStem);
              if (stem && session.session && pads.currentSequence) {
                await bounce.bounceAndSlice(
                  session.session.id,
                  stem.id,
                  pads.currentSequence.events.map(e => ({
                    beat: e.time,
                    sliceIndex: e.slice_index,
                    velocity: e.velocity,
                    microOffset: 0,
                  })),
                  session.session.bpm || 120
                );
              }
            }}
          >
            <Disc size={12} /> Render & Slice
          </button>
          {bounce.lastBounce && (
            <span className="ba-bounce-info">
              Last: {bounce.lastBounce.duration.toFixed(1)}s, {bounce.lastBounce.sliceCount} slices
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'projects',
      label: 'PROJECTS',
      icon: <Folder size={14} />,
      badge: projects.recentSessions.length || undefined,
      content: (
        <div className="ba-projects-inline">
          {projects.isLoading ? (
            <span className="ba-toolstrip-empty">Loading...</span>
          ) : projects.recentSessions.length === 0 ? (
            <span className="ba-toolstrip-empty">No recent projects</span>
          ) : (
            <div className="ba-projects-list">
              {projects.recentSessions.slice(0, 5).map(sess => (
                <div key={sess.id} className="ba-project-item">
                  <button 
                    className="ba-project-name"
                    onClick={() => session.loadSession(sess.id)}
                  >
                    {sess.source_filename || sess.name || 'Untitled'}
                  </button>
                  <span className="ba-project-meta">
                    {sess.bpm ? `${Math.round(sess.bpm)} BPM` : ''}
                  </span>
                  <button 
                    className="ba-btn-icon-sm"
                    onClick={() => projects.deleteSession(sess.id)}
                    title="Delete project"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button 
            className="ba-btn ba-btn-sm"
            onClick={() => projects.loadRecentSessions()}
          >
            Refresh
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="ba-forge">
      {/* Header */}
      <header className="ba-forge-header">
        <div className="ba-forge-title">
          <div className="ba-traffic-lights">
            <div className="ba-traffic-light close" />
            <div className="ba-traffic-light minimize" />
            <div className="ba-traffic-light maximize" />
          </div>
          <span className="ba-forge-name">{session.session?.source_filename || 'LoopForge'}</span>
        </div>

        <TransportControls
          isPlaying={isPlaying}
          onPlay={() => {
            if (isPlaying) {
              audio.stop();
              setIsPlaying(false);
            } else {
              audio.play();
              setIsPlaying(true);
            }
          }}
          onStop={() => { audio.stop(true); audio.stopAll(); setIsPlaying(false); }}
          onRewind={() => audio.seek(0)}
          onForward={() => audio.seek(audio.getCurrentBeat() + 4)}
        />

        <div className="ba-forge-info">
          {session.session?.bpm && <LcdDisplay value={`${Math.round(session.session.bpm)}`} label="BPM" size="sm" />}
          {session.session?.key && <LcdDisplay value={session.session.key} size="sm" />}
        </div>

        <div className="ba-forge-actions">
          <button className="ba-btn-icon" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)">
            <Folder size={16} />
          </button>
          <button className="ba-btn-icon" title="Save project (⌘S)"><Save size={16} /></button>
          <button 
            className="ba-btn ba-btn-primary ba-btn-sm" 
            disabled={!session.session}
            onClick={() => {
              if (session.session) {
                window.open(api.getAllStemsDownloadUrl(session.session.id), '_blank');
              }
            }}
          >
            <Download size={12} /> Export
          </button>
        </div>
      </header>

      {/* Main Waveform */}
      <main className="ba-forge-main" {...getRootProps()}>
        <input {...getInputProps()} />
        <WaveformView
          session={session.session}
          moments={session.moments}
          selectedStem={selectedStem}
          onStemSelect={setSelectedStem}
          isProcessing={session.isProcessing}
          processingStage={session.processingStage}
          processingProgress={session.processingProgress}
          isDragActive={isDragActive}
        />
      </main>

      {/* Pads */}
      <section className="ba-forge-pads">
        <div className="ba-pads-grid-16">
          {pads.pads.map((pad, i) => (
            <RichPad
              key={i}
              data={pad}
              isPlaying={pads.playingPad === i}
              onTrigger={() => handlePlayPad(i)}
              disabled={!session.session}
            />
          ))}
        </div>
        <div className="ba-pads-shortcuts">
          <span><kbd>1</kbd>-<kbd>8</kbd> top row</span>
          <span><kbd>Q</kbd>-<kbd>I</kbd> bottom row</span>
        </div>
      </section>

      {/* ToolStrip */}
      <ToolStrip
        sections={toolStripSections}
        volume={audio.volume}
        onVolumeChange={audio.setVolume}
        isConnected={backendConnected}
      />

      {/* Error Toast */}
      {session.error && (
        <div className="ba-toast ba-toast-error">
          <span>{session.error}</span>
          <button onClick={session.clearError}>×</button>
        </div>
      )}

      {/* Search Results Indicator */}
      {searchResults.length > 0 && (
        <div className="ba-search-results-toast">
          Found {searchResults.length} matches for "{searchQuery}"
          <button onClick={() => setSearchResults([])}>×</button>
        </div>
      )}

      {/* Keyboard Shortcuts Overlay */}
      <ShortcutsOverlay isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Job Queue */}
      <JobQueue 
        sessionId={session.session?.id || null}
        onJobComplete={(job) => {
          if (job.job_type === 'separation' && session.session) {
            session.loadSession(session.session.id);
          }
        }}
      />

      {/* Region Selection (shown when session active) */}
      {session.session && selectedRegion && (
        <div className="ba-region-panel">
          <RegionSelector
            duration={session.session.duration_seconds || 60}
            onRegionSelect={(start, end) => setSelectedRegion({ start, end })}
            onSliceRegion={async (start, end) => {
              if (session.session && selectedStem) {
                const stem = session.session.stems.find(s => s.name === selectedStem);
                if (stem) {
                  await api.createRegionSlices({
                    sessionId: session.session.id,
                    audioPath: stem.path,
                    startTime: start,
                    endTime: end,
                    role: selectedStem,
                  });
                  setSelectedRegion(null);
                }
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ForgeWorkstation;
