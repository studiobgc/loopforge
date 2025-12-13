/**
 * SchedulerProcessor - AudioWorklet for sample-accurate timing
 * 
 * Runs on the audio thread with ~3ms buffer accuracy.
 * Handles tick generation and trigger scheduling without main thread involvement.
 * 
 * This is how professional DAWs achieve timing precision.
 */

// This file needs to be loaded as a separate module by the AudioWorklet
// Build output should be in /public/worklets/scheduler-processor.js

interface ScheduledTrigger {
  time: number;      // When to fire (in samples)
  sliceId: string;
  velocity: number;
  pitch: number;
  stemId: string;
}

interface SchedulerState {
  bpm: number;
  playing: boolean;
  position: number;           // Current position in samples
  samplesPerBeat: number;
  nextTickSample: number;     // When next tick should fire
  subdivision: number;        // Ticks per beat (4 = 16th notes)
  swing: number;              // 0-1, amount of swing
  triggers: ScheduledTrigger[];
}

class SchedulerProcessor extends AudioWorkletProcessor {
  private state: SchedulerState = {
    bpm: 120,
    playing: false,
    position: 0,
    samplesPerBeat: 22050, // 44100 / 2
    nextTickSample: 0,
    subdivision: 4,
    swing: 0,
    triggers: [],
  };
  
  private tickCount = 0;
  
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    this.updateTiming();
  }
  
  private handleMessage(event: MessageEvent) {
    const { type, data } = event.data;
    
    switch (type) {
      case 'setBpm':
        this.state.bpm = data.bpm;
        this.updateTiming();
        break;
        
      case 'play':
        this.state.playing = true;
        this.state.position = 0;
        this.state.nextTickSample = 0;
        this.tickCount = 0;
        break;
        
      case 'stop':
        this.state.playing = false;
        this.state.triggers = [];
        break;
        
      case 'seek':
        this.state.position = Math.floor(data.beat * this.state.samplesPerBeat);
        this.tickCount = Math.floor(data.beat * this.state.subdivision);
        this.state.nextTickSample = this.state.position;
        break;
        
      case 'setSubdivision':
        this.state.subdivision = data.subdivision;
        break;
        
      case 'setSwing':
        this.state.swing = Math.max(0, Math.min(1, data.swing));
        break;
        
      case 'scheduleTrigger':
        this.state.triggers.push(data.trigger);
        // Keep sorted by time
        this.state.triggers.sort((a, b) => a.time - b.time);
        break;
        
      case 'clearTriggers':
        this.state.triggers = [];
        break;
    }
  }
  
  private updateTiming() {
    // samples per beat = (sample rate * 60) / bpm
    this.state.samplesPerBeat = (sampleRate * 60) / this.state.bpm;
  }
  
  private getSwingOffset(tickIndex: number): number {
    // Apply swing to off-beats (odd ticks)
    if (tickIndex % 2 === 1 && this.state.swing > 0) {
      const samplesPerTick = this.state.samplesPerBeat / this.state.subdivision;
      return samplesPerTick * this.state.swing * 0.5;
    }
    return 0;
  }
  
  process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    if (!this.state.playing) {
      return true;
    }
    
    const blockSize = outputs[0]?.[0]?.length || 128;
    const blockEndSample = this.state.position + blockSize;
    
    // Check for ticks within this block
    while (this.state.nextTickSample < blockEndSample) {
      const swingOffset = this.getSwingOffset(this.tickCount);
      const actualTickSample = this.state.nextTickSample + swingOffset;
      
      // Calculate beat position
      const beat = this.tickCount / this.state.subdivision;
      
      // Send tick to main thread
      this.port.postMessage({
        type: 'tick',
        data: {
          beat,
          tick: this.tickCount,
          time: actualTickSample / sampleRate,
          audioContextTime: currentTime + (actualTickSample - this.state.position) / sampleRate,
        },
      });
      
      // Advance to next tick
      this.tickCount++;
      this.state.nextTickSample = Math.floor(
        (this.tickCount / this.state.subdivision) * this.state.samplesPerBeat
      );
    }
    
    // Check for scheduled triggers within this block
    while (this.state.triggers.length > 0 && this.state.triggers[0].time < blockEndSample) {
      const trigger = this.state.triggers.shift()!;
      
      this.port.postMessage({
        type: 'trigger',
        data: {
          ...trigger,
          audioContextTime: currentTime + (trigger.time - this.state.position) / sampleRate,
        },
      });
    }
    
    // Advance position
    this.state.position = blockEndSample;
    
    // Send position update every ~50ms
    if (this.state.position % Math.floor(sampleRate / 20) < blockSize) {
      this.port.postMessage({
        type: 'position',
        data: {
          beat: this.state.position / this.state.samplesPerBeat,
          time: this.state.position / sampleRate,
        },
      });
    }
    
    return true;
  }
}

registerProcessor('scheduler-processor', SchedulerProcessor);
