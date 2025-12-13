/**
 * WaveformAnalyzer
 * 
 * Generates multi-resolution peak data (MIP-maps) from an AudioBuffer.
 * This allows O(1) rendering performance at any zoom level by selecting
 * the appropriate pre-computed resolution.
 */

export interface WaveformMips {
    // Level 0: Overview (1024 samples per pixel approx)
    // Level 1: Zoomed (128 samples per pixel)
    // Level 2: Detailed (16 samples per pixel)
    // Level 3: Raw (1 sample per pixel - implicit)
    levels: Float32Array[]
    samplesPerPixel: number[]
}

export class WaveformAnalyzer {
    static generateMips(buffer: AudioBuffer): WaveformMips {
        const channelData = buffer.getChannelData(0) // Mono for now
        const length = channelData.length

        // Define resolutions (samples per point)
        // We use "max" pooling to preserve transients visually
        const resolutions = [256, 64, 16]

        const levels: Float32Array[] = []

        for (const res of resolutions) {
            const steps = Math.ceil(length / res)
            const level = new Float32Array(steps * 2) // Interleaved min/max

            for (let i = 0; i < steps; i++) {
                let min = 1.0
                let max = -1.0

                const start = i * res
                const end = Math.min(start + res, length)

                for (let j = start; j < end; j++) {
                    const val = channelData[j]
                    if (val < min) min = val
                    if (val > max) max = val
                }

                // If silent/flat
                if (min > max) {
                    min = 0
                    max = 0
                }

                level[i * 2] = min
                level[i * 2 + 1] = max
            }

            levels.push(level)
        }

        return {
            levels,
            samplesPerPixel: resolutions
        }
    }

    /**
     * Find the best MIP level for the current zoom
     * @param zoom pixels per second
     * @param sampleRate audio sample rate
     */
    static getBestLevel(zoom: number, sampleRate: number, mips: WaveformMips): { level: Float32Array, samplesPerPixel: number } | null {
        const requestedSamplesPerPixel = sampleRate / zoom

        // Find the coarsest level that still has enough detail
        // We want level_spp <= requested_spp

        for (let i = 0; i < mips.samplesPerPixel.length; i++) {
            if (mips.samplesPerPixel[i] <= requestedSamplesPerPixel) {
                return {
                    level: mips.levels[i],
                    samplesPerPixel: mips.samplesPerPixel[i]
                }
            }
        }

        // If we need more detail than the finest MIP, return null (use raw buffer)
        return null
    }
}
