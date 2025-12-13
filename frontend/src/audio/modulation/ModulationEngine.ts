/**
 * ModulationEngine - Real-time parameter modulation
 * 
 * Provides:
 * - LFOs (sine, triangle, square, saw, random, noise)
 * - Envelopes (ADSR, AR, custom)
 * - Step sequences
 * - Random/probability generators
 * - Modulation matrix routing
 * 
 * This is how Max/MSP and modular synths create evolving, generative patterns.
 */

export type WaveShape = 'sine' | 'triangle' | 'square' | 'saw' | 'rampDown' | 'random' | 'noise' | 'sampleHold';

export interface LFOConfig {
  id: string;
  shape: WaveShape;
  frequency: number;      // Hz
  phase: number;          // 0-1
  amplitude: number;      // 0-1
  offset: number;         // -1 to 1
  sync: boolean;          // Sync to transport
  syncDivision: number;   // If synced: 1 = 1 bar, 2 = half note, 4 = quarter, etc.
  bipolar: boolean;       // -1 to 1 or 0 to 1
  smoothing: number;      // 0-1, smoothing between steps (for S&H and step seq)
}

export interface EnvelopeConfig {
  id: string;
  attack: number;         // seconds
  decay: number;          // seconds
  sustain: number;        // 0-1
  release: number;        // seconds
  curve: 'linear' | 'exponential' | 'logarithmic';
}

export interface StepSequenceConfig {
  id: string;
  steps: number[];        // Values 0-1
  stepCount: number;
  currentStep: number;
  smoothing: number;      // Glide between steps
  direction: 'forward' | 'backward' | 'pingpong' | 'random';
}

export interface ModulationRoute {
  sourceId: string;
  sourceType: 'lfo' | 'envelope' | 'stepSeq' | 'random';
  targetId: string;       // 'filter.cutoff', 'pan', 'pitch', etc.
  amount: number;         // -1 to 1
  enabled: boolean;
}

export interface ModulationState {
  lfos: Map<string, LFOState>;
  envelopes: Map<string, EnvelopeState>;
  stepSequences: Map<string, StepSequenceState>;
}

interface LFOState {
  config: LFOConfig;
  phase: number;
  lastValue: number;
  sampleHoldValue: number;
  lastSampleTime: number;
}

interface EnvelopeState {
  config: EnvelopeConfig;
  stage: 'idle' | 'attack' | 'decay' | 'sustain' | 'release';
  value: number;
  startTime: number;
  releaseStartTime: number;
  releaseStartValue: number;
}

interface StepSequenceState {
  config: StepSequenceConfig;
  currentStep: number;
  lastValue: number;
  direction: 1 | -1;
}

export class ModulationEngine {
  private lfos = new Map<string, LFOState>();
  private envelopes = new Map<string, EnvelopeState>();
  private stepSequences = new Map<string, StepSequenceState>();
  private routes: ModulationRoute[] = [];
  private time = 0;
  private bpm = 120;
  private isPlaying = false;
  
  // ==========================================================================
  // LFO
  // ==========================================================================
  
  createLFO(config: LFOConfig): void {
    this.lfos.set(config.id, {
      config,
      phase: config.phase,
      lastValue: 0,
      sampleHoldValue: Math.random(),
      lastSampleTime: 0,
    });
  }
  
  updateLFO(id: string, updates: Partial<LFOConfig>): void {
    const state = this.lfos.get(id);
    if (state) {
      Object.assign(state.config, updates);
    }
  }
  
  removeLFO(id: string): void {
    this.lfos.delete(id);
    this.routes = this.routes.filter(r => r.sourceId !== id);
  }
  
  private computeLFO(state: LFOState, deltaTime: number): number {
    const { config } = state;
    
    // Compute phase advance
    let phaseIncrement: number;
    if (config.sync && this.isPlaying) {
      // Sync to transport
      const beatsPerCycle = config.syncDivision;
      const secondsPerCycle = (beatsPerCycle * 60) / this.bpm;
      phaseIncrement = deltaTime / secondsPerCycle;
    } else {
      phaseIncrement = config.frequency * deltaTime;
    }
    
    state.phase = (state.phase + phaseIncrement) % 1;
    const phase = state.phase;
    
    // Compute raw value based on shape
    let value: number;
    switch (config.shape) {
      case 'sine':
        value = Math.sin(phase * Math.PI * 2);
        break;
      case 'triangle':
        value = phase < 0.5 
          ? 4 * phase - 1 
          : 3 - 4 * phase;
        break;
      case 'square':
        value = phase < 0.5 ? 1 : -1;
        break;
      case 'saw':
        value = 2 * phase - 1;
        break;
      case 'rampDown':
        value = 1 - 2 * phase;
        break;
      case 'random':
        // New random value each cycle
        if (phase < state.phase - 0.5) {
          state.sampleHoldValue = Math.random() * 2 - 1;
        }
        value = state.sampleHoldValue;
        break;
      case 'noise':
        value = Math.random() * 2 - 1;
        break;
      case 'sampleHold':
        // Change value at rate determined by frequency
        const sampleInterval = 1 / config.frequency;
        if (this.time - state.lastSampleTime >= sampleInterval) {
          state.sampleHoldValue = Math.random() * 2 - 1;
          state.lastSampleTime = this.time;
        }
        value = state.sampleHoldValue;
        break;
      default:
        value = 0;
    }
    
    // Apply smoothing
    if (config.smoothing > 0) {
      const smoothFactor = Math.pow(config.smoothing, deltaTime * 60);
      value = state.lastValue * smoothFactor + value * (1 - smoothFactor);
    }
    state.lastValue = value;
    
    // Apply amplitude and offset
    value = value * config.amplitude + config.offset;
    
    // Convert to unipolar if needed
    if (!config.bipolar) {
      value = (value + 1) / 2;
    }
    
    return Math.max(-1, Math.min(1, value));
  }
  
  // ==========================================================================
  // ENVELOPE
  // ==========================================================================
  
  createEnvelope(config: EnvelopeConfig): void {
    this.envelopes.set(config.id, {
      config,
      stage: 'idle',
      value: 0,
      startTime: 0,
      releaseStartTime: 0,
      releaseStartValue: 0,
    });
  }
  
  triggerEnvelope(id: string): void {
    const state = this.envelopes.get(id);
    if (state) {
      state.stage = 'attack';
      state.startTime = this.time;
    }
  }
  
  releaseEnvelope(id: string): void {
    const state = this.envelopes.get(id);
    if (state && state.stage !== 'idle' && state.stage !== 'release') {
      state.stage = 'release';
      state.releaseStartTime = this.time;
      state.releaseStartValue = state.value;
    }
  }
  
  private computeEnvelope(state: EnvelopeState): number {
    const { config } = state;
    const elapsed = this.time - state.startTime;
    
    switch (state.stage) {
      case 'idle':
        return 0;
        
      case 'attack':
        if (elapsed < config.attack) {
          state.value = this.applyEnvelopeCurve(elapsed / config.attack, config.curve);
          return state.value;
        }
        state.stage = 'decay';
        state.startTime = this.time;
        return this.computeEnvelope(state);
        
      case 'decay':
        const decayElapsed = this.time - state.startTime;
        if (decayElapsed < config.decay) {
          const progress = this.applyEnvelopeCurve(decayElapsed / config.decay, config.curve);
          state.value = 1 - (1 - config.sustain) * progress;
          return state.value;
        }
        state.stage = 'sustain';
        state.value = config.sustain;
        return state.value;
        
      case 'sustain':
        return config.sustain;
        
      case 'release':
        const releaseElapsed = this.time - state.releaseStartTime;
        if (releaseElapsed < config.release) {
          const progress = this.applyEnvelopeCurve(releaseElapsed / config.release, config.curve);
          state.value = state.releaseStartValue * (1 - progress);
          return state.value;
        }
        state.stage = 'idle';
        state.value = 0;
        return 0;
    }
  }
  
  private applyEnvelopeCurve(t: number, curve: EnvelopeConfig['curve']): number {
    switch (curve) {
      case 'linear':
        return t;
      case 'exponential':
        return t * t;
      case 'logarithmic':
        return Math.sqrt(t);
      default:
        return t;
    }
  }
  
  // ==========================================================================
  // STEP SEQUENCE
  // ==========================================================================
  
  createStepSequence(config: StepSequenceConfig): void {
    this.stepSequences.set(config.id, {
      config,
      currentStep: 0,
      lastValue: config.steps[0] || 0,
      direction: 1,
    });
  }
  
  advanceStep(id: string): void {
    const state = this.stepSequences.get(id);
    if (!state) return;
    
    const { config } = state;
    
    switch (config.direction) {
      case 'forward':
        state.currentStep = (state.currentStep + 1) % config.stepCount;
        break;
      case 'backward':
        state.currentStep = (state.currentStep - 1 + config.stepCount) % config.stepCount;
        break;
      case 'pingpong':
        state.currentStep += state.direction;
        if (state.currentStep >= config.stepCount - 1) {
          state.direction = -1;
        } else if (state.currentStep <= 0) {
          state.direction = 1;
        }
        break;
      case 'random':
        state.currentStep = Math.floor(Math.random() * config.stepCount);
        break;
    }
  }
  
  private computeStepSequence(state: StepSequenceState): number {
    const { config } = state;
    const targetValue = config.steps[state.currentStep] || 0;
    
    // Apply smoothing/glide
    if (config.smoothing > 0) {
      const glideSpeed = 1 - config.smoothing;
      state.lastValue += (targetValue - state.lastValue) * glideSpeed;
      return state.lastValue;
    }
    
    state.lastValue = targetValue;
    return targetValue;
  }
  
  // ==========================================================================
  // ROUTING
  // ==========================================================================
  
  addRoute(route: ModulationRoute): void {
    this.routes.push(route);
  }
  
  removeRoute(sourceId: string, targetId: string): void {
    this.routes = this.routes.filter(
      r => !(r.sourceId === sourceId && r.targetId === targetId)
    );
  }
  
  setRouteAmount(sourceId: string, targetId: string, amount: number): void {
    const route = this.routes.find(
      r => r.sourceId === sourceId && r.targetId === targetId
    );
    if (route) {
      route.amount = amount;
    }
  }
  
  // ==========================================================================
  // COMPUTE
  // ==========================================================================
  
  /**
   * Update all modulators and return current values for all routes
   */
  tick(deltaTime: number, beat?: number): Map<string, number> {
    this.time += deltaTime;
    void beat;
    
    // Compute all modulator values
    const modulatorValues = new Map<string, number>();
    
    for (const [id, state] of this.lfos) {
      modulatorValues.set(id, this.computeLFO(state, deltaTime));
    }
    
    for (const [id, state] of this.envelopes) {
      modulatorValues.set(id, this.computeEnvelope(state));
    }
    
    for (const [id, state] of this.stepSequences) {
      modulatorValues.set(id, this.computeStepSequence(state));
    }
    
    // Compute routed values
    const routedValues = new Map<string, number>();
    
    for (const route of this.routes) {
      if (!route.enabled) continue;
      
      const sourceValue = modulatorValues.get(route.sourceId) || 0;
      const modulatedValue = sourceValue * route.amount;
      
      // Sum multiple sources to same target
      const existing = routedValues.get(route.targetId) || 0;
      routedValues.set(route.targetId, existing + modulatedValue);
    }
    
    return routedValues;
  }
  
  setTransport(bpm: number, playing: boolean): void {
    this.bpm = bpm;
    this.isPlaying = playing;
  }
  
  // ==========================================================================
  // PRESETS
  // ==========================================================================
  
  static createSlowDrift(): LFOConfig {
    return {
      id: 'drift_' + Date.now(),
      shape: 'sine',
      frequency: 0.1,
      phase: Math.random(),
      amplitude: 0.3,
      offset: 0,
      sync: false,
      syncDivision: 4,
      bipolar: true,
      smoothing: 0.8,
    };
  }
  
  static createRhythmicPulse(division: number = 4): LFOConfig {
    return {
      id: 'pulse_' + Date.now(),
      shape: 'square',
      frequency: 2,
      phase: 0,
      amplitude: 1,
      offset: 0,
      sync: true,
      syncDivision: division,
      bipolar: false,
      smoothing: 0,
    };
  }
  
  static createChaos(): LFOConfig {
    return {
      id: 'chaos_' + Date.now(),
      shape: 'noise',
      frequency: 8,
      phase: 0,
      amplitude: 0.5,
      offset: 0,
      sync: false,
      syncDivision: 1,
      bipolar: true,
      smoothing: 0.3,
    };
  }
}

// Singleton instance
let modulationEngineInstance: ModulationEngine | null = null;

export function getModulationEngine(): ModulationEngine {
  if (!modulationEngineInstance) {
    modulationEngineInstance = new ModulationEngine();
  }
  return modulationEngineInstance;
}
