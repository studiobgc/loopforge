import React from 'react';
import { KnobHeadless } from 'react-knob-headless';
import { AUDIO_PHYSICS } from '../../constants/audioPhysics';

interface ProKnobProps {
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    size?: number;
    label?: string;
    bipolar?: boolean;
}

export const ProKnob: React.FC<ProKnobProps> = ({
    value,
    min,
    max,
    onChange,
    size = 40,
    label,
    bipolar
}) => {
    // Calculate rotation (-135 to 135 degrees)
    const percentage = (value - min) / (max - min);
    const rotation = AUDIO_PHYSICS.KNOB_START_ANGLE + (percentage * AUDIO_PHYSICS.KNOB_ROTATION_RANGE);

    // Arc Calculation
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const arcLength = circumference * 0.75; // 270 degrees

    let dashArray = `${arcLength} ${circumference}`;



    // Recalculate standard fill for now to be safe
    const fillLength = arcLength * percentage;
    dashArray = `${fillLength} ${circumference}`;

    return (
        <div className="flex flex-col items-center gap-1" onDoubleClick={() => onChange(bipolar ? (max + min) / 2 : min)}>
            <KnobHeadless
                valueRaw={value}
                valueMin={min}
                valueMax={max}
                dragSensitivity={AUDIO_PHYSICS.KNOB_SENSITIVITY}
                onValueRawChange={onChange}
                valueRawRoundFn={(v) => Math.round(v)}
                valueRawDisplayFn={(v) => v.toString()}
                className="relative cursor-ns-resize touch-none select-none outline-none"
                style={{ width: size, height: size }}
                title={`${label}: ${value}`}
                aria-label={label || 'Knob'}
            >
                <svg width={size} height={size} viewBox="0 0 100 100" style={{ pointerEvents: 'none' }}>
                    {/* Background Track */}
                    <circle
                        cx="50" cy="50" r="40"
                        fill="none"
                        stroke="#334155"
                        strokeWidth="8"
                        strokeDasharray={arcLength + " " + circumference}
                        transform="rotate(135 50 50)"
                        strokeLinecap="round"
                    />

                    {/* Value Arc */}
                    <circle
                        cx="50" cy="50" r="40"
                        fill="none"
                        stroke={bipolar ? "#a855f7" : "#06b6d4"} // Purple for bipolar
                        strokeWidth="8"
                        strokeDasharray={dashArray}
                        transform="rotate(135 50 50)"
                        strokeLinecap="round"
                    />

                    {/* Tick Marks */}
                    {[0, 0.5, 1].map(p => {
                        const deg = -135 + (p * 270);
                        return (
                            <line
                                key={p}
                                x1="50" y1="10"
                                x2="50" y2="4"
                                stroke="#475569"
                                strokeWidth="2"
                                transform={`rotate(${deg} 50 50)`}
                            />
                        )
                    })}

                    {/* Indicator Line */}
                    <line
                        x1="50" y1="50"
                        x2="50" y2="10"
                        stroke="#f8fafc"
                        strokeWidth="4"
                        transform={`rotate(${rotation} 50 50)`}
                    />
                </svg>

                {/* Center Label (Optional) */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-mono text-slate-400">{value}</span>
                </div>
            </KnobHeadless>
            {label && <span className="text-[10px] font-mono text-slate-500 uppercase">{label}</span>}
        </div>
    );
};
