import { useEffect, useRef, useState } from 'react'

interface Candidate {
    start: number
    end: number
    score: number
    bars: number
}

interface WaveformVisualizerProps {
    data: {
        waveform: number[]
        vad_curve: number[]
        onset_curve: number[]
        candidates: Candidate[]
        duration: number
        bpm: number
    }
    onSelectRegion: (start: number, end: number) => void
    playingPosition?: number // 0-1
}

export function WaveformVisualizer({ data, onSelectRegion, playingPosition }: WaveformVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        const width = canvas.clientWidth
        const height = canvas.clientHeight

        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)

        // Clear
        ctx.clearRect(0, 0, width, height)

        // 1. Draw Waveform (Mirrored)
        const centerY = height / 2
        const ampScale = height / 2 * 0.9

        ctx.beginPath()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
        ctx.lineWidth = 1

        for (let i = 0; i < data.waveform.length; i++) {
            const x = (i / data.waveform.length) * width
            const y = data.waveform[i] * ampScale
            ctx.moveTo(x, centerY - y)
            ctx.lineTo(x, centerY + y)
        }
        ctx.stroke()

        // Draw Beat Grid
        if (data.bpm && data.duration) {
            const secondsPerBeat = 60 / data.bpm
            const totalBeats = data.duration / secondsPerBeat
            const pixelsPerBeat = width / totalBeats

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
            ctx.lineWidth = 1
            ctx.beginPath()

            for (let i = 0; i < totalBeats; i++) {
                const x = i * pixelsPerBeat
                ctx.moveTo(x, 0)
                ctx.lineTo(x, height)
            }
            ctx.stroke()
        }

        // 2. Draw VAD Curve (Teal)
        if (data.vad_curve.length > 0) {
            ctx.beginPath()
            ctx.strokeStyle = 'rgba(100, 255, 218, 0.5)' // Teal
            ctx.lineWidth = 2

            for (let i = 0; i < data.vad_curve.length; i++) {
                const x = (i / data.vad_curve.length) * width
                const y = centerY - (data.vad_curve[i] * ampScale * 0.8) // Only top half
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.stroke()
        }

        // 3. Draw Candidates
        data.candidates.forEach((cand, idx) => {
            const startX = (cand.start / data.duration) * width
            const endX = (cand.end / data.duration) * width
            const w = endX - startX

            const isSelected = selectedCandidate === idx

            ctx.fillStyle = isSelected
                ? 'rgba(255, 255, 255, 0.1)'
                : 'rgba(255, 255, 255, 0.03)'

            ctx.fillRect(startX, 0, w, height)

            // Border
            ctx.strokeStyle = isSelected
                ? 'rgba(255, 255, 255, 0.8)'
                : 'rgba(255, 255, 255, 0.1)'
            ctx.strokeRect(startX, 0, w, height)

            // Label
            if (w > 20) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
                ctx.font = '10px monospace'
                ctx.fillText(`${cand.bars} bars`, startX + 4, 12)
            }
        })

        // 4. Playhead
        if (playingPosition !== undefined) {
            const x = playingPosition * width
            ctx.beginPath()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 1
            ctx.moveTo(x, 0)
            ctx.lineTo(x, height)
            ctx.stroke()
        }

    }, [data, selectedCandidate, playingPosition])

    const handleClick = (e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const t = (x / rect.width) * data.duration

        // Find clicked candidate
        const clickedIdx = data.candidates.findIndex(c => t >= c.start && t <= c.end)
        if (clickedIdx !== -1) {
            setSelectedCandidate(clickedIdx)
            onSelectRegion(data.candidates[clickedIdx].start, data.candidates[clickedIdx].end)
        }
    }

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-32 bg-black/20 rounded cursor-crosshair"
            onClick={handleClick}
        />
    )
}
