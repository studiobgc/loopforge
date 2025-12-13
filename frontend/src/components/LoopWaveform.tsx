import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LoopViewModel, VocalSettings } from '../types/forge'
import { RetroButton, RetroCheckbox } from './ui/RetroControls'
import { WaveformAnalyzer, WaveformMips } from '../utils/WaveformAnalyzer'
import { PhraseOverlay } from './PhraseOverlay'

// Pro-level constants
const SCRUB_DURATION = 0.08 // 80ms grains
const ZOOM_SENSITIVITY = 0.001
const MIN_ZOOM = 1
const MAX_ZOOM = 200 // Increased max zoom for precision

const formatTime = (time: number, bpm: number) => {
    const mins = Math.floor(time / 60)
    const secs = (time % 60).toFixed(2).padStart(5, '0')
    const bars = bpm ? ((time / 60) * bpm) / 4 : 0
    return `${mins}:${secs} · ${bars.toFixed(2)} bars`
}

// Custom Retro Slider Component
const RetroSlider = ({ label, value, min, max, step, onChange, formatValue, direction = 'ltr' }: {
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
    formatValue?: (v: number) => string,
    direction?: 'ltr' | 'rtl'
}) => (
    <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[10px] text-[#666] font-bold tracking-wider">
            <span>{label}</span>
            <span className="text-[var(--accent-primary)]">{formatValue ? formatValue(value) : value}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            className="retro-slider w-full h-1.5 bg-[#222] rounded-none appearance-none cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[var(--accent-primary)] [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:hover:scale-110 transition-all"
            style={{ direction }}
            value={value}
            onChange={onChange}
        />
    </div>
)

export function LoopWaveform({
    loop,
    sessionId,
    onMeta,
    onCropChange,
    isActive,
    requestPlay,
    vocalSettings,
    onVocalSettingsChange
}: {
    loop: LoopViewModel
    sessionId: string
    onMeta: (filename: string, meta: Partial<LoopViewModel>) => void
    onCropChange: (filename: string, start: number, end: number) => void
    isActive: boolean
    requestPlay: () => void
    vocalSettings?: VocalSettings
    onVocalSettingsChange?: (settings: VocalSettings) => void
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // Audio State
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
    const [waveformMips, setWaveformMips] = useState<WaveformMips | null>(null)
    const [loading, setLoading] = useState(false)
    const audioCtxRef = useRef<AudioContext | null>(null)
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)

    // Viewport State
    const [zoom, setZoom] = useState(1)
    const [scroll, setScroll] = useState(0) // 0 to 1 (normalized)
    const [hoverTime, setHoverTime] = useState<number | null>(null)
    const [isDragging, setIsDragging] = useState<'start' | 'end' | 'scrub' | null>(null)
    const [snappedTime, setSnappedTime] = useState<number | null>(null)

    // Initialize Audio Context
    useEffect(() => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        }
        return () => {
            audioCtxRef.current?.close()
            audioCtxRef.current = null
        }
    }, [])

    // Load Audio & Generate MIPs
    useEffect(() => {
        const loadAudio = async () => {
            if (!audioCtxRef.current) return
            setLoading(true)
            try {
                const res = await fetch(`/api/forge/stream/${sessionId}/${loop.filename}`)
                const arrayBuffer = await res.arrayBuffer()
                const decoded = await audioCtxRef.current.decodeAudioData(arrayBuffer)
                setAudioBuffer(decoded)

                // Generate MIP maps for O(1) rendering
                const mips = WaveformAnalyzer.generateMips(decoded)
                setWaveformMips(mips)

                // Smart Zoom: Auto-fit crop region if defined
                if (loop.cropEnd && loop.cropEnd < decoded.duration) {
                    const cropDuration = loop.cropEnd - (loop.cropStart || 0)
                    // Fit with 10% padding
                    const fitZoom = decoded.duration / (cropDuration * 1.2)
                    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom)))

                    // Center the crop
                    const centerTime = (loop.cropStart || 0) + cropDuration / 2
                    const visibleDuration = decoded.duration / fitZoom
                    const newScroll = (centerTime - visibleDuration / 2) / (decoded.duration - visibleDuration)
                    setScroll(Math.max(0, Math.min(1, newScroll)))
                }

                // Auto-detect transients if missing
                if (!loop.transients || loop.transients.length === 0) {
                    onMeta(loop.filename, {
                        duration: decoded.duration,
                        cropEnd: decoded.duration
                    })
                }
            } catch (e) {
                console.error(`[WAVEFORM] Error loading ${loop.filename}:`, e)
            } finally {
                setLoading(false)
            }
        }
        loadAudio()
    }, [loop.filename, sessionId])

    // Scrub Engine
    const scrub = useCallback((time: number) => {
        if (!audioCtxRef.current || !audioBuffer) return

        // Stop previous scrub
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.stop() } catch { }
        }

        const source = audioCtxRef.current.createBufferSource()
        source.buffer = audioBuffer

        // Create envelope to avoid clicks
        const gain = audioCtxRef.current.createGain()
        gain.gain.setValueAtTime(0, audioCtxRef.current.currentTime)
        gain.gain.linearRampToValueAtTime(0.8, audioCtxRef.current.currentTime + 0.01)
        gain.gain.linearRampToValueAtTime(0, audioCtxRef.current.currentTime + SCRUB_DURATION)

        source.connect(gain)
        gain.connect(audioCtxRef.current.destination)

        source.start(0, time, SCRUB_DURATION)
        sourceNodeRef.current = source
    }, [audioBuffer])

    // Render Loop
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !audioBuffer || !waveformMips) return

        // Handle DPI Scaling
        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()

        // Only resize if dimensions changed
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr
            canvas.height = rect.height * dpr
        }

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Reset transform to identity then scale
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)

        let animationFrameId: number

        const render = () => {
            const width = rect.width
            const height = rect.height
            const duration = audioBuffer.duration

            // Clear
            ctx.fillStyle = '#121212'
            ctx.fillRect(0, 0, width, height)

            // Calculate Viewport
            const visibleDuration = duration / zoom
            const startTime = scroll * (duration - visibleDuration)
            const endTime = startTime + visibleDuration

            const timeToX = (t: number) => ((t - startTime) / visibleDuration) * width

            // Draw Grid (Beats)
            if (loop.bpm) {
                const beatDur = 60 / loop.bpm
                const startBeat = Math.floor(startTime / beatDur)
                const endBeat = Math.ceil(endTime / beatDur)

                ctx.lineWidth = 1

                for (let i = startBeat; i <= endBeat; i++) {
                    const t = i * beatDur
                    const x = timeToX(t)

                    // Bar lines (assuming 4/4)
                    const isBar = i % 4 === 0

                    ctx.strokeStyle = isBar ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)'
                    ctx.beginPath()
                    ctx.moveTo(x, 0)
                    ctx.lineTo(x, height)
                    ctx.stroke()

                    // Bar Numbers
                    if (isBar) {
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
                        ctx.font = '10px monospace'
                        ctx.fillText(`${(i / 4) + 1}`, x + 4, height - 4)
                    }
                }
            }

            // Draw Waveform using MIPs
            const mip = WaveformAnalyzer.getBestLevel(zoom, audioBuffer.sampleRate, waveformMips)

            // Fallback to raw data if zoomed in extremely close
            const data = mip ? mip.level : audioBuffer.getChannelData(0)
            const samplesPerPixel = mip ? mip.samplesPerPixel : 1
            const sampleRate = audioBuffer.sampleRate / samplesPerPixel

            const startSample = Math.floor(startTime * sampleRate)
            // Ensure we don't go out of bounds
            const endSample = Math.min(data.length, Math.floor(endTime * sampleRate))

            // Calculate step to match screen pixels
            // If using MIPs, step is roughly 1 (since we chose the best level)
            // If raw, step is large
            const step = Math.max(1, (endSample - startSample) / width)

            // Normalize Visualization
            // Find peak of the entire buffer for consistent scaling
            // Or use a fixed gain boost if we assume audio is normalized
            // Since we added backend normalization, we can just boost slightly
            // But let's be safe and auto-scale
            let bufferPeak = 0;
            if (audioBuffer) {
                // Quick peak check (approximate)
                const raw = audioBuffer.getChannelData(0);
                // Check every 1000th sample for speed
                for (let i = 0; i < raw.length; i += 1000) {
                    const val = Math.abs(raw[i]);
                    if (val > bufferPeak) bufferPeak = val;
                }
                if (bufferPeak < 0.01) bufferPeak = 0.1; // Prevent div by zero
            }

            const amp = (height / 2) / bufferPeak; // Scale to fill height

            ctx.fillStyle = loop.texture ? '#ff5555' : '#bff46a'
            ctx.beginPath()

            // Optimized drawing loop
            for (let i = 0; i < width; i++) {
                const dataIdx = Math.floor(startSample + (i * step))

                // MIP data is interleaved min/max
                // Raw data is single value
                let min = 0, max = 0

                if (mip) {
                    const idx = dataIdx * 2
                    if (idx >= data.length) break
                    min = data[idx]
                    max = data[idx + 1]
                } else {
                    // Raw sampling (simple decimation for extreme zoom)
                    if (dataIdx >= data.length) break
                    const val = data[dataIdx]
                    min = val
                    max = val
                }

                // Dim outside crop
                const t = startTime + (i / width) * visibleDuration
                const isCropped = t < (loop.cropStart || 0) || t > (loop.cropEnd || duration)

                const barHeight = (max - min) * amp
                const barY = (height / 2) - (max * amp)

                if (isCropped) {
                    ctx.fillStyle = 'rgba(60, 60, 60, 0.5)'
                    ctx.fillRect(i, barY, 1, barHeight)
                    ctx.fillStyle = loop.texture ? '#ff5555' : '#bff46a' // Reset
                } else {
                    ctx.fillRect(i, barY, 1, barHeight)
                }
            }

            // Draw Crop Handles
            const startX = timeToX(loop.cropStart || 0)
            const endX = timeToX(loop.cropEnd || duration)

            // Start Handle
            if (startX >= -20 && startX <= width + 20) {
                ctx.fillStyle = 'var(--accent-primary)'
                ctx.fillRect(startX, 0, 2, height)
                // Flag
                ctx.beginPath()
                ctx.moveTo(startX, 0)
                ctx.lineTo(startX + 10, 0)
                ctx.lineTo(startX, 10)
                ctx.fill()
            }

            // End Handle
            if (endX >= -20 && endX <= width + 20) {
                ctx.fillStyle = 'var(--accent-primary)'
                ctx.fillRect(endX - 2, 0, 2, height)
                // Flag
                ctx.beginPath()
                ctx.moveTo(endX, height)
                ctx.lineTo(endX - 10, height)
                ctx.lineTo(endX, height - 10)
                ctx.fill()
            }

            // Draw Playhead
            if (isActive) {
                // We need real playback time. 
                // Since we don't have it passed in (only isActive), we can't draw it accurately here without a ref.
                // But the user wants "click to play".
                // Let's assume the parent component handles the audio element and we just visualize.
                // For now, let's skip the fake playhead and rely on the audio element's native controls or add a prop.
                // Actually, let's try to get the audio element time if possible.
                const audio = document.getElementById(`audio-${loop.filename}`) as HTMLAudioElement
                if (audio) {
                    const px = timeToX(audio.currentTime)
                    if (px >= 0 && px <= width) {
                        ctx.strokeStyle = '#fff'
                        ctx.lineWidth = 1
                        ctx.beginPath()
                        ctx.moveTo(px, 0)
                        ctx.lineTo(px, height)
                        ctx.stroke()
                    }
                }
            }

            // Draw Hover Line & Snap Indicator
            if (hoverTime !== null) {
                const hx = timeToX(hoverTime)
                if (hx >= 0 && hx <= width) {
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
                    ctx.lineWidth = 1
                    ctx.setLineDash([4, 4])
                    ctx.beginPath()
                    ctx.moveTo(hx, 0)
                    ctx.lineTo(hx, height)
                    ctx.stroke()
                    ctx.setLineDash([])

                    // Time Label
                    ctx.fillStyle = '#fff'
                    ctx.font = '10px monospace'
                    ctx.fillText(formatTime(hoverTime, loop.bpm || 120), hx + 5, 12)
                }
            }

            // Draw Snap Highlight
            if (snappedTime !== null && isDragging) {
                const sx = timeToX(snappedTime)
                if (sx >= 0 && sx <= width) {
                    ctx.strokeStyle = 'cyan'
                    ctx.lineWidth = 2
                    ctx.beginPath()
                    ctx.moveTo(sx, 0)
                    ctx.lineTo(sx, height)
                    ctx.stroke()
                }
            }

            animationFrameId = requestAnimationFrame(render)
        }

        render()
        return () => cancelAnimationFrame(animationFrameId)
    }, [audioBuffer, waveformMips, zoom, scroll, loop, hoverTime, snappedTime, isActive])

    // Interaction Handlers
    const handleWheel = useCallback((e: React.WheelEvent) => {
        // Prevent default browser scrolling if inside the waveform area
        // Note: React's synthetic event might be too late for passive listeners, 
        // but we'll try. Ideally this is done in a ref listener.

        if (!audioBuffer || !containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const width = rect.width
        const relX = Math.max(0, Math.min(1, x / width))

        const duration = audioBuffer.duration
        const visibleDuration = duration / zoom
        const startTime = scroll * (duration - visibleDuration)

        // Time at mouse cursor
        const mouseTime = startTime + (relX * visibleDuration)

        // Determine Zoom or Pan
        // User wants: Wheel = Zoom, but "scroll when hovering outside".
        // So inside here, we Zoom by default.

        if (Math.abs(e.deltaY) > 0) {
            // Zoom
            const delta = -e.deltaY * ZOOM_SENSITIVITY * 2 // Snappier
            const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)))

            // Calculate new scroll to keep mouseTime at relX
            const newVisibleDuration = duration / newZoom
            // mouseTime = newStartTime + (relX * newVisibleDuration)
            // newStartTime = mouseTime - (relX * newVisibleDuration)
            const newStartTime = mouseTime - (relX * newVisibleDuration)

            const maxStartTime = duration - newVisibleDuration
            const newScroll = maxStartTime > 0 ? newStartTime / maxStartTime : 0

            setZoom(newZoom)
            setScroll(Math.max(0, Math.min(1, newScroll)))
        }
    }, [zoom, scroll, audioBuffer])

    // Attach non-passive listener for wheel to prevent page scroll
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
    }, [])

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        if (!audioBuffer || !containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const width = rect.width
        const relX = Math.max(0, Math.min(1, x / width))

        const duration = audioBuffer.duration
        const visibleDuration = duration / zoom
        const startTime = scroll * (duration - visibleDuration)
        let time = startTime + (relX * visibleDuration)

        // Snap to grid if enabled (always enabled if BPM exists for now)
        if (loop.bpm) {
            const beatDur = 60 / loop.bpm
            // Snap to nearest 1/4 beat (16th note)
            const snapUnit = beatDur / 4
            const snapped = Math.round(time / snapUnit) * snapUnit

            // Snap threshold: 10 pixels
            const pxPerSec = width / visibleDuration
            if (Math.abs(time - snapped) * pxPerSec < 10) {
                time = snapped
            }
        }

        // Check if clicking handles
        const startX = ((loop.cropStart || 0) - startTime) / visibleDuration * width
        const endX = ((loop.cropEnd || duration) - startTime) / visibleDuration * width

        if (Math.abs(x - startX) < 10) {
            setIsDragging('start')
        } else if (Math.abs(x - endX) < 10) {
            setIsDragging('end')
        } else {
            // Click to Play / Seek
            // If dragging, we scrub. If click, we seek.
            // Let's implement immediate seek on click
            const audio = document.getElementById(`audio-${loop.filename}`) as HTMLAudioElement
            if (audio) {
                audio.currentTime = time
                if (!isActive) requestPlay()
            }
            setIsDragging('scrub')
        }

        // Capture pointer for smooth dragging
        (e.target as HTMLElement).setPointerCapture(e.pointerId)
    }, [audioBuffer, zoom, scroll, loop, isActive, requestPlay, scrub])

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!audioBuffer || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const width = rect.width

        const duration = audioBuffer.duration
        const visibleDuration = duration / zoom
        const startTime = scroll * (duration - visibleDuration)
        let time = startTime + (x / width) * visibleDuration
        time = Math.max(0, Math.min(duration, time))

        setHoverTime(time)
        setSnappedTime(null)

        if (isDragging) {
            // Snap Logic
            let snapped = time
            if (loop.bpm) {
                const beat = 60 / loop.bpm
                const gridSnap = Math.round(time / beat) * beat
                if (Math.abs(time - gridSnap) < 0.05) {
                    snapped = gridSnap
                    setSnappedTime(snapped)
                }
            }

            if (isDragging === 'start') {
                const newStart = Math.min(snapped, (loop.cropEnd || duration) - 0.05)
                onCropChange(loop.filename, newStart, loop.cropEnd || duration)
                scrub(newStart)
            } else if (isDragging === 'end') {
                const newEnd = Math.max(snapped, (loop.cropStart || 0) + 0.05)
                onCropChange(loop.filename, loop.cropStart || 0, newEnd)
                scrub(newEnd) // Play grain at end point
            }
        }
    }, [audioBuffer, zoom, scroll, loop, isDragging, onCropChange, scrub])

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        setIsDragging(null)
        setSnappedTime(null)
        e.currentTarget.releasePointerCapture(e.pointerId)
    }, [])

    return (
        <div className={`vst-panel ${isActive ? 'active' : ''}`} style={{ borderColor: isActive ? 'var(--accent-primary)' : '#000' }}>
            <div className="vst-panel-header">
                <div className="flex-col">
                    <div className="flex gap-2 items-center">
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{loop.role}</span>
                        {loop.texture && <span style={{ fontSize: 9, color: '#ff5555', background: '#331111', padding: '1px 3px' }}>{loop.texture.toUpperCase()}</span>}
                    </div>
                    <div style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>
                        {loop.bpm} BPM · {loop.bars} BARS
                    </div>
                </div>
                <RetroButton
                    active={isActive}
                    onClick={requestPlay}
                    style={{ width: 60, height: 20, fontSize: 10 }}
                >
                    {isActive ? 'STOP' : 'PLAY'}
                </RetroButton>
            </div>

            {/* WAVEFORM CANVAS */}
            <div
                ref={containerRef}
                className="waveform-vst"
                style={{ height: 140, cursor: isDragging ? 'ew-resize' : 'crosshair', position: 'relative' }}
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={() => {
                    setHoverTime(null)
                    setSnappedTime(null)
                }}
            >
                {loading && <div className="flex-center h-full text-dim" style={{ fontSize: 10 }}>LOADING PCM...</div>}
                <canvas
                    ref={canvasRef}
                    style={{ width: '100%', height: '100%', display: 'block' }}
                />

                {/* Grid Snap Highlight */}
                {hoverTime !== null && loop.bpm && (
                    <div
                        style={{
                            position: 'absolute',
                            top: 0, bottom: 0,
                            left: `${(hoverTime - (scroll * (audioBuffer?.duration || 0) - (audioBuffer?.duration || 0) / zoom)) / ((audioBuffer?.duration || 0) / zoom) * 100}%`,
                            width: 1,
                            background: 'rgba(255, 255, 255, 0.5)',
                            pointerEvents: 'none'
                        }}
                    />
                )}

                {/* Zoom Indicator */}
                <div className="p-2 bg-[#1a1a1a] border-t border-black flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                        <div className="flex gap-4">
                            <RetroCheckbox
                                label="INCLUDE"
                                checked={loop.selected}
                                onChange={() => onMeta(loop.filename, { selected: !loop.selected })}
                            />
                            <RetroCheckbox
                                label="LOOP"
                                checked={loop.loopPlayback}
                                onChange={e => onMeta(loop.filename, { loopPlayback: e })}
                            />
                        </div>

                        <div className="flex gap-1">
                            {/* Texture buttons removed for clarity */}
                        </div>
                    </div>

                    {/* CONTEXTUAL VOCAL FX - Only show for vocal loops */}
                    {loop.role === 'vocals' && vocalSettings && onVocalSettingsChange && (
                        <div className="border-t border-[#222] pt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-[10px] font-bold text-[var(--accent-primary)] tracking-widest">VOCAL FX CHAIN</span>
                                <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] animate-pulse shadow-[0_0_8px_var(--accent-primary)]" />
                            </div>

                            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                                <RetroSlider
                                    label="HARD TUNE"
                                    value={vocalSettings.correction_strength}
                                    min={0} max={1} step={0.05}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    onChange={(e) => onVocalSettingsChange({ ...vocalSettings, correction_strength: parseFloat(e.target.value) })}
                                />
                                <RetroSlider
                                    label="FORMANT"
                                    value={vocalSettings.formant_shift}
                                    min={-12} max={12} step={1}
                                    formatValue={(v) => `${v > 0 ? '+' : ''}${v}`}
                                    onChange={(e) => onVocalSettingsChange({ ...vocalSettings, formant_shift: parseInt(e.target.value) })}
                                />
                                <RetroSlider
                                    label="WOBBLE"
                                    value={vocalSettings.pitch_wobble}
                                    min={0} max={1} step={0.05}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    onChange={(e) => onVocalSettingsChange({ ...vocalSettings, pitch_wobble: parseFloat(e.target.value) })}
                                />
                                <RetroSlider
                                    label="GLITCH"
                                    value={vocalSettings.stutter_intensity}
                                    min={0} max={1} step={0.05}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    onChange={(e) => onVocalSettingsChange({ ...vocalSettings, stutter_intensity: parseFloat(e.target.value) })}
                                />
                                <RetroSlider
                                    label="CRUSH"
                                    value={vocalSettings.bitcrush_depth}
                                    min={8} max={24} step={1}
                                    direction="rtl"
                                    formatValue={(v) => `${v} BIT`}
                                    onChange={(e) => onVocalSettingsChange({ ...vocalSettings, bitcrush_depth: parseInt(e.target.value) })}
                                />
                                <RetroSlider
                                    label="ETHEREAL"
                                    value={vocalSettings.phase_smear}
                                    min={0} max={1} step={0.05}
                                    formatValue={(v) => `${Math.round(v * 100)}%`}
                                    onChange={(e) => onVocalSettingsChange({ ...vocalSettings, phase_smear: parseFloat(e.target.value) })}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* PHRASE DETECTION OVERLAY - Only for vocals/melody */}
            {(loop.role === 'vocals' || loop.role === 'melody') && audioBuffer && (
                <PhraseOverlay
                    sessionId={sessionId}
                    filename={loop.filename}
                    role={loop.role}
                    bpm={loop.bpm}
                    duration={audioBuffer.duration}
                    onPhraseSelect={(start, end) => {
                        // Auto-snap crop to detected phrase boundaries
                        onCropChange(loop.filename, start, end);
                    }}
                />
            )}
        </div>
    )
}
