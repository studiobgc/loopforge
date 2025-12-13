/**
 * SchedulerProcessor - AudioWorklet for sample-accurate timing
 * 
 * Runs on the audio thread with ~3ms buffer accuracy.
 * Handles tick generation and trigger scheduling without main thread involvement.
 * 
 * This is how professional DAWs achieve timing precision.
 */

class SchedulerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    this.state = {
      bpm: 120,
      playing: false,
      position: 0,
      samplesPerBeat: 22050,
      nextTickSample: 0,
      subdivision: 4,
      swing: 0,
      triggers: [],
      loopLength: 0, // 0 = no loop
      loopStart: 0,
    };
    
    this.tickCount = 0;
    this.port.onmessage = this.handleMessage.bind(this);
    this.updateTiming();
  }
  
  handleMessage(event) {
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
        
      case 'setLoop':
        this.state.loopLength = data.loopLength || 0;
        this.state.loopStart = data.loopStart || 0;
        break;
        
      case 'scheduleTrigger':
        this.state.triggers.push(data.trigger);
        this.state.triggers.sort((a, b) => a.time - b.time);
        break;
        
      case 'scheduleTriggers':
        // Batch schedule for efficiency
        this.state.triggers.push(...data.triggers);
        this.state.triggers.sort((a, b) => a.time - b.time);
        break;
        
      case 'clearTriggers':
        this.state.triggers = [];
        break;
    }
  }
  
  updateTiming() {
    this.state.samplesPerBeat = (sampleRate * 60) / this.state.bpm;
  }
  
  getSwingOffset(tickIndex) {
    if (tickIndex % 2 === 1 && this.state.swing > 0) {
      const samplesPerTick = this.state.samplesPerBeat / this.state.subdivision;
      return samplesPerTick * this.state.swing * 0.5;
    }
    return 0;
  }
  
  process(inputs, outputs, parameters) {
    if (!this.state.playing) {
      return true;
    }
    
    const blockSize = outputs[0]?.[0]?.length || 128;
    const blockEndSample = this.state.position + blockSize;
    
    // Check for ticks within this block
    while (this.state.nextTickSample < blockEndSample) {
      const swingOffset = this.getSwingOffset(this.tickCount);
      const actualTickSample = this.state.nextTickSample + swingOffset;
      
      const beat = this.tickCount / this.state.subdivision;
      
      this.port.postMessage({
        type: 'tick',
        data: {
          beat,
          tick: this.tickCount,
          time: actualTickSample / sampleRate,
          audioContextTime: currentTime + (actualTickSample - this.state.position) / sampleRate,
        },
      });
      
      this.tickCount++;
      this.state.nextTickSample = Math.floor(
        (this.tickCount / this.state.subdivision) * this.state.samplesPerBeat
      );
    }
    
    // Check for scheduled triggers within this block
    while (this.state.triggers.length > 0 && this.state.triggers[0].time < blockEndSample) {
      const trigger = this.state.triggers.shift();
      
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
    
    // Handle looping
    if (this.state.loopLength > 0) {
      const loopEndSample = (this.state.loopStart + this.state.loopLength) * this.state.samplesPerBeat;
      if (this.state.position >= loopEndSample) {
        const loopStartSample = this.state.loopStart * this.state.samplesPerBeat;
        this.state.position = loopStartSample;
        this.tickCount = Math.floor(this.state.loopStart * this.state.subdivision);
        this.state.nextTickSample = this.state.position;
        
        this.port.postMessage({
          type: 'loop',
          data: { beat: this.state.loopStart },
        });
      }
    }
    
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
