import React, { useRef, useState, useEffect } from 'react';

// --- RETRO CHECKBOX ---
interface RetroCheckboxProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
}

export const RetroCheckbox: React.FC<RetroCheckboxProps> = ({ label, checked, onChange, className }) => {
    return (
        <div
            className={`flex-row flex-center gap-2 cursor-pointer ${className}`}
            onClick={() => onChange(!checked)}
        >
            <div
                style={{
                    width: '14px',
                    height: '14px',
                    background: '#0a0a0a',
                    border: '1px solid #333',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '2px'
                }}
            >
                {checked && (
                    <div style={{
                        width: '8px',
                        height: '8px',
                        background: 'var(--accent-primary)',
                        boxShadow: '0 0 4px var(--accent-primary)'
                    }} />
                )}
            </div>
            <span style={{ fontSize: '10px', color: checked ? '#fff' : '#888', textTransform: 'uppercase' }}>
                {label}
            </span>
        </div>
    );
};

// --- RETRO BUTTON ---
interface RetroButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    variant?: 'default' | 'primary' | 'danger';
}

export const RetroButton: React.FC<RetroButtonProps> = ({ children, active, variant = 'default', style, ...props }) => {
    const [pressed, setPressed] = useState(false);

    let bg = 'linear-gradient(to bottom, #3a3a3a, #2a2a2a)';
    let color = '#ccc';
    let borderColor = '#000';

    if (active) {
        bg = 'var(--accent-primary)';
        color = '#000';
        borderColor = 'var(--accent-primary)';
    } else if (variant === 'primary') {
        bg = 'linear-gradient(to bottom, #4a4a4a, #3a3a3a)';
        color = '#fff';
    } else if (variant === 'danger') {
        bg = '#331111';
        color = '#ff5555';
    }

    return (
        <button
            className="btn-vst"
            onMouseDown={() => setPressed(true)}
            onMouseUp={() => setPressed(false)}
            onMouseLeave={() => setPressed(false)}
            style={{
                background: bg,
                color: color,
                borderColor: borderColor,
                transform: pressed ? 'scale(0.96) translateY(1px)' : 'scale(1) translateY(0)',
                transition: 'transform 0.05s ease-out',
                ...style
            }}
            {...props}
        >
            {children}
        </button>
    );
};

// --- RETRO KNOB ---
interface RetroKnobProps {
    value: number;
    min?: number;
    max?: number;
    label: string;
    onChange: (val: number) => void;
    size?: number;
}

export const RetroKnob: React.FC<RetroKnobProps> = ({ value, min = 0, max = 100, label, onChange, size = 40 }) => {
    const startY = useRef<number>(0);
    const startVal = useRef<number>(0);

    const handleMouseDown = (e: React.MouseEvent) => {
        startY.current = e.clientY;
        startVal.current = value;
        document.body.style.cursor = 'ns-resize';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
        const deltaY = startY.current - e.clientY;
        const range = max - min;
        const deltaVal = (deltaY / 150) * range; // Sensitivity
        let newVal = startVal.current + deltaVal;
        newVal = Math.max(min, Math.min(max, newVal));
        onChange(Math.round(newVal));
    };

    const handleMouseUp = () => {
        document.body.style.cursor = 'default';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };

    const percent = (value - min) / (max - min);
    const rotation = -135 + (percent * 270);

    return (
        <div className="flex-col flex-center gap-1" style={{ width: size }}>
            <div
                onMouseDown={handleMouseDown}
                style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    background: 'conic-gradient(#222 0deg, #111 360deg)',
                    border: '1px solid #333',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.1)',
                    position: 'relative',
                    cursor: 'ns-resize'
                }}
            >
                {/* Indicator Line */}
                <div style={{
                    position: 'absolute',
                    top: '50%', left: '50%',
                    width: '2px', height: '50%',
                    background: 'transparent',
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    pointerEvents: 'none'
                }}>
                    <div style={{
                        width: '2px', height: '8px',
                        background: 'var(--accent-primary)',
                        position: 'absolute',
                        top: '2px', left: '0',
                        boxShadow: '0 0 2px var(--accent-primary)'
                    }} />
                </div>
            </div>
            <div style={{ fontSize: '9px', color: '#666', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                {label}
            </div>
        </div>
    );
};

// --- LCD DISPLAY ---
interface LCDDisplayProps {
    text: string;
    label?: string;
    color?: string;
}

export const LCDDisplay: React.FC<LCDDisplayProps> = ({ text, label, color }) => {
    return (
        <div className="flex-col gap-1">
            {label && <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>}
            <div className="lcd-screen" style={{ color: color || 'var(--text-lcd)' }}>
                {text}
            </div>
        </div>
    );
};
// --- RETRO SELECT ---
interface RetroSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    label?: string;
    placeholder?: string;
    style?: React.CSSProperties;
}

export const RetroSelect: React.FC<RetroSelectProps> = ({ value, onChange, options, label, placeholder = 'SELECT', style }) => {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedLabel = options.find(o => o.value === value)?.label || placeholder;

    return (
        <div className="flex-col gap-1" style={{ position: 'relative', ...style }} ref={ref}>
            {label && <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>}
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    height: '24px',
                    background: '#1a1a1a',
                    border: isOpen ? '1px solid var(--accent-primary)' : '1px solid #333',
                    borderRadius: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 8px',
                    fontSize: '10px',
                    color: value ? '#fff' : '#666',
                    cursor: 'pointer',
                    userSelect: 'none',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)'
                }}
            >
                <span>{selectedLabel}</span>
                <span style={{ fontSize: '8px', color: isOpen ? 'var(--accent-primary)' : '#444' }}>▼</span>
            </div>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: '#222',
                    border: '1px solid var(--accent-primary)',
                    zIndex: 100,
                    maxHeight: '150px',
                    overflowY: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.8)'
                }}>
                    {options.map(opt => (
                        <div
                            key={opt.value}
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                            className="retro-select-option"
                            style={{
                                padding: '6px 8px',
                                fontSize: '10px',
                                color: opt.value === value ? 'var(--accent-primary)' : '#ccc',
                                cursor: 'pointer',
                                borderBottom: '1px solid #333'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            {opt.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
