import React, { useEffect, useRef } from 'react';

interface CanvasMeterProps {
    analyser?: AnalyserNode;
    width?: number;
    height?: number;
    isActive?: boolean;
}

export const CanvasMeter: React.FC<CanvasMeterProps> = ({
    analyser,
    width = 12,
    height = 100,
    isActive
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const peakRef = useRef<number>(0);
    const lastPeakTimeRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx) return;

        if (!analyser || !isActive) {
            // Clear canvas if inactive
            ctx.clearRect(0, 0, width, height);
            return;
        }

        let animationId: number;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const render = () => {
            analyser.getByteTimeDomainData(dataArray);

            // Calculate RMS
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const amplitude = (dataArray[i] - 128) / 128;
                sum += amplitude * amplitude;
            }
            const rms = Math.sqrt(sum / dataArray.length);

            // Boost for visibility (RMS is usually low)
            const level = Math.min(1, rms * 4);

            // Peak Hold Logic
            const now = Date.now();
            if (level > peakRef.current) {
                peakRef.current = level;
                lastPeakTimeRef.current = now;
            } else if (now - lastPeakTimeRef.current > 1000) { // Hold for 1s
                peakRef.current = Math.max(level, peakRef.current - 0.02); // Decay
            }

            // Draw
            ctx.clearRect(0, 0, width, height);

            // LED Segments
            const segHeight = 2;
            const gap = 1;
            const totalSegs = Math.floor(height / (segHeight + gap));
            const activeSegs = Math.floor(level * totalSegs);
            const peakSeg = Math.floor(peakRef.current * totalSegs);

            for (let i = 0; i < totalSegs; i++) {
                const y = height - (i * (segHeight + gap)) - segHeight;

                let color = '#333';

                // Active Signal
                if (i < activeSegs) {
                    const ratio = i / totalSegs;
                    if (ratio > 0.9) color = '#ef4444'; // Red
                    else if (ratio > 0.7) color = '#eab308'; // Yellow
                    else color = '#22c55e'; // Green
                }

                // Peak Hold Segment
                if (i === peakSeg && peakSeg > 0) {
                    color = '#ffffff'; // White peak indicator
                }

                ctx.fillStyle = color;
                ctx.fillRect(0, y, width, segHeight);
            }

            animationId = requestAnimationFrame(render);
        };

        render();
        return () => cancelAnimationFrame(animationId);
    }, [analyser, isActive, width, height]);

    return <canvas ref={canvasRef} width={width} height={height} className="bg-[#0a0a0a] border border-[#333] rounded-sm" />;
};
