import React from 'react';

interface ProcessingTask {
    id: string;
    filename: string;
    status: 'uploading' | 'processing' | 'complete' | 'error';
    progress: number;
    message?: string;
    error?: string;
}

interface ProcessingQueueProps {
    tasks: ProcessingTask[];
    onCancel?: (id: string) => void;
}

export const ProcessingQueue: React.FC<ProcessingQueueProps> = ({ tasks, onCancel }) => {
    if (tasks.length === 0) return null;

    const completedCount = tasks.filter(t => t.status === 'complete').length;

    return (
        <div className="vst-panel" style={{ padding: '16px', margin: 0 }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4" style={{ paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <div>
                    <h3 className="vst-panel-title" style={{ fontSize: '11px', margin: 0, padding: 0, color: 'var(--accent-primary)' }}>
                        PROCESSING QUEUE
                    </h3>
                    <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: '4px', letterSpacing: '0.5px' }}>
                        {completedCount} of {tasks.length} complete
                    </div>
                </div>
            </div>

            {/* Task List */}
            <div className="flex flex-col gap-3" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                {tasks.map(task => {
                    const statusColors = {
                        uploading: { bg: '#3b82f6', text: '#60a5fa', label: 'UPLOAD' },
                        processing: { bg: '#06b6d4', text: '#22d3ee', label: 'PROCESS' },
                        complete: { bg: '#10b981', text: '#34d399', label: 'DONE' },
                        error: { bg: '#ef4444', text: '#f87171', label: 'ERROR' }
                    };
                    const status = statusColors[task.status];

                    return (
                        <div 
                            key={task.id} 
                            className="vst-panel" 
                            style={{ 
                                padding: '12px 14px',
                                margin: 0,
                                border: task.status === 'error' ? '1px solid rgba(239, 68, 68, 0.3)' : undefined
                            }}
                        >
                            <div className="flex items-start gap-3">
                                {/* Status Indicator */}
                                <div className="flex-shrink-0" style={{ marginTop: '2px' }}>
                                    <div 
                                        style={{
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            backgroundColor: status.bg,
                                            boxShadow: task.status !== 'complete' && task.status !== 'error' 
                                                ? `0 0 8px ${status.bg}80` 
                                                : undefined,
                                            animation: task.status !== 'complete' && task.status !== 'error' 
                                                ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' 
                                                : undefined
                                        }}
                                    />
                                </div>

                                {/* Task Content */}
                                <div className="flex-1 min-w-0">
                                    {/* Filename */}
                                    <div 
                                        className="font-mono" 
                                        style={{ 
                                            fontSize: '11px',
                                            color: 'var(--text-bright)',
                                            fontWeight: 500,
                                            lineHeight: '1.5',
                                            marginBottom: '6px',
                                            wordBreak: 'break-word'
                                        }}
                                    >
                                        {task.filename}
                                    </div>

                                    {/* Status & Progress Row */}
                                    <div className="flex items-center justify-between mb-3" style={{ gap: '12px' }}>
                                        <div 
                                            style={{ 
                                                fontSize: '9px',
                                                color: status.text,
                                                fontWeight: 600,
                                                letterSpacing: '0.5px',
                                                textTransform: 'uppercase'
                                            }}
                                        >
                                            {status.label}
                                        </div>
                                        {task.status !== 'complete' && task.status !== 'error' && (
                                            <div 
                                                className="font-mono" 
                                                style={{ 
                                                    fontSize: '11px',
                                                    color: 'var(--accent-primary)',
                                                    fontWeight: 600,
                                                    letterSpacing: '0.5px'
                                                }}
                                            >
                                                {task.progress.toFixed(1)}%
                                            </div>
                                        )}
                                    </div>

                                    {/* Progress Bar */}
                                    {task.status !== 'complete' && task.status !== 'error' && (
                                        <div style={{ marginBottom: '4px' }}>
                                            <div 
                                                style={{ 
                                                    height: '4px',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                                    borderRadius: '2px',
                                                    overflow: 'hidden',
                                                    border: '1px solid rgba(255, 255, 255, 0.05)'
                                                }}
                                            >
                                                <div
                                                    style={{ 
                                                        height: '100%',
                                                        background: `linear-gradient(90deg, ${status.bg} 0%, ${status.text} 100%)`,
                                                        width: `${Math.min(task.progress, 100)}%`,
                                                        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                        boxShadow: `0 0 8px ${status.bg}40`
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Status Message */}
                                    {task.message && (
                                        <div 
                                            style={{ 
                                                fontSize: '9px',
                                                color: 'var(--text-dim)',
                                                marginTop: '6px',
                                                lineHeight: '1.4',
                                                fontStyle: 'italic'
                                            }}
                                        >
                                            {task.message}
                                        </div>
                                    )}

                                    {/* Error Message */}
                                    {task.error && (
                                        <div 
                                            style={{ 
                                                fontSize: '9px',
                                                color: '#f87171',
                                                marginTop: '6px',
                                                lineHeight: '1.4',
                                                padding: '4px 6px',
                                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                borderRadius: '2px',
                                                border: '1px solid rgba(239, 68, 68, 0.2)'
                                            }}
                                        >
                                            {task.error}
                                        </div>
                                    )}
                                </div>

                                {/* Cancel Button */}
                                {onCancel && task.status !== 'complete' && task.status !== 'error' && (
                                    <button
                                        onClick={() => onCancel(task.id)}
                                        style={{
                                            flexShrink: 0,
                                            padding: '4px',
                                            color: 'var(--text-dim)',
                                            cursor: 'pointer',
                                            transition: 'color 0.2s',
                                            background: 'transparent',
                                            border: 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.color = '#f87171'}
                                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                                        title="Cancel"
                                    >
                                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
