/**
 * High-performance waveform renderer with spectrogram overlay
 * Ableton-style visualization
 */

export class WaveformRenderer {
    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D
    private audioBuffer: AudioBuffer | null = null
    private spectrogramData: Float32Array[] = []

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('No 2D context')
        this.ctx = ctx

        // Set canvas to device pixel ratio for crisp rendering
        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        canvas.width = rect.width * dpr
        canvas.height = rect.height * dpr
        this.ctx.scale(dpr, dpr)
    }

    setAudioBuffer(buffer: AudioBuffer) {
        this.audioBuffer = buffer
        this.computeSpectrogram()
    }

    private computeSpectrogram() {
        if (!this.audioBuffer) return

        const channelData = this.audioBuffer.getChannelData(0)
        const fftSize = 2048
        const hopSize = fftSize / 4

        // Simple FFT-based spectrogram (replace with real FFT library in production)
        for (let i = 0; i < channelData.length - fftSize; i += hopSize) {
            const slice = channelData.slice(i, i + fftSize)
            // Compute magnitude spectrum (simplified)
            const magnitudes = new Float32Array(fftSize / 2)
            for (let j = 0; j < fftSize / 2; j++) {
                magnitudes[j] = Math.abs(slice[j] || 0)
            }
            this.spectrogramData.push(magnitudes)
        }
    }

    render(options: {
        zoom: number // pixels per second
        offset: number // seconds
        showSpectrogram: boolean
        waveformColor: string
        backgroundColor: string
    }) {
        if (!this.audioBuffer) return

        const width = this.canvas.width
        const height = this.canvas.height
        const { zoom, offset, showSpectrogram, waveformColor, backgroundColor } = options

        // Clear
        this.ctx.fillStyle = backgroundColor
        this.ctx.fillRect(0, 0, width, height)

        if (showSpectrogram && this.spectrogramData.length > 0) {
            this.renderSpectrogram(zoom, offset)
        }

        this.renderWaveform(zoom, offset, waveformColor)
        this.renderGrid(zoom, offset)
    }

    private renderSpectrogram(zoom: number, offset: number) {
        const width = this.canvas.width
        const height = this.canvas.height

        // Render spectrogram as heatmap
        this.spectrogramData.forEach((magnitudes, idx) => {
            const x = idx * 10 // Simplified time mapping
            if (x < offset * zoom || x > (offset + width / zoom) * zoom) return

            magnitudes.forEach((mag, freqIdx) => {
                const y = height - (freqIdx / magnitudes.length) * height
                const intensity = Math.min(mag * 255, 255)
                this.ctx.fillStyle = `rgba(191, 244, 106, ${intensity / 255 * 0.3})`
                this.ctx.fillRect(x - offset * zoom, y, 2, 2)
            })
        })
    }

    private renderWaveform(zoom: number, offset: number, color: string) {
        if (!this.audioBuffer) return

        const width = this.canvas.width
        const height = this.canvas.height
        const channelData = this.audioBuffer.getChannelData(0)
        const sampleRate = this.audioBuffer.sampleRate

        this.ctx.strokeStyle = color
        this.ctx.lineWidth = 1.5
        this.ctx.beginPath()

        const samplesPerPixel = sampleRate / zoom
        const centerY = height / 2

        for (let x = 0; x < width; x++) {
            const sampleIndex = Math.floor((offset * sampleRate) + (x * samplesPerPixel))
            if (sampleIndex >= channelData.length) break

            // Get min/max for this pixel to show detail
            const endIndex = Math.min(sampleIndex + samplesPerPixel, channelData.length)
            let min = 0, max = 0

            for (let i = sampleIndex; i < endIndex; i++) {
                const sample = channelData[i]
                if (sample < min) min = sample
                if (sample > max) max = sample
            }

            const yMin = centerY - (min * centerY)
            const yMax = centerY - (max * centerY)

            if (x === 0) {
                this.ctx.moveTo(x, yMin)
            } else {
                this.ctx.lineTo(x, yMin)
            }
            this.ctx.lineTo(x, yMax)
        }

        this.ctx.stroke()
    }

    private renderGrid(zoom: number, offset: number) {
        const width = this.canvas.width
        const height = this.canvas.height

        // Render time grid (1-second intervals)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
        this.ctx.lineWidth = 1

        for (let sec = Math.floor(offset); sec < offset + (width / zoom); sec++) {
            const x = (sec - offset) * zoom
            this.ctx.beginPath()
            this.ctx.moveTo(x, 0)
            this.ctx.lineTo(x, height)
            this.ctx.stroke()
        }

        // Center line
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
        this.ctx.beginPath()
        this.ctx.moveTo(0, height / 2)
        this.ctx.lineTo(width, height / 2)
        this.ctx.stroke()
    }
}
