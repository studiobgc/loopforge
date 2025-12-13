import React, { useState, useRef, useEffect } from 'react';
import { RetroButton, LCDDisplay } from './ui/RetroControls';
import { forgeApi } from '../api/forgeApi';

interface GrooveVisualizerProps {
    histogram?: {
        bins: number[];
        counts: number[];
    };
    swing_ms?: number;
    groove_type?: string;
    tightness?: number;
}

const GrooveVisualizer: React.FC<GrooveVisualizerProps> = ({
    histogram,
    swing_ms = 0,
    groove_type = 'straight',
    tightness = 1.0
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current || !histogram) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 20; i++) {
            const x = (i / 20) * width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Draw center line (perfect grid)
        ctx.strokeStyle = 'rgba(191, 244, 106, 0.2)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw histogram
        if (histogram.counts.length > 0) {
            const maxCount = Math.max(...histogram.counts);
            const barWidth = width / histogram.bins.length;

            histogram.counts.forEach((count, i) => {
                const barHeight = (count / maxCount) * height * 0.9;
                const x = i * barWidth;
                const y = height - barHeight;

                // Gradient fill based on distance from center
                const binCenter = (histogram.bins[i] + histogram.bins[i + 1]) / 2;
                const distFromCenter = Math.abs(binCenter);

                const gradient = ctx.createLinearGradient(x, y, x, height);
                if (distFromCenter < 10) {
                    // Near center = green (tight)
                    gradient.addColorStop(0, 'rgba(191, 244, 106, 0.8)');
                    gradient.addColorStop(1, 'rgba(191, 244, 106, 0.2)');
                } else if (distFromCenter < 30) {
                    // Mid range = amber
                    gradient.addColorStop(0, 'rgba(255, 153, 0, 0.7)');
                    gradient.addColorStop(1, 'rgba(255, 153, 0, 0.2)');
                } else {
                    // Far range = red (loose)
                    gradient.addColorStop(0, 'rgba(255, 51, 51, 0.6)');
                    gradient.addColorStop(1, 'rgba(255, 51, 51, 0.2)');
                }

                ctx.fillStyle = gradient;
                ctx.fillRect(x, y, barWidth - 1, barHeight);

                // Glow effect on bars
                ctx.shadowBlur = 4;
                ctx.shadowColor = 'rgba(191, 244, 106, 0.3)';
                ctx.fillRect(x, y, barWidth - 1, barHeight);
                ctx.shadowBlur = 0;
            });
        }

        // Draw labels
        ctx.fillStyle = '#666';
        ctx.font = '9px var(--font-mono)';
        ctx.textAlign = 'center';
        ctx.fillText('-50ms', 10, height - 4);
        ctx.fillText('ON GRID', width / 2, height - 4);
        ctx.fillText('+50ms', width - 10, height - 4);

    }, [histogram]);

    const getGrooveColor = () => {
        switch (groove_type) {
            case 'laid_back': return '#ff9900';
            case 'rushed': return '#ff3333';
            default: return '#bff46a';
        }
    };

    return (
        <div className="flex-col gap-2">
            {/* Canvas Histogram */}
            <div className="waveform-vst" style={{ height: 100, position: 'relative' }}>
                <canvas
                    ref={canvasRef}
                    width={400}
                    height={100}
                    style={{ width: '100%', height: '100%' }}
                />
            </div>

            {/* Stats Row */}
            <div className="flex gap-2">
                <div className="flex-col flex-1">
                    <div style={{ fontSize: 9, color: '#666', fontWeight: 700, marginBottom: 2 }}>SWING</div>
                    <div className="lcd-screen" style={{ color: getGrooveColor(), textAlign: 'center' }}>
                        {swing_ms?.toFixed(1)}ms
                    </div>
                </div>
                <div className="flex-col flex-1">
                    <div style={{ fontSize: 9, color: '#666', fontWeight: 700, marginBottom: 2 }}>TYPE</div>
                    <div className="lcd-screen" style={{ color: getGrooveColor(), textAlign: 'center', textTransform: 'uppercase' }}>
                        {groove_type}
                    </div>
                </div>
                <div className="flex-col flex-1">
                    <div style={{ fontSize: 9, color: '#666', fontWeight: 700, marginBottom: 2 }}>TIGHTNESS</div>
                    <div className="lcd-screen" style={{ textAlign: 'center' }}>
                        {(tightness * 100).toFixed(0)}%
                    </div>
                </div>
            </div>
        </div>
    );
};

interface GrooveTransferPanelProps {
    sessionId: string;
    loops: Array<{
        filename: string;
        role: string;
        bpm: number;
    }>;
    onGrooveApplied: () => void;
}

export const GrooveTransferPanel: React.FC<GrooveTransferPanelProps> = ({
    sessionId,
    loops,
    onGrooveApplied
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [sourceFile, setSourceFile] = useState<string>('');
    const [targetFile, setTargetFile] = useState<string>('');
    const [strength, setStrength] = useState(1.0);
    const [subdivision, setSubdivision] = useState<'8th' | '16th' | '32nd'>('16th');

    const [sourceGroove, setSourceGroove] = useState<any>(null);
    const [targetGroove, setTargetGroove] = useState<any>(null);
    const [compatibility, setCompatibility] = useState<any>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [status, setStatus] = useState('');

    const extractGroove = async (filename: string, isSource: boolean) => {
        const loop = loops.find(l => l.filename === filename);
        if (!loop) return;

        setIsExtracting(true);
        setStatus(isSource ? 'Extracting source groove...' : 'Extracting target groove...');

        try {
            const result = await forgeApi.extractGroove(sessionId, filename, loop.bpm, subdivision);

            if (isSource) {
                setSourceGroove(result);
                setStatus(`Source: ${result.type} (${result.swing_ms.toFixed(1)}ms swing)`);
            } else {
                setTargetGroove(result);

                // If we have both, calculate compatibility
                if (sourceGroove) {
                    const compat = await forgeApi.analyzeGrooveCompatibility(
                        sessionId,
                        sourceFile,
                        filename,
                        loops.find(l => l.filename === sourceFile)?.bpm || 120,
                        loop.bpm
                    );
                    setCompatibility(compat);
                    setStatus(`Compatibility: ${(compat.compatibility.compatibility * 100).toFixed(0)}%`);
                }
            }
        } catch (e: any) {
            setStatus(`Error: ${e.message}`);
        } finally {
            setIsExtracting(false);
        }
    };

    const applyGroove = async () => {
        if (!sourceFile || !targetFile) return;

        const sourceLoop = loops.find(l => l.filename === sourceFile);
        const targetLoop = loops.find(l => l.filename === targetFile);
        if (!sourceLoop || !targetLoop) return;

        setIsApplying(true);
        setStatus('Applying groove...');

        try {
            await forgeApi.applyGroove(
                sessionId,
                sourceFile,
                targetFile,
                sourceLoop.bpm,
                targetLoop.bpm,
                strength,
                subdivision
            );

            setStatus('Groove transferred successfully!');
            onGrooveApplied();

            // Reset after success
            setTimeout(() => {
                setStatus('');
                setSourceGroove(null);
                setTargetGroove(null);
                setCompatibility(null);
            }, 2000);
        } catch (e: any) {
            setStatus(`Error: ${e.message}`);
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div className="vst-panel" style={{ marginBottom: 16 }}>
            <div
                className="vst-panel-header"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2">
                    <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--accent-primary)',
                        boxShadow: '0 0 8px var(--accent-primary)',
                        animation: 'pulse 2s infinite'
                    }} />
                    <span className="vst-panel-title">GROOVE TRANSFER ENGINE</span>
                </div>
                <span style={{ color: '#666', fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
            </div>

            {isOpen && (
                <div style={{ padding: 12 }}>
                    {/* Status LCD */}
                    {status && (
                        <div style={{ marginBottom: 12 }}>
                            <LCDDisplay text={status} />
                        </div>
                    )}

                    {/* Source/Target Selection */}
                    <div className="flex gap-3 mb-4">
                        {/* Source Column */}
                        <div className="flex-col flex-1 gap-2">
                            <div style={{ fontSize: 9, color: '#bff46a', fontWeight: 700, marginBottom: 4 }}>
                                SOURCE (GROOVE DONOR)
                            </div>

                            <select
                                value={sourceFile}
                                onChange={(e) => {
                                    setSourceFile(e.target.value);
                                    setSourceGroove(null);
                                    setCompatibility(null);
                                }}
                                className="input-vst"
                                style={{ height: 28, fontSize: 10 }}
                            >
                                <option value="">SELECT LOOP</option>
                                {loops.map(loop => (
                                    <option key={loop.filename} value={loop.filename}>
                                        {loop.role.toUpperCase()} - {loop.filename.slice(0, 20)}
                                    </option>
                                ))}
                            </select>

                            {sourceFile && !sourceGroove && (
                                <RetroButton
                                    onClick={() => extractGroove(sourceFile, true)}
                                    disabled={isExtracting}
                                    style={{ width: '100%' }}
                                >
                                    {isExtracting ? 'ANALYZING...' : 'EXTRACT GROOVE'}
                                </RetroButton>
                            )}

                            {sourceGroove && (
                                <GrooveVisualizer
                                    histogram={sourceGroove.visualization.histogram}
                                    swing_ms={sourceGroove.swing_ms}
                                    groove_type={sourceGroove.type}
                                    tightness={sourceGroove.tightness}
                                />
                            )}
                        </div>

                        {/* Arrow */}
                        <div className="flex-center" style={{ width: 40, opacity: sourceGroove && targetGroove ? 1 : 0.3 }}>
                            <div style={{ fontSize: 24, color: 'var(--accent-primary)' }}>→</div>
                        </div>

                        {/* Target Column */}
                        <div className="flex-col flex-1 gap-2">
                            <div style={{ fontSize: 9, color: '#ff9900', fontWeight: 700, marginBottom: 4 }}>
                                TARGET (RECEIVES GROOVE)
                            </div>

                            <select
                                value={targetFile}
                                onChange={(e) => {
                                    setTargetFile(e.target.value);
                                    setTargetGroove(null);
                                    setCompatibility(null);
                                }}
                                className="input-vst"
                                style={{ height: 28, fontSize: 10 }}
                            >
                                <option value="">SELECT LOOP</option>
                                {loops.filter(l => l.filename !== sourceFile).map(loop => (
                                    <option key={loop.filename} value={loop.filename}>
                                        {loop.role.toUpperCase()} - {loop.filename.slice(0, 20)}
                                    </option>
                                ))}
                            </select>

                            {targetFile && sourceGroove && !targetGroove && (
                                <RetroButton
                                    onClick={() => extractGroove(targetFile, false)}
                                    disabled={isExtracting}
                                    style={{ width: '100%' }}
                                >
                                    {isExtracting ? 'ANALYZING...' : 'ANALYZE TARGET'}
                                </RetroButton>
                            )}

                            {targetGroove && (
                                <GrooveVisualizer
                                    histogram={targetGroove.visualization.histogram}
                                    swing_ms={targetGroove.swing_ms}
                                    groove_type={targetGroove.type}
                                    tightness={targetGroove.tightness}
                                />
                            )}
                        </div>
                    </div>

                    {/* Compatibility Score */}
                    {compatibility && (
                        <div className="vst-panel" style={{
                            padding: 8,
                            marginBottom: 12,
                            background: compatibility.compatibility.compatibility > 0.7 ? 'rgba(191, 244, 106, 0.05)' : 'rgba(255, 153, 0, 0.05)'
                        }}>
                            <div className="flex justify-between items-center mb-2">
                                <span style={{ fontSize: 10, color: '#666', fontWeight: 700 }}>COMPATIBILITY ANALYSIS</span>
                                <span style={{
                                    fontSize: 14,
                                    color: compatibility.compatibility.compatibility > 0.7 ? '#bff46a' : '#ff9900',
                                    fontWeight: 700
                                }}>
                                    {(compatibility.compatibility.compatibility * 100).toFixed(0)}%
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <div style={{ fontSize: 8, color: '#666', marginBottom: 2 }}>Swing Similarity</div>
                                    <div style={{
                                        height: 4,
                                        background: '#111',
                                        borderRadius: 2,
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{
                                            width: `${compatibility.compatibility.swing_similarity * 100}%`,
                                            height: '100%',
                                            background: 'var(--accent-primary)'
                                        }} />
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div style={{ fontSize: 8, color: '#666', marginBottom: 2 }}>Tightness Match</div>
                                    <div style={{
                                        height: 4,
                                        background: '#111',
                                        borderRadius: 2,
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{
                                            width: `${compatibility.compatibility.tightness_similarity * 100}%`,
                                            height: '100%',
                                            background: 'var(--accent-primary)'
                                        }} />
                                    </div>
                                </div>
                            </div>
                            <div style={{ fontSize: 9, color: '#888', marginTop: 4, textAlign: 'center' }}>
                                {compatibility.compatibility.recommendation === 'compatible'
                                    ? '✓ These grooves work well together'
                                    : '⚠ Different feel - use lower strength'}
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    {sourceGroove && targetGroove && (
                        <div className="flex-col gap-3">
                            {/* Strength Slider */}
                            <div className="flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-[#666] font-bold tracking-wider">
                                    <span>TRANSFER STRENGTH</span>
                                    <span className="text-[var(--accent-primary)]">{(strength * 100).toFixed(0)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={strength}
                                    onChange={(e) => setStrength(parseFloat(e.target.value))}
                                    className="retro-slider w-full h-1.5 bg-[#222] rounded-none appearance-none cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[var(--accent-primary)] [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:hover:scale-110 transition-all"
                                />
                                <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>
                                    {strength < 0.3 && 'Subtle groove hint'}
                                    {strength >= 0.3 && strength < 0.7 && 'Balanced feel'}
                                    {strength >= 0.7 && 'Full groove transfer'}
                                </div>
                            </div>

                            {/* Subdivision */}
                            <div className="flex gap-2">
                                {(['8th', '16th', '32nd'] as const).map(sub => (
                                    <RetroButton
                                        key={sub}
                                        active={subdivision === sub}
                                        onClick={() => setSubdivision(sub)}
                                        style={{ flex: 1, fontSize: 9 }}
                                    >
                                        {sub === '8th' ? '1/8' : sub === '16th' ? '1/16' : '1/32'}
                                    </RetroButton>
                                ))}
                            </div>

                            {/* Apply Button */}
                            <RetroButton
                                variant="primary"
                                onClick={applyGroove}
                                disabled={isApplying}
                                style={{
                                    width: '100%',
                                    height: 40,
                                    fontSize: 12,
                                    background: isApplying ? '#333' : 'linear-gradient(to bottom, #4a4a4a, #3a3a3a)'
                                }}
                            >
                                {isApplying ? '⟳ TRANSFERRING...' : '✓ APPLY GROOVE'}
                            </RetroButton>
                        </div>
                    )}

                    {!sourceGroove && !targetGroove && (
                        <div style={{
                            textAlign: 'center',
                            color: '#555',
                            fontSize: 10,
                            padding: 20,
                            border: '1px dashed #333',
                            borderRadius: 2
                        }}>
                            Select a source loop to extract its groove DNA, then choose a target to receive the transfer.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
