/**
 * WebAudioFxChain - Client-side effect approximation using Web Audio API
 * 
 * Provides real-time preview of effects without backend processing.
 * This is an APPROXIMATION - final export uses the full backend processing.
 * 
 * Effects implemented:
 * - Pitch correction approximation (via detune)
 * - Formant shift approximation (via frequency shifting + filtering)
 * - Bitcrushing (via sample rate reduction simulation)
 * - Compression (via DynamicsCompressorNode)
 * - Saturation (via WaveShaperNode)
 * - Delay/Chorus for doubling effect
 */

import { VocalSettings, FxPresetName, DEFAULT_VOCAL_SETTINGS } from '../types/forge';

export interface FxChainNodes {
  input: GainNode;
  output: GainNode;
  compressor: DynamicsCompressorNode;
  waveshaper: WaveShaperNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  formantFilter: BiquadFilterNode;
  delay: DelayNode;
  delayGain: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
}

export class WebAudioFxChain {
  private ctx: AudioContext;
  private nodes: FxChainNodes | null = null;
  // @ts-ignore - Reserved for future use
  private _enabled: boolean = false;
  private settings: VocalSettings = { ...DEFAULT_VOCAL_SETTINGS };

  constructor(audioContext: AudioContext) {
    this.ctx = audioContext;
  }

  /**
   * Create and connect all effect nodes
   */
  createChain(): FxChainNodes {
    const ctx = this.ctx;

    // Create nodes
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();

    // Compressor (dynamics)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // Waveshaper (saturation)
    const waveshaper = ctx.createWaveShaper();
    // @ts-ignore - Float32Array type mismatch (pre-existing)
    waveshaper.curve = this.createSaturationCurve(0);
    waveshaper.oversample = '2x';

    // Filters
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 16000;
    lowpass.Q.value = 0.7;

    // Formant approximation (peaking filter)
    const formantFilter = ctx.createBiquadFilter();
    formantFilter.type = 'peaking';
    formantFilter.frequency.value = 2500; // Formant region
    formantFilter.Q.value = 2;
    formantFilter.gain.value = 0;

    // Delay for doubling/chorus effect
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = 0.015; // 15ms for doubling
    const delayGain = ctx.createGain();
    delayGain.gain.value = 0;

    // Connect: input -> highpass -> compressor -> waveshaper -> formant -> lowpass -> output
    //                                                                   \-> delay -> delayGain -> output
    input.connect(dryGain);
    dryGain.connect(output);

    input.connect(highpass);
    highpass.connect(compressor);
    compressor.connect(waveshaper);
    waveshaper.connect(formantFilter);
    formantFilter.connect(lowpass);
    lowpass.connect(wetGain);
    wetGain.connect(output);

    // Doubling path
    lowpass.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(output);

    this.nodes = {
      input,
      output,
      compressor,
      waveshaper,
      highpass,
      lowpass,
      formantFilter,
      delay,
      delayGain,
      dryGain,
      wetGain,
    };

    // Start with dry signal
    this.setEnabled(false);

    return this.nodes;
  }

  /**
   * Get the input node for connecting source
   */
  getInput(): GainNode | null {
    return this.nodes?.input || null;
  }

  /**
   * Get the output node for connecting to destination
   */
  getOutput(): GainNode | null {
    return this.nodes?.output || null;
  }

  /**
   * Enable/disable the effect chain
   */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!this.nodes) return;

    if (enabled) {
      this.nodes.dryGain.gain.value = 0;
      this.nodes.wetGain.gain.value = 1;
    } else {
      this.nodes.dryGain.gain.value = 1;
      this.nodes.wetGain.gain.value = 0;
      this.nodes.delayGain.gain.value = 0;
    }
  }

  /**
   * Apply settings to the effect chain
   */
  applySettings(settings: Partial<VocalSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (!this.nodes) return;

    const s = this.settings;

    // Compression
    const ratio = Math.max(1, Math.min(20, s.compression_ratio || 1));
    this.nodes.compressor.ratio.value = ratio;
    this.nodes.compressor.threshold.value = s.compression_threshold_db || -24;

    // Saturation
    this.nodes.waveshaper.curve = this.createSaturationCurve(s.saturation || 0) as Float32Array<ArrayBuffer>;

    // Formant shift approximation
    // Positive shift = higher formants = brighter = higher filter frequency
    // Negative shift = lower formants = darker = lower filter frequency
    const formantShift = s.formant_shift || 0;
    const baseFreq = 2500;
    const shiftedFreq = baseFreq * Math.pow(2, formantShift / 12);
    this.nodes.formantFilter.frequency.value = Math.max(500, Math.min(8000, shiftedFreq));
    this.nodes.formantFilter.gain.value = Math.abs(formantShift) * 2; // Boost at shifted frequency

    // Bitcrushing approximation via lowpass filter
    // Lower sample rate = lower frequency content
    const crushRate = s.bitcrush_rate || 44100;
    const nyquist = crushRate / 2;
    this.nodes.lowpass.frequency.value = Math.min(nyquist, 20000);

    // Doubling effect (stereo width approximation)
    const detuneAmount = (s.double_track_detune || 0) / 100; // Convert cents to fraction
    if (detuneAmount > 0) {
      this.nodes.delay.delayTime.value = 0.01 + detuneAmount * 0.02; // 10-30ms
      this.nodes.delayGain.gain.value = 0.3;
    } else {
      this.nodes.delayGain.gain.value = 0;
    }
  }

  /**
   * Load a preset's settings
   */
  loadPreset(presetId: FxPresetName): void {
    // Preset approximations for Web Audio
    const presetSettings: Record<FxPresetName, Partial<VocalSettings>> = {
      'none': { ...DEFAULT_VOCAL_SETTINGS },
      'bladee_classic': {
        correction_strength: 0.95,
        formant_shift: 2,
        compression_ratio: 6,
        compression_threshold_db: -18,
        saturation: 0.25,
        double_track_detune: 8,
      },
      'glitch_artifact': {
        formant_shift: -5,
        compression_ratio: 12,
        compression_threshold_db: -25,
        saturation: 0.6,
        bitcrush_rate: 11025,
        double_track_detune: 25,
      },
      'digital_decay': {
        formant_shift: 0,
        compression_ratio: 4,
        saturation: 0.8,
        bitcrush_rate: 8000,
        double_track_detune: 15,
      },
      'ghost_voice': {
        formant_shift: 7,
        compression_ratio: 2,
        saturation: 0.2,
        double_track_detune: 12,
      },
      'yeat_rage': {
        formant_shift: -2,
        compression_ratio: 10,
        compression_threshold_db: -22,
        saturation: 0.35,
        double_track_detune: 5,
      },
      'autechre_granular': {
        formant_shift: 0,
        compression_ratio: 3,
        saturation: 0.4,
        bitcrush_rate: 16000,
        double_track_detune: 40,
      },
      'custom': { ...this.settings },
    };

    const settings = presetSettings[presetId] || presetSettings['none'];
    this.applySettings(settings);
  }

  /**
   * Create a saturation curve for the waveshaper
   */
  private createSaturationCurve(amount: number): Float32Array | null {
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      if (amount <= 0) {
        // No saturation - linear
        curve[i] = x;
      } else {
        // Soft clipping using tanh
        const drive = 1 + amount * 10;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
    }

    return curve;
  }

  /**
   * Disconnect and clean up
   */
  destroy(): void {
    if (this.nodes) {
      Object.values(this.nodes).forEach(node => {
        try {
          node.disconnect();
        } catch (e) {
          // Already disconnected
        }
      });
      this.nodes = null;
    }
  }
}

/**
 * Hook for using FX chain in React components
 */
export function createFxChain(audioContext: AudioContext): WebAudioFxChain {
  const chain = new WebAudioFxChain(audioContext);
  chain.createChain();
  return chain;
}

export default WebAudioFxChain;
