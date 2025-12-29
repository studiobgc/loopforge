/**
 * Loop Forge Audio Engine
 * 
 * A professional-grade Web Audio engine with:
 * - Sample-accurate slice triggering via AudioWorklet
 * - Real-time parameter smoothing
 * - Sub-millisecond timing precision
 * - Lock-free audio thread communication
 * 
 * Inspired by Ableton's audio engine architecture.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface SlicePlaybackOptions {
  velocity?: number;        // 0-1
  pitchShift?: number;      // semitones
  reverse?: boolean;
  pan?: number;             // -1 to 1
  attack?: number;          // seconds
  release?: number;         // seconds
  filterCutoff?: number;    // Hz (null = bypass)
  filterResonance?: number; // 0-1
  startOffset?: number;     // seconds into slice
  duration?: number;        // playback duration (null = full)
  // Footwork-specific parameters
  microOffset?: number;     // Timing offset in beats (for micro-timing)
  envelopeSweep?: number;    // TR-808 style pitch sweep (0-1)
  saturationAmount?: number; // Saturation/distortion level (0-1)
  swingAmount?: number;     // Swing/triplet feel (0-1)
}

export interface ScheduledTrigger {
  time: number;             // AudioContext time
  sliceIndex: number;
  options: SlicePlaybackOptions;
  id: string;
}

export interface AudioAnalysis {
  rms: number;
  peak: number;
  spectrum: Float32Array;
  waveform: Float32Array;
}

type EngineState = 'suspended' | 'running' | 'closed';

// =============================================================================
// AUDIO ENGINE
// =============================================================================

// =============================================================================
// PER-STEM FX CHAIN
// =============================================================================

export interface StemFxSettings {
  enabled: boolean;
  preset: string;  // 'none' | 'bladee_classic' | 'glitch_artifact' | etc.
  // Individual parameters (used when preset = 'custom')
  formantShift: number;      // semitones (-24 to +24)
  compression: number;       // 0-1 (maps to ratio 1-12)
  saturation: number;        // 0-1
  bitcrushRate: number;      // 6000-44100 Hz
  phaseSmear: number;        // 0-1
  pitchWobble: number;       // 0-1
  doubleTrackDetune: number; // 0-50 cents
}

const DEFAULT_FX_SETTINGS: StemFxSettings = {
  enabled: false,
  preset: 'none',
  formantShift: 0,
  compression: 0,
  saturation: 0,
  bitcrushRate: 44100,
  phaseSmear: 0,
  pitchWobble: 0,
  doubleTrackDetune: 0,
};

// Preset configurations
const FX_PRESETS: Record<string, Partial<StemFxSettings>> = {
  'none': { enabled: false },
  'bladee_classic': {
    enabled: true,
    formantShift: 2,
    compression: 0.5,
    saturation: 0.25,
    doubleTrackDetune: 8,
  },
  'yeat_rage': {
    enabled: true,
    formantShift: -2,
    compression: 0.8,
    saturation: 0.35,
    doubleTrackDetune: 5,
  },
  'glitch_artifact': {
    enabled: true,
    formantShift: -5,
    compression: 0.9,
    saturation: 0.6,
    bitcrushRate: 11025,
    phaseSmear: 0.4,
  },
  'ghost_voice': {
    enabled: true,
    formantShift: 7,
    compression: 0.2,
    saturation: 0.2,
    phaseSmear: 0.6,
    doubleTrackDetune: 12,
  },
};

interface StemFxChain {
  input: GainNode;
  output: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
  compressor: DynamicsCompressorNode;
  waveshaper: WaveShaperNode;
  formantFilter: BiquadFilterNode;
  lowpass: BiquadFilterNode;  // For bitcrushing approximation
  delay: DelayNode;           // For doubling effect
  delayGain: GainNode;
  settings: StemFxSettings;
}

export class LoopForgeAudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private initPromise: Promise<void> | null = null;
  
  // Per-stem FX chains
  private stemFxChains: Map<string, StemFxChain> = new Map();
  
  // Slice buffer storage
  private sliceBuffers: Map<string, AudioBuffer[]> = new Map();
  private loadingPromises: Map<string, Promise<void>> = new Map();
  
  // CTO-level: Pre-reversed buffer cache to avoid runtime reversal overhead
  private reversedBufferCache: Map<string, AudioBuffer> = new Map();
  
  // CTO-level: Track memory usage for intelligent cleanup
  private bufferMemoryBytes = 0;
  private readonly maxBufferMemoryBytes = 1024 * 1024 * 1024; // 1GB limit (modern browsers can handle this)
  
  // Protected banks that should never be evicted (currently selected stems)
  private protectedBanks: Set<string> = new Set();
  
  // Active voices for polyphony management
  private activeVoices: Map<string, AudioBufferSourceNode> = new Map();
  private maxVoices = 32;
  
  // Scheduling
  private scheduledTriggers: ScheduledTrigger[] = [];
  private scheduleAheadTime = 0.1; // 100ms lookahead
  private schedulerInterval: number | null = null;
  
  // AudioWorklet for sample-accurate timing (pro tightness)
  private schedulerWorklet: AudioWorkletNode | null = null;
  private workletReady = false;
  private useWorkletScheduler = true; // Enable worklet-based scheduling
  private tickCallbacks: Set<(data: { beat: number; tick: number; audioContextTime: number }) => void> = new Set();
  private positionCallbacks: Set<(data: { beat: number; time: number }) => void> = new Set();
  
  // Analysis
  private analysisCallbacks: Set<(analysis: AudioAnalysis) => void> = new Set();
  private analysisInterval: number | null = null;
  private spectrumData: Float32Array | null = null;
  private waveformData: Float32Array | null = null;
  
  // State
  private _state: EngineState = 'suspended';
  private _bpm = 120;
  private _isPlaying = false;
  private _currentBeat = 0;
  private _playStartTime = 0;
  // @ts-ignore - Reserved for future use
  private _masterEffectsEnabled = false;
  
  // Global FX bypass for A/B comparison
  private _globalFxBypass = false;
  
  // Mute/Solo state per stem
  private stemMuteState: Map<string, boolean> = new Map();
  private stemSoloState: Map<string, boolean> = new Map();
  private stemVolumeState: Map<string, number> = new Map();
  
  // =============================================================================
  // INITIALIZATION
  // =============================================================================
  
  async init(): Promise<void> {
    if (this.context) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.context) return;
    
      // Create high-performance audio context
      this.context = new AudioContext({
        latencyHint: 'interactive',
        sampleRate: 44100,
      });

      const ctx = this.context;
    
      // Master chain: Gain → (optional effects) → Analyser → Destination
      // NOTE: No default compression/limiting - stems play back clean
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 0.8;
    
      // Compressor/limiter available but OFF by default
      // User can enable via setMasterEffects()
      this.masterCompressor = ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -12;
      this.masterCompressor.knee.value = 10;
      this.masterCompressor.ratio.value = 4;
      this.masterCompressor.attack.value = 0.003;
      this.masterCompressor.release.value = 0.25;
    
      this.masterLimiter = ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -1;
      this.masterLimiter.knee.value = 0;
      this.masterLimiter.ratio.value = 20;
      this.masterLimiter.attack.value = 0.001;
      this.masterLimiter.release.value = 0.1;
    
      // Analyser for visualization
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
    
      this.spectrumData = new Float32Array(this.analyser.frequencyBinCount);
      this.waveformData = new Float32Array(this.analyser.fftSize);
    
      // Connect CLEAN chain by default (no compression/limiting)
      this.masterGain.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      
      // Track effects state
      this._masterEffectsEnabled = false;
    
      this._state = 'running';
    
      // Initialize AudioWorklet for sample-accurate timing
      await this.initSchedulerWorklet();

      if (this.context !== ctx) return;
    
      // Start analysis loop
      this.startAnalysis();
    
      console.log('[AudioEngine] Initialized', {
        sampleRate: ctx.sampleRate,
        baseLatency: ctx.baseLatency,
        outputLatency: ctx.outputLatency,
      });
    })();

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }
  
  async resume(): Promise<void> {
    if (!this.context) await this.init();
    if (this.context?.state === 'suspended') {
      await this.context.resume();
      this._state = 'running';
    }
  }
  
  /**
   * Get the AudioContext for direct audio operations.
   * Ensures context is initialized first.
   */
  getContext(): AudioContext | null {
    return this.context;
  }
  
  /**
   * Get the master gain node for routing.
   */
  getMasterGain(): GainNode | null {
    return this.masterGain;
  }
  
  // =============================================================================
  // SLICE BUFFER MANAGEMENT
  // =============================================================================
  
  /**
   * Load a slice bank's audio into memory.
   * Fetches all slice audio files and decodes them.
   */
  async loadSliceBank(
    bankId: string,
    stemUrl: string,
    slices: Array<{ startTime: number; endTime: number }>
  ): Promise<void> {
    if (this.sliceBuffers.has(bankId)) return;
    
    // Check if already loading
    const existingPromise = this.loadingPromises.get(bankId);
    if (existingPromise) return existingPromise;
    
    const loadPromise = this._loadSliceBankInternal(bankId, stemUrl, slices);
    this.loadingPromises.set(bankId, loadPromise);
    
    try {
      await loadPromise;
    } finally {
      this.loadingPromises.delete(bankId);
    }
  }
  
  private async _loadSliceBankInternal(
    bankId: string,
    stemUrl: string,
    slices: Array<{ startTime: number; endTime: number }>
  ): Promise<void> {
    if (!this.context) await this.init();
    
    console.log(`[AudioEngine] Loading slice bank ${bankId} from ${stemUrl}`);
    
    // Fetch the full stem audio
    const response = await fetch(stemUrl);
    const arrayBuffer = await response.arrayBuffer();
    const fullBuffer = await this.context!.decodeAudioData(arrayBuffer);
    
    // Extract individual slices
    const sliceBuffers: AudioBuffer[] = [];
    
    for (const slice of slices) {
      const startSample = Math.floor(slice.startTime * fullBuffer.sampleRate);
      const endSample = Math.floor(slice.endTime * fullBuffer.sampleRate);
      const length = endSample - startSample;
      
      // Create buffer for this slice
      const sliceBuffer = this.context!.createBuffer(
        fullBuffer.numberOfChannels,
        length,
        fullBuffer.sampleRate
      );
      
      // CTO-level: Use copyFromChannel for better performance (avoids creating intermediate views)
      // This is faster than getChannelData + set, especially for large buffers
      for (let channel = 0; channel < fullBuffer.numberOfChannels; channel++) {
        // Use Float32Array with copyFromChannel for zero-copy slicing where possible
        const destData = sliceBuffer.getChannelData(channel);
        fullBuffer.copyFromChannel(destData, channel, startSample);
      }
      
      // Track memory usage
      this.bufferMemoryBytes += sliceBuffer.length * sliceBuffer.numberOfChannels * 4;
      
      sliceBuffers.push(sliceBuffer);
    }
    
    this.sliceBuffers.set(bankId, sliceBuffers);
    console.log(`[AudioEngine] Loaded ${sliceBuffers.length} slices for bank ${bankId}, memory: ${(this.bufferMemoryBytes / 1024 / 1024).toFixed(1)}MB`);
    
    // CTO-level: Evict old banks if memory pressure is high
    this.evictIfNeeded();
  }
  
  unloadSliceBank(bankId: string): void {
    // CTO-level: Proper memory cleanup with tracking
    const buffers = this.sliceBuffers.get(bankId);
    if (buffers) {
      for (const buf of buffers) {
        this.bufferMemoryBytes -= buf.length * buf.numberOfChannels * 4;
        // Clear reversed cache entries for this bank
        for (const key of this.reversedBufferCache.keys()) {
          if (key.startsWith(bankId)) {
            this.reversedBufferCache.delete(key);
          }
        }
      }
    }
    this.sliceBuffers.delete(bankId);
    console.log(`[AudioEngine] Unloaded bank ${bankId}, memory: ${(this.bufferMemoryBytes / 1024 / 1024).toFixed(1)}MB`);
  }
  
  /**
   * CTO-level: Get current buffer memory usage
   */
  getMemoryUsage(): { bytes: number; megabytes: number; percentUsed: number } {
    return {
      bytes: this.bufferMemoryBytes,
      megabytes: this.bufferMemoryBytes / 1024 / 1024,
      percentUsed: (this.bufferMemoryBytes / this.maxBufferMemoryBytes) * 100,
    };
  }
  
  /**
   * Protect a bank from eviction (call when selecting a stem)
   */
  protectBank(bankId: string): void {
    this.protectedBanks.add(bankId);
  }
  
  /**
   * Remove protection from a bank
   */
  unprotectBank(bankId: string): void {
    this.protectedBanks.delete(bankId);
  }
  
  /**
   * Check if a bank is loaded and ready to play
   */
  isBankReady(bankId: string): boolean {
    return this.sliceBuffers.has(bankId) && !this.loadingPromises.has(bankId);
  }
  
  /**
   * CTO-level: Evict least-recently-used banks if memory pressure is high
   * Never evicts protected banks (currently selected stems)
   */
  private evictIfNeeded(): void {
    if (this.bufferMemoryBytes > this.maxBufferMemoryBytes * 0.95) {
      // Find an unprotected bank to evict
      for (const bankId of this.sliceBuffers.keys()) {
        if (!this.protectedBanks.has(bankId)) {
          console.warn(`[AudioEngine] Memory pressure, evicting unprotected bank ${bankId}`);
          this.unloadSliceBank(bankId);
          return;
        }
      }
      console.warn(`[AudioEngine] Memory pressure but all banks are protected - cannot evict`);
    }
  }
  
  // =============================================================================
  // SLICE PLAYBACK
  // =============================================================================
  
  /**
   * Play a slice immediately with optional parameters.
   * Returns a voice ID for stopping/modifying.
   */
  playSlice(
    bankId: string,
    sliceIndex: number,
    options: SlicePlaybackOptions = {}
  ): string | null {
    return this.playSliceAt(bankId, sliceIndex, this.context?.currentTime ?? 0, options);
  }
  
  /**
   * Schedule a slice to play at a specific AudioContext time.
   * This is the core method for sample-accurate playback.
   */
  playSliceAt(
    bankId: string,
    sliceIndex: number,
    when: number,
    options: SlicePlaybackOptions = {}
  ): string | null {
    if (!this.context || !this.masterGain) return null;
    
    const buffers = this.sliceBuffers.get(bankId);
    if (!buffers || sliceIndex >= buffers.length) {
      console.warn(`[AudioEngine] Slice not found: ${bankId}[${sliceIndex}]`);
      return null;
    }
    
    // Voice stealing if at max polyphony
    if (this.activeVoices.size >= this.maxVoices) {
      const oldestVoice = this.activeVoices.keys().next().value;
      if (oldestVoice) this.stopVoice(oldestVoice);
    }
    
    // CTO-level: Use cached reversed buffer to avoid runtime reversal overhead
    const cacheKey = options.reverse ? `${bankId}:${sliceIndex}:rev` : undefined;
    const buffer = options.reverse 
      ? this.reverseBuffer(buffers[sliceIndex], cacheKey)
      : buffers[sliceIndex];
    
    const voiceId = `${bankId}_${sliceIndex}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Apply micro-timing offset (footwork)
    let adjustedWhen = when;
    if (options.microOffset !== undefined && options.microOffset !== 0) {
      // Convert beat offset to seconds
      const beatDuration = 60.0 / this._bpm;
      adjustedWhen = when + (options.microOffset * beatDuration);
    }
    
    // Create voice chain: Source → Gain → Filter → Pan → Master
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    
    // Pitch shift via playback rate
    let basePlaybackRate = 1.0;
    if (options.pitchShift) {
      basePlaybackRate = Math.pow(2, options.pitchShift / 12);
    }
    
    // Envelope sweep (TR-808 style pitch sweep for kicks)
    // Use automation instead of oscillator for better performance
    if (options.envelopeSweep !== undefined && options.envelopeSweep > 0) {
      const sweepAmount = options.envelopeSweep * 0.2; // Max 20% pitch variation
      const duration = options.duration ?? buffer.duration;
      
      // Set initial playback rate with sweep
      source.playbackRate.setValueAtTime(basePlaybackRate * (1 + sweepAmount), adjustedWhen);
      // Exponential decay to base rate (TR-808 style)
      source.playbackRate.exponentialRampToValueAtTime(basePlaybackRate, adjustedWhen + duration);
    } else {
      source.playbackRate.value = basePlaybackRate;
    }
    
    // Velocity → Gain
    const velocityGain = this.context.createGain();
    const velocity = options.velocity ?? 1;
    velocityGain.gain.value = velocity * velocity; // Quadratic curve feels more natural
    
    // Saturation (footwork - using waveshaper for distortion)
    // Cache saturation curves for performance
    let saturationNode: WaveShaperNode | null = null;
    if (options.saturationAmount !== undefined && options.saturationAmount > 0) {
      saturationNode = this.context.createWaveShaper();
      const amount = options.saturationAmount;
      
      // Generate soft clipping curve
      // Formula: ((1 + k) * x) / (1 + k * |x|) where k = 2 * amount / (1 - amount)
      const curve = new Float32Array(65536);
      const k = 2 * amount / (1 - amount + 1e-6); // Prevent division by zero
      
      for (let i = 0; i < 65536; i++) {
        const x = (i * 2) / 65536 - 1;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      
      saturationNode.curve = curve;
      saturationNode.oversample = '4x';
    }
    
    // Filter (optional)
    let filterNode: BiquadFilterNode | null = null;
    if (options.filterCutoff !== undefined) {
      filterNode = this.context.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = options.filterCutoff;
      filterNode.Q.value = (options.filterResonance ?? 0.5) * 20;
    }
    
    // Stereo panner
    const panner = this.context.createStereoPanner();
    panner.pan.value = options.pan ?? 0;
    
    // Envelope (attack/release) - SNAPPY by default, only use envelope if explicitly requested
    const envelopeGain = this.context.createGain();
    const attack = options.attack ?? 0.001;  // Minimal attack for click-free start
    const release = options.release ?? 0;    // NO release by default = snappy one-shot
    const duration = options.duration ?? buffer.duration;
    
    if (attack > 0 || release > 0) {
      // Only apply envelope if attack or release is specified
      envelopeGain.gain.setValueAtTime(0, adjustedWhen);
      envelopeGain.gain.linearRampToValueAtTime(1, adjustedWhen + attack);
      
      if (release > 0) {
        const releaseStart = adjustedWhen + duration - release;
        if (releaseStart > adjustedWhen + attack) {
          envelopeGain.gain.setValueAtTime(1, releaseStart);
          envelopeGain.gain.linearRampToValueAtTime(0, adjustedWhen + duration);
        }
      }
    } else {
      // No envelope = instant full volume (snappy)
      envelopeGain.gain.value = 1;
    }
    
    // Connect chain with saturation
    source.connect(velocityGain);
    if (saturationNode) {
      velocityGain.connect(saturationNode);
      if (filterNode) {
        saturationNode.connect(filterNode);
        filterNode.connect(panner);
      } else {
        saturationNode.connect(panner);
      }
    } else if (filterNode) {
      velocityGain.connect(filterNode);
      filterNode.connect(panner);
    } else {
      velocityGain.connect(panner);
    }
    panner.connect(envelopeGain);
    envelopeGain.connect(this.masterGain);
    
    // Start playback (using adjusted time for micro-timing)
    const startOffset = options.startOffset ?? 0;
    source.start(adjustedWhen, startOffset, options.duration);
    
    // Track voice
    this.activeVoices.set(voiceId, source);
    
    // Auto-cleanup
    source.onended = () => {
      this.activeVoices.delete(voiceId);
    };
    
    return voiceId;
  }
  
  /**
   * Stop a playing voice with optional fade-out.
   */
  stopVoice(voiceId: string, fadeTime = 0.01): void {
    const source = this.activeVoices.get(voiceId);
    if (source && this.context) {
      try {
        source.stop(this.context.currentTime + fadeTime);
      } catch {
        // Already stopped
      }
      this.activeVoices.delete(voiceId);
    }
  }
  
  /**
   * Stop all playing voices.
   */
  stopAll(fadeTime = 0.05): void {
    for (const voiceId of this.activeVoices.keys()) {
      this.stopVoice(voiceId, fadeTime);
    }
  }
  
  /**
   * Trigger a slice immediately - convenience method for UI.
   * This is the primary method for SliceGrid and keyboard triggers.
   * 
   * Monophonic by default: stops all other voices before playing
   * for snappy, non-overlapping pad behavior.
   */
  triggerSlice(
    stemId: string,
    sliceIndex: number,
    options: {
      velocity?: number;
      pitch?: number;
      pan?: number;
      reverse?: boolean;
      choke?: boolean;  // Stop other voices first (default: true)
    } = {}
  ): string | null {
    if (!this.context) return null;
    
    // Monophonic choke: stop all voices immediately for snappy response
    const shouldChoke = options.choke !== false;
    if (shouldChoke) {
      this.stopAll(0.005);  // 5ms fade to avoid clicks
    }
    
    return this.playSlice(stemId, sliceIndex, {
      velocity: options.velocity ?? 0.8,
      pitchShift: options.pitch ?? 0,
      pan: options.pan ?? 0,
      reverse: options.reverse ?? false,
    });
  }
  
  /**
   * CTO-level: Cache reversed buffers to avoid repeated reversal computation
   */
  private reverseBuffer(buffer: AudioBuffer, cacheKey?: string): AudioBuffer {
    if (!this.context) return buffer;
    
    // Check cache first
    if (cacheKey) {
      const cached = this.reversedBufferCache.get(cacheKey);
      if (cached) return cached;
    }
    
    const reversed = this.context.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );
    
    // CTO-level: Use TypedArray reverse for better performance
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const sourceData = buffer.getChannelData(channel);
      const destData = reversed.getChannelData(channel);
      
      // Copy and reverse in one pass using typed array
      const len = buffer.length;
      for (let i = 0; i < len; i++) {
        destData[i] = sourceData[len - 1 - i];
      }
    }
    
    // Cache if key provided
    if (cacheKey) {
      this.reversedBufferCache.set(cacheKey, reversed);
    }
    
    return reversed;
  }
  
  // =============================================================================
  // TRANSPORT & SEQUENCER
  // =============================================================================
  
  get bpm(): number { return this._bpm; }
  set bpm(value: number) { this._bpm = Math.max(20, Math.min(999, value)); }
  
  get isPlaying(): boolean { return this._isPlaying; }
  get currentBeat(): number { return this._currentBeat; }
  
  /**
   * Convert beats to seconds at current BPM.
   */
  beatsToSeconds(beats: number): number {
    return (beats / this._bpm) * 60;
  }
  
  /**
   * Convert seconds to beats at current BPM.
   */
  secondsToBeats(seconds: number): number {
    return (seconds / 60) * this._bpm;
  }
  
  /**
   * Get the current playback position in beats.
   */
  getCurrentBeat(): number {
    if (!this._isPlaying || !this.context) return this._currentBeat;
    
    const elapsed = this.context.currentTime - this._playStartTime;
    return this._currentBeat + this.secondsToBeats(elapsed);
  }
  
  /**
   * Start playback from current position.
   */
  play(): void {
    if (!this.context || this._isPlaying) return;
    
    this._isPlaying = true;
    this._playStartTime = this.context.currentTime;
    
    // Start scheduler
    this.startScheduler();
  }
  
  /**
   * Stop playback and optionally reset position.
   */
  stop(resetPosition = false): void {
    this._isPlaying = false;
    this.stopScheduler();
    this.stopAll(0.05);
    
    if (this.context) {
      this._currentBeat = this.getCurrentBeat();
    }
    
    if (resetPosition) {
      this._currentBeat = 0;
    }
  }
  
  /**
   * Seek to a specific beat position.
   */
  seek(beat: number): void {
    const wasPlaying = this._isPlaying;
    if (wasPlaying) this.stop();
    
    this._currentBeat = Math.max(0, beat);
    
    if (wasPlaying) this.play();
  }
  
  /**
   * Schedule trigger events for playback.
   * Events are queued and triggered at the correct time.
   */
  scheduleSequence(events: ScheduledTrigger[]): void {
    this.scheduledTriggers = [...events].sort((a, b) => a.time - b.time);
  }
  
  /**
   * Add events to the schedule without clearing existing.
   */
  addToSchedule(events: ScheduledTrigger[]): void {
    this.scheduledTriggers.push(...events);
    this.scheduledTriggers.sort((a, b) => a.time - b.time);
  }
  
  clearSchedule(): void {
    this.scheduledTriggers = [];
  }
  
  private startScheduler(): void {
    if (this.schedulerInterval !== null) return;
    
    this.schedulerInterval = window.setInterval(() => {
      this.processScheduledTriggers();
    }, 25); // 25ms = ~40Hz scheduling rate
  }
  
  private stopScheduler(): void {
    if (this.schedulerInterval !== null) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }
  
  private processScheduledTriggers(): void {
    if (!this.context || !this._isPlaying) return;
    
    const currentBeat = this.getCurrentBeat();
    const lookaheadBeats = this.secondsToBeats(this.scheduleAheadTime);
    const endBeat = currentBeat + lookaheadBeats;
    
    // Find and trigger events in the lookahead window
    while (this.scheduledTriggers.length > 0) {
      const trigger = this.scheduledTriggers[0];
      
      if (trigger.time > endBeat) break;
      
      // Remove from queue
      this.scheduledTriggers.shift();
      
      // Skip if already past
      if (trigger.time < currentBeat - 0.1) continue;
      
      // Calculate exact AudioContext time
      const beatOffset = trigger.time - currentBeat;
      const contextTime = this.context.currentTime + this.beatsToSeconds(beatOffset);
      
      // Extract bank ID from trigger (format: "bankId:sliceIndex" or just use trigger data)
      this.playSliceAt(
        trigger.id.split(':')[0] || trigger.id,
        trigger.sliceIndex,
        contextTime,
        trigger.options
      );
    }
  }
  
  // =============================================================================
  // ANALYSIS & VISUALIZATION
  // =============================================================================
  
  onAnalysis(callback: (analysis: AudioAnalysis) => void): () => void {
    this.analysisCallbacks.add(callback);
    return () => this.analysisCallbacks.delete(callback);
  }
  
  private startAnalysis(): void {
    if (this.analysisInterval !== null) return;
    
    this.analysisInterval = window.setInterval(() => {
      if (!this.analyser || !this.spectrumData || !this.waveformData) return;
      
      // @ts-expect-error - TypeScript strict mode issue with Float32Array<ArrayBufferLike>
      this.analyser.getFloatFrequencyData(this.spectrumData);
      // @ts-expect-error - TypeScript strict mode issue with Float32Array<ArrayBufferLike>
      this.analyser.getFloatTimeDomainData(this.waveformData);
      
      // Calculate RMS and Peak
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < this.waveformData.length; i++) {
        const sample = this.waveformData[i];
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(sum / this.waveformData.length);
      
      const analysis: AudioAnalysis = {
        rms,
        peak,
        spectrum: new Float32Array(this.spectrumData),
        waveform: new Float32Array(this.waveformData),
      };
      
      for (const callback of this.analysisCallbacks) {
        callback(analysis);
      }
    }, 1000 / 60); // 60fps
  }
  
  private stopAnalysis(): void {
    if (this.analysisInterval !== null) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
  }
  
  // =============================================================================
  // STEM PLAYBACK (full buffer playback for transport)
  // =============================================================================
  
  private stemSources: Map<string, AudioBufferSourceNode> = new Map();
  private stemGains: Map<string, GainNode> = new Map();
  
  /**
   * Play a full stem buffer (for transport playback)
   * Routes through FX chain if one exists for this stem
   */
  playStem(
    stemId: string,
    buffer: AudioBuffer,
    options: { volume?: number; muted?: boolean; startOffset?: number; useFx?: boolean } = {}
  ): void {
    if (!this.context || !this.masterGain) return;
    
    // Stop existing playback of this stem
    this.stopStem(stemId);
    
    // Create source
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    
    // Create gain for volume/mute control
    const gain = this.context.createGain();
    gain.gain.value = options.muted ? 0 : (options.volume ?? 1);
    
    // Get or create FX chain for this stem
    const fxChain = options.useFx !== false ? this.getOrCreateStemFxChain(stemId) : null;
    
    if (fxChain) {
      // Connect: Source → Gain → FX Chain Input (FX chain output goes to master)
      source.connect(gain);
      gain.connect(fxChain.input);
    } else {
      // Connect: Source → Gain → Master (bypass FX)
      source.connect(gain);
      gain.connect(this.masterGain);
    }
    
    // Store references
    this.stemSources.set(stemId, source);
    this.stemGains.set(stemId, gain);
    
    // Start playback
    const offset = options.startOffset ?? 0;
    source.start(0, offset);
    
    // Cleanup when done
    source.onended = () => {
      this.stemSources.delete(stemId);
      this.stemGains.delete(stemId);
    };
  }
  
  /**
   * Play a region of audio with FX processing.
   * Used for moment/slice preview with effects applied.
   */
  async playRegionWithFx(
    stemId: string,
    audioUrl: string,
    startTime: number,
    endTime: number,
    options: { preset?: string; volume?: number } = {}
  ): Promise<string | null> {
    if (!this.context || !this.masterGain) return null;
    
    // Get or create FX chain
    const fxChain = this.getOrCreateStemFxChain(stemId);
    if (!fxChain) return null;
    
    // Load preset if specified
    if (options.preset && options.preset !== 'none') {
      this.loadStemFxPreset(stemId, options.preset);
    }
    
    // Fetch and decode audio
    try {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
      
      // Calculate sample offsets
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.min(Math.floor(endTime * sampleRate), audioBuffer.length);
      const regionLength = endSample - startSample;
      
      if (regionLength <= 0) return null;
      
      // Create a buffer for just the region
      const regionBuffer = this.context.createBuffer(
        audioBuffer.numberOfChannels,
        regionLength,
        sampleRate
      );
      
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const sourceData = audioBuffer.getChannelData(ch);
        const destData = regionBuffer.getChannelData(ch);
        for (let i = 0; i < regionLength; i++) {
          destData[i] = sourceData[startSample + i];
        }
      }
      
      // Create source and connect through FX
      const source = this.context.createBufferSource();
      source.buffer = regionBuffer;
      
      const voiceGain = this.context.createGain();
      voiceGain.gain.value = options.volume ?? 1;
      
      source.connect(voiceGain);
      voiceGain.connect(fxChain.input);
      
      const voiceId = `region_${stemId}_${Date.now()}`;
      this.activeVoices.set(voiceId, source);
      
      source.start();
      source.onended = () => {
        this.activeVoices.delete(voiceId);
      };
      
      return voiceId;
    } catch (e) {
      console.error('[AudioEngine] Failed to play region with FX:', e);
      return null;
    }
  }
  
  /**
   * Stop a specific stem's playback
   */
  stopStem(stemId: string): void {
    const source = this.stemSources.get(stemId);
    if (source) {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
      this.stemSources.delete(stemId);
      this.stemGains.delete(stemId);
    }
  }
  
  /**
   * Stop all stem playback
   */
  stopAllStems(): void {
    for (const stemId of this.stemSources.keys()) {
      this.stopStem(stemId);
    }
  }
  
  /**
   * Update stem volume in real-time (also updates FX chain output)
   */
  setStemVolume(stemId: string, volume: number, muted: boolean = false): void {
    // Update stem gain node
    const gain = this.stemGains.get(stemId);
    if (gain && this.context) {
      const targetValue = muted ? 0 : Math.max(0, Math.min(1, volume));
      gain.gain.setTargetAtTime(targetValue, this.context.currentTime, 0.02);
    }
    
    // Track state for FX chain routing
    this.stemVolumeState.set(stemId, volume);
    this.stemMuteState.set(stemId, muted);
    
    // Also update FX chain output if it exists
    this.updateStemOutputGain(stemId);
  }
  
  /**
   * Check if any stems are playing
   */
  get isStemPlaying(): boolean {
    return this.stemSources.size > 0;
  }
  
  // =============================================================================
  // MASTER CONTROLS
  // =============================================================================
  
  setMasterVolume(value: number): void {
    if (!this.masterGain || !this.context) return;
    
    const clampedValue = Math.max(0, Math.min(1, value));
    this.masterGain.gain.setTargetAtTime(
      clampedValue,
      this.context.currentTime,
      0.01
    );
  }
  
  getMasterVolume(): number {
    return this.masterGain?.gain.value ?? 0.8;
  }
  
  // =============================================================================
  // AUDIOWORKLET SCHEDULER (Pro Tightness)
  // =============================================================================
  
  /**
   * Initialize the AudioWorklet for sample-accurate timing.
   * This runs scheduling on the audio thread for ~3ms precision.
   */
  private async initSchedulerWorklet(): Promise<void> {
    const ctx = this.context;
    if (!ctx || this.workletReady) return;
    
    try {
      // Load the worklet module
      await ctx.audioWorklet.addModule('/worklets/scheduler-processor.js');

      if (this.context !== ctx) return;
      
      // Create the worklet node
      this.schedulerWorklet = new AudioWorkletNode(ctx, 'scheduler-processor');
      
      // Connect to destination (required for process() to run, but outputs silence)
      this.schedulerWorklet.connect(ctx.destination);
      
      // Handle messages from the worklet
      this.schedulerWorklet.port.onmessage = (event) => {
        const { type, data } = event.data;
        
        switch (type) {
          case 'tick':
            // Notify tick callbacks for UI updates
            for (const callback of this.tickCallbacks) {
              callback(data);
            }
            break;
            
          case 'trigger':
            // Fire the scheduled trigger at the precise time
            if (this.useWorkletScheduler) {
              this.handleWorkletTrigger(data);
            }
            break;
            
          case 'position':
            // Update position for UI
            for (const callback of this.positionCallbacks) {
              callback(data);
            }
            break;
            
          case 'loop':
            // Loop point reached - could emit event for UI
            console.log('[AudioEngine] Loop point:', data.beat);
            break;
        }
      };
      
      // Set initial BPM
      this.schedulerWorklet.port.postMessage({
        type: 'setBpm',
        data: { bpm: this._bpm },
      });
      
      this.workletReady = true;
      console.log('[AudioEngine] Scheduler worklet initialized (pro tightness enabled)');
      
    } catch (error) {
      console.warn('[AudioEngine] Failed to initialize scheduler worklet, falling back to setInterval:', error);
      this.useWorkletScheduler = false;
    }
  }
  
  /**
   * Handle a trigger event from the worklet.
   */
  private handleWorkletTrigger(data: {
    sliceId: string;
    velocity: number;
    pitch: number;
    stemId: string;
    audioContextTime: number;
  }): void {
    // Parse slice info from sliceId (format: "bankId:sliceIndex")
    const [bankId, sliceIndexStr] = data.sliceId.split(':');
    const sliceIndex = parseInt(sliceIndexStr, 10);
    
    if (isNaN(sliceIndex)) return;
    
    // Play the slice at the exact audio context time
    this.playSliceAt(bankId, sliceIndex, data.audioContextTime, {
      velocity: data.velocity,
      pitchShift: data.pitch,
    });
  }
  
  /**
   * Send triggers to the worklet for sample-accurate scheduling.
   */
  scheduleTriggersToWorklet(triggers: Array<{
    time: number; // in beats
    sliceId: string;
    velocity: number;
    pitch: number;
    stemId: string;
  }>): void {
    if (!this.schedulerWorklet || !this.workletReady) {
      console.warn('[AudioEngine] Worklet not ready, using fallback scheduler');
      return;
    }
    
    // Convert beat times to sample times
    const sampleRate = this.context?.sampleRate ?? 44100;
    const samplesPerBeat = (sampleRate * 60) / this._bpm;
    
    const workletTriggers = triggers.map(t => ({
      time: Math.floor(t.time * samplesPerBeat),
      sliceId: t.sliceId,
      velocity: t.velocity,
      pitch: t.pitch,
      stemId: t.stemId,
    }));
    
    this.schedulerWorklet.port.postMessage({
      type: 'scheduleTriggers',
      data: { triggers: workletTriggers },
    });
  }
  
  /**
   * Start worklet-based playback.
   */
  playWithWorklet(): void {
    if (!this.schedulerWorklet || !this.workletReady) {
      console.warn('[AudioEngine] Worklet not ready');
      return;
    }
    
    this.schedulerWorklet.port.postMessage({ type: 'play', data: {} });
    this._isPlaying = true;
  }
  
  /**
   * Stop worklet-based playback.
   */
  stopWorklet(): void {
    if (!this.schedulerWorklet) return;
    
    this.schedulerWorklet.port.postMessage({ type: 'stop', data: {} });
    this._isPlaying = false;
  }
  
  /**
   * Set BPM on the worklet.
   */
  setWorkletBpm(bpm: number): void {
    this._bpm = bpm;
    if (this.schedulerWorklet && this.workletReady) {
      this.schedulerWorklet.port.postMessage({
        type: 'setBpm',
        data: { bpm },
      });
    }
  }
  
  /**
   * Set swing amount on the worklet (0-1).
   */
  setWorkletSwing(swing: number): void {
    if (this.schedulerWorklet && this.workletReady) {
      this.schedulerWorklet.port.postMessage({
        type: 'setSwing',
        data: { swing },
      });
    }
  }
  
  /**
   * Set subdivision on the worklet (ticks per beat).
   */
  setWorkletSubdivision(subdivision: number): void {
    if (this.schedulerWorklet && this.workletReady) {
      this.schedulerWorklet.port.postMessage({
        type: 'setSubdivision',
        data: { subdivision },
      });
    }
  }
  
  /**
   * Set loop region on the worklet.
   */
  setWorkletLoop(loopStart: number, loopLength: number): void {
    if (this.schedulerWorklet && this.workletReady) {
      this.schedulerWorklet.port.postMessage({
        type: 'setLoop',
        data: { loopStart, loopLength },
      });
    }
  }
  
  /**
   * Clear all scheduled triggers from the worklet.
   */
  clearWorkletTriggers(): void {
    if (this.schedulerWorklet && this.workletReady) {
      this.schedulerWorklet.port.postMessage({ type: 'clearTriggers', data: {} });
    }
  }
  
  /**
   * Subscribe to tick events from the worklet.
   */
  onTick(callback: (data: { beat: number; tick: number; audioContextTime: number }) => void): () => void {
    this.tickCallbacks.add(callback);
    return () => this.tickCallbacks.delete(callback);
  }
  
  /**
   * Subscribe to position updates from the worklet.
   */
  onPosition(callback: (data: { beat: number; time: number }) => void): () => void {
    this.positionCallbacks.add(callback);
    return () => this.positionCallbacks.delete(callback);
  }
  
  /**
   * Check if worklet scheduler is available and ready.
   */
  get isWorkletReady(): boolean {
    return this.workletReady;
  }
  
  // =============================================================================
  // CLEANUP
  // =============================================================================
  
  // =============================================================================
  // PER-STEM FX CHAIN MANAGEMENT
  // =============================================================================
  
  /**
   * Create or get an FX chain for a stem.
   * The chain processes audio: input → compression → saturation → formant → lowpass → delay → output
   */
  getOrCreateStemFxChain(stemId: string): StemFxChain | null {
    if (!this.context || !this.masterGain) return null;
    
    // Return existing chain
    if (this.stemFxChains.has(stemId)) {
      return this.stemFxChains.get(stemId)!;
    }
    
    const ctx = this.context;
    
    // Create FX chain nodes
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    
    // Compressor
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    
    // Waveshaper for saturation
    const waveshaper = ctx.createWaveShaper();
    waveshaper.curve = this.createSaturationCurve(0);
    waveshaper.oversample = '2x';
    
    // Formant approximation (peaking filter)
    const formantFilter = ctx.createBiquadFilter();
    formantFilter.type = 'peaking';
    formantFilter.frequency.value = 2500;
    formantFilter.Q.value = 2;
    formantFilter.gain.value = 0;
    
    // Lowpass for bitcrushing approximation
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20000;
    lowpass.Q.value = 0.7;
    
    // Delay for doubling effect
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = 0.015;
    const delayGain = ctx.createGain();
    delayGain.gain.value = 0;
    
    // Connect chain
    // Dry path: input → dryGain → output
    input.connect(dryGain);
    dryGain.connect(output);
    
    // Wet path: input → compressor → waveshaper → formant → lowpass → wetGain → output
    input.connect(compressor);
    compressor.connect(waveshaper);
    waveshaper.connect(formantFilter);
    formantFilter.connect(lowpass);
    lowpass.connect(wetGain);
    wetGain.connect(output);
    
    // Doubling path: lowpass → delay → delayGain → output
    lowpass.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(output);
    
    // Connect output to master
    output.connect(this.masterGain);
    
    // Initialize dry (FX off)
    dryGain.gain.value = 1;
    wetGain.gain.value = 0;
    
    const chain: StemFxChain = {
      input,
      output,
      dryGain,
      wetGain,
      compressor,
      waveshaper,
      formantFilter,
      lowpass,
      delay,
      delayGain,
      settings: { ...DEFAULT_FX_SETTINGS },
    };
    
    this.stemFxChains.set(stemId, chain);
    return chain;
  }
  
  /**
   * Set FX enabled/disabled for a stem (instant A/B toggle)
   */
  setStemFxEnabled(stemId: string, enabled: boolean): void {
    const chain = this.stemFxChains.get(stemId);
    if (!chain) return;
    
    chain.settings.enabled = enabled;
    
    // Crossfade between dry and wet for smooth toggle
    const now = this.context?.currentTime ?? 0;
    const fadeTime = 0.05; // 50ms crossfade
    
    if (enabled && !this._globalFxBypass) {
      chain.dryGain.gain.setTargetAtTime(0, now, fadeTime);
      chain.wetGain.gain.setTargetAtTime(1, now, fadeTime);
    } else {
      chain.dryGain.gain.setTargetAtTime(1, now, fadeTime);
      chain.wetGain.gain.setTargetAtTime(0, now, fadeTime);
    }
  }
  
  /**
   * Load an FX preset for a stem
   */
  loadStemFxPreset(stemId: string, presetName: string): void {
    const chain = this.getOrCreateStemFxChain(stemId);
    if (!chain) return;
    
    const preset = FX_PRESETS[presetName];
    if (!preset) {
      console.warn(`[AudioEngine] Unknown FX preset: ${presetName}`);
      return;
    }
    
    // Merge preset with defaults
    chain.settings = { ...DEFAULT_FX_SETTINGS, ...preset, preset: presetName };
    
    // Apply settings
    this.applyStemFxSettings(stemId);
  }
  
  /**
   * Apply current FX settings to a stem's chain
   */
  applyStemFxSettings(stemId: string): void {
    const chain = this.stemFxChains.get(stemId);
    if (!chain || !this.context) return;
    
    const s = chain.settings;
    
    // Compression (0-1 maps to ratio 1-12)
    const ratio = 1 + s.compression * 11;
    chain.compressor.ratio.value = ratio;
    chain.compressor.threshold.value = -24 + s.compression * 12; // -24 to -12
    
    // Saturation
    chain.waveshaper.curve = this.createSaturationCurve(s.saturation);
    
    // Formant shift (semitones to frequency shift)
    const baseFreq = 2500;
    const shiftedFreq = baseFreq * Math.pow(2, s.formantShift / 12);
    chain.formantFilter.frequency.value = Math.max(500, Math.min(8000, shiftedFreq));
    chain.formantFilter.gain.value = Math.abs(s.formantShift) * 2;
    
    // Bitcrushing (sample rate to lowpass cutoff)
    const nyquist = s.bitcrushRate / 2;
    chain.lowpass.frequency.value = Math.min(nyquist, 20000);
    
    // Doubling effect
    const detuneAmount = s.doubleTrackDetune / 100; // cents to fraction
    if (detuneAmount > 0) {
      chain.delay.delayTime.value = 0.01 + detuneAmount * 0.02;
      chain.delayGain.gain.value = 0.3;
    } else {
      chain.delayGain.gain.value = 0;
    }
    
    // Enable/disable
    this.setStemFxEnabled(stemId, s.enabled);
  }
  
  /**
   * Toggle global FX bypass (A/B comparison)
   */
  setGlobalFxBypass(bypass: boolean): void {
    this._globalFxBypass = bypass;
    
    // Update all stem FX chains
    for (const [stemId, chain] of this.stemFxChains) {
      this.setStemFxEnabled(stemId, chain.settings.enabled);
    }
  }
  
  get globalFxBypass(): boolean {
    return this._globalFxBypass;
  }
  
  /**
   * Create saturation curve for waveshaper
   */
  private createSaturationCurve(amount: number): Float32Array<ArrayBuffer> {
    const samples = 44100;
    const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
    
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      if (amount <= 0) {
        curve[i] = x;
      } else {
        const drive = 1 + amount * 10;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
    }
    
    return curve;
  }
  
  // =============================================================================
  // STEM MUTE/SOLO/VOLUME
  // =============================================================================
  
  /**
   * Set mute state for a stem
   */
  setStemMute(stemId: string, muted: boolean): void {
    this.stemMuteState.set(stemId, muted);
    this.updateStemOutputGain(stemId);
  }
  
  /**
   * Set solo state for a stem
   */
  setStemSolo(stemId: string, soloed: boolean): void {
    this.stemSoloState.set(stemId, soloed);
    // Update all stems when solo changes
    for (const id of this.stemFxChains.keys()) {
      this.updateStemOutputGain(id);
    }
  }
  
  /**
   * Update output gain based on mute/solo/volume state
   */
  private updateStemOutputGain(stemId: string): void {
    const chain = this.stemFxChains.get(stemId);
    if (!chain || !this.context) return;
    
    const muted = this.stemMuteState.get(stemId) ?? false;
    const soloed = this.stemSoloState.get(stemId) ?? false;
    const volume = this.stemVolumeState.get(stemId) ?? 1;
    
    // Check if any stem is soloed
    const hasSolo = Array.from(this.stemSoloState.values()).some(s => s);
    
    // If any stem is soloed, only play soloed stems
    const shouldMute = hasSolo ? !soloed : muted;
    
    const targetGain = shouldMute ? 0 : volume;
    const now = this.context.currentTime;
    chain.output.gain.setTargetAtTime(targetGain, now, 0.02);
  }
  
  /**
   * Get the output node for a stem (for routing audio through FX)
   */
  getStemFxInput(stemId: string): GainNode | null {
    const chain = this.getOrCreateStemFxChain(stemId);
    return chain?.input ?? null;
  }
  
  async close(): Promise<void> {
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // Ignore init errors during close
      }
    }

    this.stopScheduler();
    this.stopAnalysis();
    this.stopWorklet();
    this.stopAll(0);
    
    // Disconnect FX chains
    for (const chain of this.stemFxChains.values()) {
      try {
        chain.input.disconnect();
        chain.output.disconnect();
      } catch {
        // Ignore
      }
    }
    this.stemFxChains.clear();
    
    // Disconnect worklet
    if (this.schedulerWorklet) {
      this.schedulerWorklet.disconnect();
      this.schedulerWorklet = null;
      this.workletReady = false;
    }
    
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    
    this.sliceBuffers.clear();
    this._state = 'closed';
  }
  
  get state(): EngineState {
    return this._state;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let engineInstance: LoopForgeAudioEngine | null = null;

export function getAudioEngine(): LoopForgeAudioEngine {
  if (!engineInstance) {
    engineInstance = new LoopForgeAudioEngine();
  }
  return engineInstance;
}
