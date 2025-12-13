import React from 'react';
import { KnobHeadless } from 'react-knob-headless';
import { AUDIO_PHYSICS } from '../../constants/audioPhysics';

interface ProFaderProps {
    value: number;
    min?: number;
    max?: number;
    onChange: (value: number) => void;
    height?: number;
    label?: string;
}

export const ProFader: React.FC<ProFaderProps> = ({
    value,
    min = 0,
    max = 1,
    onChange,
    height = 120,
    label
}) => {
    const percentage = (value - min) / (max - min);

    return (
        <div className="flex flex-col items-center gap-1">
            <KnobHeadless
                valueRaw={value}
                valueMin={min}
                valueMax={max}
                dragSensitivity={AUDIO_PHYSICS.FADER_SENSITIVITY}
                onValueRawChange={onChange}
                valueRawRoundFn={(v) => Math.round(v * 100) / 100}
                valueRawDisplayFn={(v) => `${(v * 100).toFixed(0)}%`}
                axis="y"
                className="relative w-8 bg-[#0a0a0a] border border-[#333] rounded-full flex justify-center cursor-ns-resize touch-none outline-none"
                style={{ height }}
                title={`${label}: ${(value * 100).toFixed(0)}%`}
                aria-label={label || 'Fader'}
            >
                {/* Fader Cap */}
                <div
                    className="absolute w-6 h-10 bg-gradient-to-b from-[#444] to-[#222] border border-[#555] rounded shadow-lg flex items-center justify-center pointer-events-none"
                    style={{
                        bottom: `${percentage * 100}%`,
                        transform: 'translateY(50%)',
                        zIndex: 10
                    }}
                >
                    <div className="w-4 h-[1px] bg-[#000] opacity-50" />
                </div>

                {/* Center Line */}
                <div className="w-[1px] h-full bg-[#222] pointer-events-none" />
            </KnobHeadless>
            {label && <span className="text-[9px] font-mono text-slate-500 uppercase">{label}</span>}
        </div>
    );
};
