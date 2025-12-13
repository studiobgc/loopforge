import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RetroButton } from './ui/RetroControls';
import { LoopViewModel } from '../types/forge';
import { ProFader } from './audio/ProFader';
import { CanvasMeter } from './audio/CanvasMeter';

interface ChannelState {
    volume: number;      // 0.0 to 1.0
    muted: boolean;
    soloed: boolean;
    peak: number;        // Current peak meter value
    buffer: AudioBuffer | null;
    sourceNode: AudioBufferSourceNode | null;
    gainNode: GainNode | null;
    analyser: AnalyserNode | null;
}

interface SessionPlayerProps {
    sessionId: string;
    loops: LoopViewModel[];
    rhythmAnchor: string | null;
    harmonicAnchor: string | null;
}

export const SessionPlayer: React.FC<SessionPlayerProps> = ({
    sessionId,
    loops,
    rhythmAnchor,
    harmonicAnchor
}) => {
    const audioCtxRef = useRef<AudioContext | null>(null);
    const [channels, setChannels] = useState<Record<string, ChannelState>>({});
    const [isPlaying, setIsPlaying] = useState(false);
    const [masterVolume, setMasterVolume] = useState(0.8);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const startTimeRef = useRef<number>(0);
    const animationFrameRef = useRef<number>();
    const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

    // Initialize Audio Context
    useEffect(() => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        return () => {
            stopAll();
            audioCtxRef.current?.close();
        };
    }, []);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Prevent shortcuts if user is typing in an input (though we don't have many inputs here)
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.code === 'Space') {
                e.preventDefault(); // Prevent scrolling
                togglePlayback();
            }

            if (selectedChannel) {
                if (e.code === 'KeyM') {
                    toggleMute(selectedChannel);
                }
                if (e.code === 'KeyS') {
                    toggleSolo(selectedChannel);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isPlaying, channels, selectedChannel]); // Re-bind when state changes

    // Initialize channels when loops change
    useEffect(() => {
        const newChannels: Record<string, ChannelState> = {};
        loops.forEach(loop => {
            if (!channels[loop.filename]) {
                newChannels[loop.filename] = {
                    volume: 0.8,
                    muted: false,
                    soloed: false,
                    peak: 0,
                    buffer: null,
                    sourceNode: null,
                    gainNode: null,
                    analyser: null
                };
            } else {
                newChannels[loop.filename] = channels[loop.filename];
            }
        });
        setChannels(newChannels);
        // Select first channel by default if none selected
        if (!selectedChannel && loops.length > 0) {
            setSelectedChannel(loops[0].filename);
        }
    }, [loops]);

    // ... (rest of loadBuffers and updateMeters)

    // Load audio buffers
    const loadBuffers = useCallback(async () => {
        if (!audioCtxRef.current) return;

        const loadPromises = loops.map(async loop => {
            try {
                const response = await fetch(`/api/forge/stream/${sessionId}/${loop.filename}`);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await audioCtxRef.current!.decodeAudioData(arrayBuffer);

                setChannels(prev => ({
                    ...prev,
                    [loop.filename]: {
                        ...prev[loop.filename],
                        buffer: audioBuffer
                    }
                }));

                return audioBuffer.duration;
            } catch (e) {
                console.error(`Failed to load ${loop.filename}:`, e);
                return 0;
            }
        });

        const durations = await Promise.all(loadPromises);
        const maxDuration = Math.max(...durations);
        setDuration(maxDuration);
    }, [loops, sessionId]);

    useEffect(() => {
        loadBuffers();
    }, [loadBuffers]);

    // Update peak meters
    const updateMeters = useCallback(() => {
        if (!isPlaying) return;

        setChannels(prev => {
            const updated = { ...prev };
            Object.keys(updated).forEach(filename => {
                const ch = updated[filename];
                if (ch.analyser) {
                    const dataArray = new Uint8Array(ch.analyser.frequencyBinCount);
                    ch.analyser.getByteTimeDomainData(dataArray);

                    let max = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        const normalized = Math.abs((dataArray[i] / 128.0) - 1.0);
                        if (normalized > max) max = normalized;
                    }

                    updated[filename] = {
                        ...ch,
                        peak: max * 1.2 // Slight boost for visibility
                    };
                }
            });
            return updated;
        });

        animationFrameRef.current = requestAnimationFrame(updateMeters);
    }, [isPlaying]);

    useEffect(() => {
        if (isPlaying) {
            updateMeters();
        } else if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isPlaying, updateMeters]);

    // Play all loops in perfect sync
    const playAll = useCallback(() => {
        if (!audioCtxRef.current) return;

        const ctx = audioCtxRef.current;
        const startTime = ctx.currentTime + 0.1; // 100ms lookahead for precision
        startTimeRef.current = startTime;

        // Check if any channel is soloed
        const hasSolo = Object.values(channels).some(ch => ch.soloed);

        const newChannels = { ...channels };

        loops.forEach(loop => {
            const ch = newChannels[loop.filename];
            if (!ch?.buffer) return;

            // Determine if this channel should play
            const shouldPlay = hasSolo ? ch.soloed : !ch.muted;
            if (!shouldPlay) return;

            // Create source node
            const source = ctx.createBufferSource();
            source.buffer = ch.buffer;
            source.loop = true;

            // Create gain node
            const gain = ctx.createGain();
            gain.gain.value = ch.volume * masterVolume;

            // Create analyser for meters
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;

            // Connect: source -> gain -> analyser -> destination
            source.connect(gain);
            gain.connect(analyser);
            analyser.connect(ctx.destination);

            // Start at exact same time
            source.start(startTime);

            newChannels[loop.filename] = {
                ...ch,
                sourceNode: source,
                gainNode: gain,
                analyser
            };
        });

        setChannels(newChannels);
        setIsPlaying(true);

        // Update current time
        const updateTime = () => {
            if (!audioCtxRef.current) return;
            const elapsed = audioCtxRef.current.currentTime - startTimeRef.current;
            setCurrentTime(elapsed % duration);
            if (isPlaying) {
                requestAnimationFrame(updateTime);
            }
        };
        updateTime();
    }, [channels, loops, masterVolume, duration, isPlaying]);

    const stopAll = useCallback(() => {
        const newChannels = { ...channels };

        Object.keys(newChannels).forEach(filename => {
            const ch = newChannels[filename];
            if (ch.sourceNode) {
                try {
                    ch.sourceNode.stop();
                } catch (e) {
                    // Already stopped
                }
                ch.sourceNode.disconnect();
            }
            if (ch.gainNode) {
                ch.gainNode.disconnect();
            }
            if (ch.analyser) {
                ch.analyser.disconnect();
            }

            newChannels[filename] = {
                ...ch,
                sourceNode: null,
                gainNode: null,
                analyser: null,
                peak: 0
            };
        });

        setChannels(newChannels);
        setIsPlaying(false);
        setCurrentTime(0);
    }, [channels]);

    const togglePlayback = () => {
        if (isPlaying) {
            stopAll();
        } else {
            playAll();
        }
    };

    const setChannelVolume = (filename: string, volume: number) => {
        setChannels(prev => ({
            ...prev,
            [filename]: { ...prev[filename], volume }
        }));

        // Update gain in real-time if playing
        const ch = channels[filename];
        if (ch?.gainNode) {
            ch.gainNode.gain.value = volume * masterVolume;
        }
    };

    const toggleMute = (filename: string) => {
        setChannels(prev => ({
            ...prev,
            [filename]: { ...prev[filename], muted: !prev[filename].muted }
        }));
    };

    const toggleSolo = (filename: string) => {
        setChannels(prev => ({
            ...prev,
            [filename]: { ...prev[filename], soloed: !prev[filename].soloed }
        }));
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(1);
        return `${mins}:${secs.padStart(4, '0')}`;
    };

    return (
        <div className="vst-panel p-2 flex flex-col gap-2 h-[240px] w-full">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[#222] pb-1 mb-1">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-[var(--accent-primary)] animate-pulse' : 'bg-[#333]'}`} />
                    <div className="text-[10px] font-bold text-[#888]">SESSION PLAYER</div>
                </div>
                <div className="lcd-screen text-[10px] px-2 py-0.5">
                    {formatTime(currentTime)} / {formatTime(duration)}
                </div>
                <div className="flex gap-2">
                    <RetroButton onClick={stopAll} style={{ width: 60, height: 20, fontSize: 10 }}>■ STOP</RetroButton>
                    <RetroButton active={isPlaying} onClick={playAll} style={{ width: 60, height: 20, fontSize: 10 }}>▶ PLAY</RetroButton>
                </div>
            </div>

            {/* Mixer Rack */}
            <div className="flex-1 flex gap-1 overflow-x-auto bg-[#050505] p-1 rounded border border-[#111] shadow-inner">
                {/* Master Strip */}
                <div className="flex-col gap-2 p-2 bg-[#111] border-r border-[#222] h-full w-[80px] flex-shrink-0">
                    <div className="text-[9px] font-bold text-[#666] text-center mb-2">MASTER</div>
                    <div className="flex flex-1 justify-center">
                        <ProFader
                            value={masterVolume}
                            onChange={setMasterVolume}
                            height={100}
                        />
                    </div>
                    <div className="lcd-screen text-[8px] text-center mt-2">{(masterVolume * 100).toFixed(0)}%</div>
                </div>

                {/* Channels */}
                {loops.map(loop => {
                    const ch = channels[loop.filename];
                    if (!ch) return null;
                    return (
                        <ChannelStrip
                            key={loop.filename}
                            loop={loop}
                            mix={{ mute: ch.muted, solo: ch.soloed, vol: ch.volume, peak: ch.peak }}
                            analyser={ch.analyser || undefined}
                            onMute={() => toggleMute(loop.filename)}
                            onSolo={() => toggleSolo(loop.filename)}
                            onVolume={(v) => setChannelVolume(loop.filename, v)}
                            isActive={isPlaying}
                            isSelected={selectedChannel === loop.filename}
                            isRhythmAnchor={loop.filename === rhythmAnchor}
                            isHarmonicAnchor={loop.filename === harmonicAnchor}
                            onClick={() => setSelectedChannel(loop.filename)}
                        />
                    );
                })}
            </div>
        </div>
    );
};

const ChannelStrip = ({
    loop,
    mix,
    analyser,
    onMute,
    onSolo,
    onVolume,
    isActive,
    isSelected,
    isRhythmAnchor,
    isHarmonicAnchor,
    onClick
}: {
    loop: LoopViewModel,
    mix: { mute: boolean, solo: boolean, vol: number, peak: number },
    analyser?: AnalyserNode,
    onMute: () => void,
    onSolo: () => void,
    onVolume: (v: number) => void,
    isActive: boolean,
    isSelected: boolean,
    isRhythmAnchor: boolean,
    isHarmonicAnchor: boolean,
    onClick: () => void
}) => {
    return (
        <div
            className="flex-col"
            onClick={onClick}
            style={{
                minWidth: 80,
                padding: 8,
                background: isSelected ? '#222' : '#1a1a1a',
                border: isSelected ? '1px solid var(--accent-primary)' : `1px solid ${isActive ? '#333' : '#222'}`,
                borderRadius: 2,
                opacity: isActive ? 1 : 0.5,
                cursor: 'pointer',
                transition: 'background 0.1s, border-color 0.1s'
            }}
        >
            {/* Channel Label */}
            <div style={{
                fontSize: 9,
                fontWeight: 700,
                color: isSelected ? 'var(--accent-primary)' : '#bff46a',
                marginBottom: 4,
                textAlign: 'center',
                textTransform: 'uppercase'
            }}>
                {loop.role}
            </div>

            {/* Anchor Badges */}
            {(isRhythmAnchor || isHarmonicAnchor) && (
                <div className="flex-col gap-1 mb-2">
                    {isRhythmAnchor && (
                        <div style={{
                            fontSize: 7,
                            padding: '1px 3px',
                            background: 'rgba(191, 244, 106, 0.1)',
                            border: '1px solid var(--accent-primary)',
                            color: 'var(--accent-primary)',
                            borderRadius: 1,
                            textAlign: 'center'
                        }}>
                            {isRhythmAnchor ? '🥁 BPM' : '🎹 KEY'}
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-1 gap-2 justify-center items-center">
                <CanvasMeter analyser={analyser} isActive={isActive} width={12} height={100} />
                <ProFader value={mix.vol} onChange={onVolume} height={100} />
            </div>

            {/* Volume Label */}
            <div className="lcd-screen" style={{
                fontSize: 8,
                textAlign: 'center',
                marginTop: 6,
                marginBottom: 6,
                padding: '2px 4px'
            }}>
                {(mix.vol * 100).toFixed(0)}%
            </div>

            {/* M/S Buttons */}
            <div className="flex gap-1">
                <RetroButton
                    active={mix.mute}
                    variant="danger"
                    onClick={(e) => { e.stopPropagation(); onMute(); }}
                    style={{ height: 20, fontSize: 9, flex: 1, minWidth: 0, padding: '3px 0' }}
                >
                    M
                </RetroButton>
                <RetroButton
                    active={mix.solo}
                    onClick={(e) => { e.stopPropagation(); onSolo(); }}
                    style={{ height: 20, fontSize: 9, flex: 1, minWidth: 0, padding: '3px 0' }}
                >
                    S
                </RetroButton>
            </div>

            {/* Info */}
            <div style={{
                marginTop: 6,
                fontSize: 7,
                color: '#666',
                textAlign: 'center',
                fontFamily: 'var(--font-mono)'
            }}>
                {loop.bpm} BPM<br />
                {loop.key}
            </div>
        </div>
    );
};

