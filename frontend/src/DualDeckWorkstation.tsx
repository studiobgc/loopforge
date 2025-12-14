import { useCallback, useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { forgeApi } from './api/forgeApi'
import { ProcessingConfig, VocalSettings, LoopViewModel } from './types/forge'
import { RetroButton, RetroSelect } from './components/ui/RetroControls'
import { SessionPlayer } from './components/SessionPlayer'
import { ProcessingQueue } from './components/ProcessingQueue'
import { FileBrowser } from './components/FileBrowser'

const ROLE_OPTIONS = [
    { id: 'drums', label: 'DRUMS' },
    { id: 'vocals', label: 'VOCALS' },
    { id: 'bass', label: 'BASS' },
    { id: 'melody', label: 'MELODY' }
] as const

type Role = typeof ROLE_OPTIONS[number]['id']

type ProcessingTask = {
    id: string
    filename: string
    status: 'uploading' | 'processing' | 'complete' | 'error'
    progress: number
    message?: string
    error?: string
}

type SourceTrack = {
    id: string
    file: File
    filename: string
    role: Role | null
}

export default function DualDeckWorkstation() {
    // Processing Queue (replaces phase system)
    const [processingTasks, setProcessingTasks] = useState<ProcessingTask[]>([])
    const [showFileBrowser, setShowFileBrowser] = useState(true)

    // Session State
    const [sources, setSources] = useState<SourceTrack[]>([])
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [loops, setLoops] = useState<LoopViewModel[]>([])
    const [logs, setLogs] = useState<string[]>([])

    const [quality] = useState<'standard' | 'high'>('standard')
    const [masterKey] = useState<string>('C')
    const [masterMode] = useState<string>('minor')
    const [masterBpm] = useState<number | null>(null)

    // DUAL-ANCHOR SYSTEM (Chimera Protocol)
    const [rhythmAnchor] = useState<string | null>(null)
    const [harmonicAnchor] = useState<string | null>(null)

    // Vocal FX State
    const [vocalSettings] = useState<VocalSettings>({
        correction_strength: 0.8,
        formant_shift: 0,
        pitch_wobble: 0,
        stutter_intensity: 0,
        bitcrush_depth: 24,
        phase_smear: 0
    })

    const addLog = (msg: string) => setLogs(prev => [`> ${msg}`, ...prev].slice(0, 50))

    // Persistence Logic
    useEffect(() => {
        const saved = localStorage.getItem('forge_session')
        if (saved) {
            try {
                const data = JSON.parse(saved)
                if (data.sessionId) setSessionId(data.sessionId)
                if (data.loops) setLoops(data.loops)
                if (data.logs) setLogs(data.logs)
            } catch (e) {
                console.error('Failed to restore session', e)
            }
        }
    }, [])

    useEffect(() => {
        if (sessionId) {
            localStorage.setItem('forge_session', JSON.stringify({
                sessionId,
                loops,
                logs
            }))
        }
    }, [sessionId, loops, logs])

    const resumePolling = (sid: string, taskId: string) => {
        let lastMsg = ''
        let lastProgress = 0
        let stuckCounter = 0
        let lastProgressTime = Date.now()
        
        const poll = setInterval(async () => {
            try {
                // Use Promise.race to timeout status requests
                const statusPromise = forgeApi.getStatus(sid)
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Status request timeout')), 3000)
                )
                
                const data = await Promise.race([statusPromise, timeoutPromise]).catch(() => null) as any
                if (!data) {
                    stuckCounter++
                    if (stuckCounter > 3) { // Reduced from 5 to 3 for faster detection
                        // No response for 3 polls, show warning
                        setProcessingTasks(prev => prev.map(task => {
                            if (task.id === taskId) {
                                return {
                                    ...task,
                                    message: 'Backend may be stuck - check server logs',
                                    status: 'processing' as const,
                                    error: stuckCounter > 5 ? 'Backend not responding. Try restarting the backend server.' : undefined
                                }
                            }
                            return task
                        }))
                    }
                    return
                }
                
                stuckCounter = 0  // Reset counter on successful response

                // Update processing task progress - use overall progress if available, otherwise calculate from track_progress
                let overallProgress = data.progress || 0
                
                if (!overallProgress && data.track_progress) {
                    const trackProgresses = Object.values(data.track_progress as Record<string, any>)
                        .map((t: any) => t.progress || 0)
                    if (trackProgresses.length > 0) {
                        overallProgress = trackProgresses.reduce((sum: number, p: number) => sum + p, 0) / trackProgresses.length
                    }
                }
                
                // Check if progress is stuck (same for 30+ seconds)
                const now = Date.now()
                if (overallProgress === lastProgress && overallProgress > 0 && overallProgress < 100) {
                    const timeSinceLastProgress = now - lastProgressTime
                    if (timeSinceLastProgress > 30000) {  // 30 seconds
                        // Progress stuck - show detailed status
                        const trackStatuses = data.track_progress ? 
                            Object.entries(data.track_progress as Record<string, any>)
                                .map(([name, status]: [string, any]) => `${name}: ${status.status || 'processing'}`)
                                .join(', ') : 'processing'
                        setProcessingTasks(prev => prev.map(task => {
                            if (task.id === taskId) {
                                return {
                                    ...task,
                                    message: `Processing... (${trackStatuses})`,
                                    status: 'processing' as const
                                }
                            }
                            return task
                        }))
                    }
                } else {
                    lastProgressTime = now
                }
                
                // Smooth progress animation - allow small updates even if same to show activity
                if (overallProgress >= lastProgress || (overallProgress === lastProgress && overallProgress > 0)) {
                    lastProgress = overallProgress
                    setProcessingTasks(prev => prev.map(task => {
                        if (task.id === taskId) {
                            return {
                                ...task,
                                progress: Math.min(overallProgress, 100),
                                status: 'processing' as const,
                                message: data.message || task.message || 'Processing...'
                            }
                        }
                        return task
                    }))
                }

                if (data.message && data.message !== lastMsg) {
                    lastMsg = data.message
                    addLog(data.message)
                }

                if (data.status === 'complete') {
                    clearInterval(poll)
                    if (data.results) {
                        const newLoops: LoopViewModel[] = data.results.map((r: any) => ({
                            id: r.filename,
                            filename: r.filename,
                            role: r.role,
                            bpm: r.bpm || 120,
                            key: r.key || 'C min',
                            path: r.path,
                            bars: r.bars || 4,
                            selected: true,
                            duration: r.duration || null,
                            cropStart: 0,
                            cropEnd: r.duration || 0,
                            gain: 0,
                            loopPlayback: true,
                            transients: r.transients || [],
                            tags: r.tags || [],
                            texture: r.texture,
                            dna: r.dna,
                            shift_amount: r.shift_amount,
                            effect_chain: r.effect_chain,
                            peaks_filename: r.peaks_filename,
                            peaks_path: r.peaks_path
                        }))
                        setLoops(prev => [...prev, ...newLoops])
                    }
                    setProcessingTasks(prev => prev.map(task =>
                        task.id === taskId ? { ...task, status: 'complete' as const, progress: 100 } : task
                    ))
                    addLog('✅ Processing complete!')
                } else if (data.status === 'error') {
                    clearInterval(poll)
                    setProcessingTasks(prev => prev.map(task =>
                        task.id === taskId ? { ...task, status: 'error' as const, error: data.message } : task
                    ))
                    addLog(`Error: ${data.message || 'Unknown error'}`)
                }
            } catch (e: any) {
                console.error('Poll error', e)
                if (e.response && e.response.status === 404) {
                    clearInterval(poll)
                    setProcessingTasks(prev => prev.map(task =>
                        task.id === taskId ? { ...task, status: 'error' as const, error: 'Session lost' } : task
                    ))
                    addLog('error: session lost (server restarted?)')
                }
            }
        }, 2000)  // Poll every 2 seconds (optimized: matches backend heartbeat, reduces load)
    }

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setSources(prev => {
            const newSources: SourceTrack[] = []
            const existingNames = new Set(prev.map(s => s.filename))

            acceptedFiles.forEach(file => {
                let name = file.name
                let counter = 1
                while (existingNames.has(name)) {
                    const parts = file.name.split('.')
                    const ext = parts.pop()
                    const base = parts.join('.')
                    name = `${base} (${counter}).${ext}`
                    counter++
                }
                existingNames.add(name)

                const uniqueFile = name !== file.name
                    ? new File([file], name, { type: file.type })
                    : file

                newSources.push({
                    id: crypto.randomUUID(),
                    file: uniqueFile,
                    filename: name,
                    role: null
                })
            })
            return [...prev, ...newSources]
        })
        addLog(`queued ${acceptedFiles.length} files`)
    }, [])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'audio/*': ['.wav', '.mp3', '.aiff', '.flac', '.m4a'] }
    })

    const setRole = (id: string, role: Role | null) => {
        setSources(prev => prev.map(track => (track.id === id ? { ...track, role } : track)))
    }

    const removeTrack = (id: string) => {
        setSources(prev => prev.filter(track => track.id !== id))
    }

    const startProcessing = async () => {
        if (!sources.length) return
        const hasRoles = sources.some(s => s.role)
        if (!hasRoles) return

        // Pre-flight backend health check
        try {
            const isHealthy = await forgeApi.checkHealth()
            if (!isHealthy) {
                addLog('❌ Backend server is not responding')
                setProcessingTasks(prev => prev.map(task => ({
                    ...task,
                    status: 'error' as const,
                    error: 'Backend server is not responding. Please restart the backend server.',
                    progress: 0
                })))
                return
            }
        } catch (err) {
            addLog('❌ Cannot connect to backend server')
            setProcessingTasks(prev => prev.map(task => ({
                ...task,
                status: 'error' as const,
                error: 'Cannot connect to backend server. Make sure it is running on port 8000.',
                progress: 0
            })))
            return
        }

        const taskId = crypto.randomUUID()
        const taskFilenames = sources.map(s => s.filename).join(', ')

        // Create processing task
        setProcessingTasks(prev => [...prev, {
            id: taskId,
            filename: taskFilenames,
            status: 'uploading',
            progress: 0,
            message: 'Uploading files...'
        }])

        addLog('🚀 Starting forge session...')

        try {
            // Update progress callback
            const updateUploadProgress = (progress: number) => {
                setProcessingTasks(prev => prev.map(task => {
                    if (task.id === taskId) {
                        let message = 'Uploading files...'
                        if (progress < 80) {
                            message = `Uploading files... ${Math.round(progress)}%`
                        } else if (progress < 95) {
                            message = 'Analyzing audio...'
                        } else {
                            message = 'Finalizing...'
                        }
                        return { ...task, message, progress }
                    }
                    return task
                }))
            }

            setProcessingTasks(prev => prev.map(task =>
                task.id === taskId ? { ...task, message: 'Preparing upload...', progress: 2 } : task
            ))
            
            // Upload with progress tracking
            const uploadData = await forgeApi.uploadFiles(
                sources.map(s => s.file),
                updateUploadProgress
            ).catch(err => {
                // Enhanced error handling
                let errorMsg = 'Upload failed'
                if (err.message) {
                    errorMsg = err.message
                } else if (err.response?.data?.detail) {
                    errorMsg = err.response.data.detail
                } else if (err.code === 'ECONNABORTED') {
                    errorMsg = 'Upload timeout - files may be too large or connection is slow'
                } else if (err.code === 'ERR_NETWORK' || err.code === 'ECONNREFUSED') {
                    errorMsg = 'Cannot connect to server - make sure the backend is running on port 8000'
                }
                throw new Error(errorMsg)
            })
            
            const newSessionId = uploadData.session_id
            if (!newSessionId) {
                throw new Error('No session ID returned from server')
            }
            
            setSessionId(newSessionId)
            addLog(`✅ Session created: ${newSessionId.slice(0, 8)}`)
            
            setProcessingTasks(prev => prev.map(task =>
                task.id === taskId ? { ...task, message: 'Upload complete', progress: 95 } : task
            ))

            const roleMap: Record<string, string> = {}
            sources.forEach(track => {
                if (track.role) roleMap[track.file.name] = track.role
            })

            setProcessingTasks(prev => prev.map(task =>
                task.id === taskId ? { ...task, status: 'processing', message: 'Processing stems...' } : task
            ))
            addLog('🎛️ Demucs v4 model loaded')

            const config: ProcessingConfig = {
                rhythm_anchor_filename: rhythmAnchor || undefined,
                harmonic_anchor_filename: harmonicAnchor || undefined,
                target_bpm: masterBpm || undefined,
                target_key: masterKey,
                target_mode: masterMode,
                roles: roleMap,
                enabled_presets: [],
                crops: {},
                quality: quality,
                vocal_settings: vocalSettings
            }

            await forgeApi.startProcessing(newSessionId, config).catch(err => {
                throw new Error(`Failed to start processing: ${err.response?.data?.detail || err.message || 'Unknown error'}`)
            })

            resumePolling(newSessionId, taskId)

            // Clear sources after starting processing (non-blocking)
            setSources([])
        } catch (e: any) {
            console.error(e)
            setProcessingTasks(prev => prev.map(task =>
                task.id === taskId ? { ...task, status: 'error', error: e.message } : task
            ))
            addLog(`❌ Error: ${e.message}`)
        }
    }

    return (
        <div className="app-shell">
            {/* HEADER */}
            <header className="rack-header">
                <div className="flex-col">
                    <div className="brand-logo">LOOP FORGE <span style={{ color: 'var(--accent-primary)' }}>2.0</span></div>
                    <div style={{ fontSize: 9, color: '#666' }}>UNIFIED WORKSTATION</div>
                </div>
            </header>

            {/* WORKSPACE - UNIFIED LAYOUT */}
            <div className="rack-workspace">
                {/* FILE BROWSER PANEL */}
                {showFileBrowser && (
                    <aside 
                        className="glass-strong" 
                        style={{ 
                            width: 260, 
                            minWidth: 260,
                            display: 'flex', 
                            flexDirection: 'column',
                            borderRight: '1px solid rgba(255,255,255,0.05)',
                            position: 'relative',
                        }}
                    >
                        <button
                            onClick={() => setShowFileBrowser(false)}
                            style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                borderRadius: '3px',
                                padding: '2px 6px',
                                fontSize: '9px',
                                color: 'var(--text-dim)',
                                cursor: 'pointer',
                                zIndex: 10,
                            }}
                            title="Hide file browser"
                        >
                            ✕
                        </button>
                        <FileBrowser onFileSelect={onDrop} />
                    </aside>
                )}

                {/* LEFT PANEL - Upload + Processing Queue */}
                <aside className="rack-sidebar glass-strong" style={{ position: 'relative' }}>
                    <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Source Deck</span>
                        {!showFileBrowser && (
                            <button
                                onClick={() => setShowFileBrowser(true)}
                                style={{
                                    background: 'rgba(6, 182, 212, 0.2)',
                                    border: '1px solid rgba(6, 182, 212, 0.3)',
                                    borderRadius: '3px',
                                    padding: '2px 8px',
                                    fontSize: '8px',
                                    color: 'var(--accent-primary)',
                                    cursor: 'pointer',
                                    letterSpacing: '0.5px',
                                }}
                                title="Show file browser"
                            >
                                📁 BROWSER
                            </button>
                        )}
                    </div>

                    {/* Drop Zone - Enhanced UX */}
                    <div
                        {...getRootProps()}
                        className="flex-center flex-col"
                        style={{
                            padding: isDragActive ? 24 : 16,
                            background: isDragActive 
                                ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.1))' 
                                : 'rgba(255,255,255,0.02)',
                            cursor: 'pointer',
                            border: isDragActive 
                                ? '2px dashed rgba(6, 182, 212, 0.6)' 
                                : '2px dashed rgba(255,255,255,0.1)',
                            margin: 8,
                            borderRadius: 8,
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            transform: isDragActive ? 'scale(1.02)' : 'scale(1)',
                        }}
                    >
                        <input {...getInputProps()} />
                        <div style={{ 
                            fontSize: isDragActive ? '28px' : '20px', 
                            marginBottom: 8,
                            opacity: isDragActive ? 1 : 0.5,
                            transition: 'all 0.2s ease',
                            filter: isDragActive ? 'drop-shadow(0 0 8px rgba(6, 182, 212, 0.5))' : 'none',
                        }}>
                            {isDragActive ? '📥' : '🎵'}
                        </div>
                        <div style={{ 
                            textAlign: 'center',
                            fontSize: isDragActive ? '11px' : '10px',
                            color: isDragActive ? 'var(--accent-primary)' : 'var(--text-dim)',
                            fontWeight: isDragActive ? 600 : 400,
                            letterSpacing: '0.5px',
                            transition: 'all 0.2s ease',
                        }}>
                            {isDragActive ? 'DROP TO ADD FILES' : 'DROP FILES HERE'}
                        </div>
                        <div style={{
                            fontSize: '8px',
                            color: 'var(--text-dim)',
                            marginTop: 4,
                            opacity: isDragActive ? 0 : 0.6,
                        }}>
                            WAV • MP3 • AIFF • FLAC • M4A
                        </div>
                    </div>

                    {/* Source Tracks */}
                    <div className="flex-col gap-3 p-4 overflow-y-auto flex-1 custom-scrollbar">
                        {sources.length === 0 ? (
                            <div style={{ 
                                textAlign: 'center', 
                                padding: '20px 10px',
                                color: 'var(--text-dim)',
                                fontSize: '9px',
                            }}>
                                No files added yet.<br/>
                                Use the file browser or drop files here.
                            </div>
                        ) : (
                            sources.map((track) => (
                                <div
                                    key={track.id}
                                    className="vst-panel smooth-transition hover:border-cyan-500/30"
                                >
                                    <div className="text-[10px] font-mono text-slate-300 truncate mb-2.5" style={{ lineHeight: '1.4' }}>{track.filename}</div>
                                    <div className="flex gap-2">
                                        <RetroSelect
                                            value={track.role || ''}
                                            onChange={(value: string) => setRole(track.id, (value as Role) || null)}
                                            options={[{ value: '', label: 'ROLE' }, ...ROLE_OPTIONS.map(r => ({ value: r.id, label: r.label }))]}
                                            style={{ flex: 1, fontSize: 9 }}
                                        />
                                        <RetroButton onClick={() => removeTrack(track.id)} style={{ fontSize: 9, padding: '2px 6px' }}>×</RetroButton>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Processing Queue */}
                    {processingTasks.length > 0 && (
                        <div className="p-4 border-t border-slate-800">
                            <ProcessingQueue tasks={processingTasks} />
                        </div>
                    )}

                    {/* Process Button */}
                    <div className="p-4">
                        <RetroButton
                            variant="primary"
                            style={{ width: '100%', height: 40, fontSize: 12 }}
                            onClick={startProcessing}
                            disabled={!sources.length || !sources.some(s => s.role)}
                        >
                            PROCESS SESSION
                        </RetroButton>
                    </div>
                </aside>

                {/* RIGHT PANEL - Session Player (Always Visible) */}
                <main className="rack-main glass">
                    {loops.length === 0 ? (
                        <div className="flex-center h-full flex-col gap-4 opacity-50">
                            <div style={{
                                width: 80, height: 80,
                                border: '2px dashed #444',
                                borderRadius: 8,
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <span style={{ fontSize: 32, color: '#444' }}>♪</span>
                            </div>
                            <div className="text-center">
                                <div style={{ fontSize: 14, fontWeight: 700, color: '#666' }}>AWAITING LOOPS</div>
                                <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>PROCESS STEMS TO BEGIN</div>
                            </div>
                        </div>
                    ) : (
                        sessionId && (
                            <SessionPlayer
                                sessionId={sessionId}
                                loops={loops}
                                rhythmAnchor={rhythmAnchor}
                                harmonicAnchor={harmonicAnchor}
                            />
                        )
                    )}
                </main>
            </div>

            {/* FOOTER - Logs */}
            <footer className="rack-footer">
                <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                    {logs.slice(0, 5).map((log, i) => (
                        <span key={i} className="text-[9px] text-slate-600 font-mono whitespace-nowrap">{log}</span>
                    ))}
                </div>
            </footer>
        </div>
    )
}