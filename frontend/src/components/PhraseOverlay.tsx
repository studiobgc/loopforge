import React, { useState, useEffect, useRef } from 'react';
import { RetroButton, LCDDisplay } from './ui/RetroControls';
import { forgeApi } from '../api/forgeApi';

interface Phrase {
    start_time: number;
    end_time: number;
    duration: number;
    phrase_type: string;
    confidence: number;
    pitch_range: [number, number];
    energy: number;
}

interface PhraseOverlayProps {
    sessionId: string;
    filename: string;
    role: string;
    bpm: number;
    duration: number;
    onPhraseSelect?: (start: number, end: number) => void;
}

export const PhraseOverlay: React.FC<PhraseOverlayProps> = ({
    sessionId,
    filename,
    role,
    bpm,
    duration,
    onPhraseSelect
}) => {
    const [phrases, setPhrases] = useState<Phrase[]>([]);
    const [isDetecting, setIsDetecting] = useState(false);
    const [selectedPhrase, setSelectedPhrase] = useState<number | null>(null);
    const [status, setStatus] = useState('');
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const detectPhrases = async () => {
        setIsDetecting(true);
        setStatus('Analyzing musical phrases...');

        try {
            const result = await forgeApi.detectPhrases(sessionId, filename, bpm);
            setPhrases(result.phrases);
            setStatus(`Detected ${result.phrases.length} phrases`);
        } catch (e: any) {
            setStatus(`Error: ${e.message}`);
        } finally {
            setIsDetecting(false);
        }
    };

    // Auto-detect on mount if vocals or melody
    useEffect(() => {
        if (role === 'vocals' || role === 'melody') {
            detectPhrases();
        }
    }, []);

    // Draw phrase visualization
    useEffect(() => {
        if (!canvasRef.current || phrases.length === 0) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Draw each phrase
        phrases.forEach((phrase, idx) => {
            const x = (phrase.start_time / duration) * width;
            const phraseWidth = ((phrase.end_time - phrase.start_time) / duration) * width;
            const isSelected = idx === selectedPhrase;

            // Color by type
            let color = '#666';
            switch (phrase.phrase_type) {
                case 'chorus':
                    color = '#bff46a';
                    break;
                case 'hook':
                    color = '#ff9900';
                    break;
                case 'verse':
                    color = '#4a9eff';
                    break;
                case 'bridge':
                    color = '#ff3399';
                    break;
            }

            // Draw phrase block
            ctx.fillStyle = isSelected ? `${color}44` : `${color}22`;
            ctx.fillRect(x, 0, phraseWidth, height);

            // Draw border
            ctx.strokeStyle = isSelected ? color : `${color}88`;
            ctx.lineWidth = isSelected ? 3 : 1;
            ctx.strokeRect(x, 0, phraseWidth, height);

            // Draw confidence indicator (height bar at left)
            const confidenceHeight = phrase.confidence * height;
            ctx.fillStyle = color;
            ctx.fillRect(x, height - confidenceHeight, 3, confidenceHeight);

            // Draw label if selected or first phrase
            if (isSelected || idx === 0) {
                ctx.fillStyle = '#000';
                ctx.fillRect(x + 4, 4, 80, 20);
                ctx.fillStyle = color;
                ctx.font = '9px var(--font-mono)';
                ctx.fillText(phrase.phrase_type.toUpperCase(), x + 6, 16);
            }
        });

    }, [phrases, selectedPhrase, duration]);

    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current || phrases.length === 0) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickTime = (clickX / rect.width) * duration;

        // Find clicked phrase
        const clickedIdx = phrases.findIndex(
            p => clickTime >= p.start_time && clickTime <= p.end_time
        );

        if (clickedIdx !== -1) {
            setSelectedPhrase(clickedIdx);
            if (onPhraseSelect) {
                onPhraseSelect(phrases[clickedIdx].start_time, phrases[clickedIdx].end_time);
            }
        }
    };

    if (role !== 'vocals' && role !== 'melody') {
        return null; // Only show for vocals/melody
    }

    return (
        <div style={{
            padding: 8,
            background: '#1a1a1a',
            borderTop: '1px solid #333',
            borderRadius: '0 0 2px 2px'
        }}>
            {/* Header */}
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    <div style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: '#bff46a',
                        boxShadow: '0 0 6px #bff46a'
                    }} />
                    <span style={{ fontSize: 9, color: '#bff46a', fontWeight: 700 }}>PHRASE DETECTION</span>
                </div>
                {!isDetecting && phrases.length === 0 && (
                    <RetroButton
                        onClick={detectPhrases}
                        style={{ fontSize: 9, padding: '2px 8px' }}
                    >
                        ANALYZE
                    </RetroButton>
                )}
            </div>

            {/* Status */}
            {status && (
                <div style={{ marginBottom: 6 }}>
                    <LCDDisplay text={status} />
                </div>
            )}

            {/* Phrase Canvas */}
            {phrases.length > 0 && (
                <>
                    <canvas
                        ref={canvasRef}
                        width={600}
                        height={40}
                        onClick={handleCanvasClick}
                        style={{
                            width: '100%',
                            height: 40,
                            background: '#0a0a0a',
                            border: '1px solid #333',
                            borderRadius: 2,
                            cursor: 'pointer',
                            marginBottom: 6
                        }}
                    />

                    {/* Legend */}
                    <div className="flex gap-3" style={{ fontSize: 8, color: '#666' }}>
                        <div className="flex items-center gap-1">
                            <div style={{ width: 8, height: 8, background: '#bff46a' }} />
                            <span>CHORUS</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div style={{ width: 8, height: 8, background: '#ff9900' }} />
                            <span>HOOK</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div style={{ width: 8, height: 8, background: '#4a9eff' }} />
                            <span>VERSE</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div style={{ width: 8, height: 8, background: '#ff3399' }} />
                            <span>BRIDGE</span>
                        </div>
                    </div>

                    {/* Selected Phrase Info */}
                    {selectedPhrase !== null && (
                        <div style={{
                            marginTop: 8,
                            padding: 6,
                            background: '#222',
                            border: '1px solid #333',
                            borderRadius: 2
                        }}>
                            <div className="flex gap-4">
                                <div className="flex-col flex-1">
                                    <div style={{ fontSize: 8, color: '#666', marginBottom: 2 }}>TYPE</div>
                                    <div style={{ fontSize: 10, color: '#bff46a', fontWeight: 700 }}>
                                        {phrases[selectedPhrase].phrase_type.toUpperCase()}
                                    </div>
                                </div>
                                <div className="flex-col flex-1">
                                    <div style={{ fontSize: 8, color: '#666', marginBottom: 2 }}>DURATION</div>
                                    <div style={{ fontSize: 10, color: '#fff' }}>
                                        {phrases[selectedPhrase].duration.toFixed(2)}s
                                    </div>
                                </div>
                                <div className="flex-col flex-1">
                                    <div style={{ fontSize: 8, color: '#666', marginBottom: 2 }}>CONFIDENCE</div>
                                    <div style={{ fontSize: 10, color: '#fff' }}>
                                        {(phrases[selectedPhrase].confidence * 100).toFixed(0)}%
                                    </div>
                                </div>
                                <div className="flex-col flex-1">
                                    <div style={{ fontSize: 8, color: '#666', marginBottom: 2 }}>PITCH RANGE</div>
                                    <div style={{ fontSize: 10, color: '#fff' }}>
                                        {phrases[selectedPhrase].pitch_range[0].toFixed(0)}-{phrases[selectedPhrase].pitch_range[1].toFixed(0)} Hz
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
