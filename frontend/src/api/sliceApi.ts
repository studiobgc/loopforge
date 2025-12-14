/**
 * Slice Sequencer API Client
 * 
 * Handles all communication with the slice/trigger backend endpoints.
 */

import axios from 'axios';

const API_BASE = '';

// =============================================================================
// TYPES
// =============================================================================

export interface Slice {
  index: number;
  start_sample: number;
  end_sample: number;
  start_time: number;
  end_time: number;
  duration: number;
  transient_strength: number;
  spectral_centroid: number;
  rms_energy: number;
  zero_crossing_rate: number;
  spectral_flatness: number;
  zero_crossing_start: number;
  zero_crossing_end: number;
  pitch_hz?: number;
  note_name?: string;
}

export interface SliceBank {
  id: string;
  source_path: string;
  source_filename: string;
  role: 'drums' | 'bass' | 'vocals' | 'other' | 'unknown';
  slices: Slice[];
  sample_rate: number;
  total_duration: number;
  total_samples: number;
  bpm?: number;
  key?: string;
  mean_energy: number;
  max_energy: number;
  energy_variance: number;
}

export interface TriggerEvent {
  time: number;
  slice_index: number;
  velocity: number;
  duration?: number;
  pitch_shift: number;
  reverse: boolean;
  pan: number;
  filter_cutoff?: number;
  triggered_by?: string;
  rule_modified: boolean;
}

export interface TriggerRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  probability: number;
  enabled: boolean;
}

export interface TriggerPreset {
  name: string;
  mode: string;
  description: string;
}

export interface RuleOption {
  pattern?: string;
  name?: string;
  description: string;
}

export type TriggerMode = 
  | 'sequential' 
  | 'random' 
  | 'probability' 
  | 'midi_map' 
  | 'pattern' 
  | 'follow' 
  | 'euclidean' 
  | 'chaos';

// =============================================================================
// API CLIENT
// =============================================================================

export const sliceApi = {
  /**
   * Create a slice bank from an audio file
   */
  async createSliceBank(
    sessionId: string,
    stemPath: string,
    role: string = 'unknown',
    bpm?: number,
    key?: string
  ): Promise<{
    slice_bank_id: string;
    num_slices: number;
    total_duration: number;
    role: string;
    slices: Array<{
      index: number;
      start_time: number;
      end_time: number;
      duration: number;
      energy: number;
      transient_strength: number;
      brightness: number;
    }>;
    statistics: {
      mean_energy: number;
      max_energy: number;
      energy_variance: number;
    };
  }> {
    const response = await axios.post(`${API_BASE}/api/slice/create-bank`, {
      session_id: sessionId,
      stem_path: stemPath,
      role,
      bpm,
      key,
    });
    return response.data;
  },

  /**
   * Get a slice bank by ID
   */
  async getSliceBank(sessionId: string, bankId: string): Promise<SliceBank> {
    const response = await axios.get(`${API_BASE}/api/slice/bank/${sessionId}/${bankId}`);
    return response.data;
  },

  /**
   * List all slice banks for a session
   */
  async listSliceBanks(sessionId: string): Promise<{
    banks: Array<{
      id: string;
      source_filename: string;
      role: string;
      num_slices: number;
      total_duration: number;
    }>;
  }> {
    const response = await axios.get(`${API_BASE}/api/slice/banks/${sessionId}`);
    return response.data;
  },

  /**
   * Generate a trigger sequence
   */
  async generateSequence(params: {
    sessionId: string;
    sliceBankId: string;
    durationBeats?: number;
    bpm?: number;
    mode?: TriggerMode;
    preset?: string;
    euclideanHits?: number;
    euclideanSteps?: number;
    euclideanRotation?: number;
    subdivision?: number;
    probabilities?: number[];
    followBankId?: string;
    followDelayBeats?: number;
  }): Promise<{
    slice_bank_id: string;
    duration_beats: number;
    bpm: number;
    mode: string;
    num_events: number;
    events: TriggerEvent[];
  }> {
    const response = await axios.post(`${API_BASE}/api/slice/generate-sequence`, {
      session_id: params.sessionId,
      slice_bank_id: params.sliceBankId,
      duration_beats: params.durationBeats ?? 16,
      bpm: params.bpm ?? 120,
      mode: params.mode ?? 'sequential',
      preset: params.preset,
      euclidean_hits: params.euclideanHits,
      euclidean_steps: params.euclideanSteps,
      euclidean_rotation: params.euclideanRotation,
      subdivision: params.subdivision,
      probabilities: params.probabilities,
      follow_bank_id: params.followBankId,
      follow_delay_beats: params.followDelayBeats,
    });
    return response.data;
  },

  /**
   * Get available trigger presets
   */
  async getPresets(): Promise<{ presets: TriggerPreset[] }> {
    const response = await axios.get(`${API_BASE}/api/slice/presets`);
    return response.data;
  },

  /**
   * Get available rule conditions and actions
   */
  async getRuleOptions(): Promise<{
    conditions: RuleOption[];
    actions: RuleOption[];
  }> {
    const response = await axios.get(`${API_BASE}/api/slice/rule-options`);
    return response.data;
  },

  /**
   * Create a new rule
   */
  async createRule(
    sessionId: string,
    sliceBankId: string,
    name: string,
    condition: string,
    action: string,
    probability: number = 1.0
  ): Promise<{ rule: TriggerRule; message: string }> {
    const response = await axios.post(`${API_BASE}/api/slice/add-rule`, {
      session_id: sessionId,
      slice_bank_id: sliceBankId,
      name,
      condition,
      action,
      probability,
    });
    return response.data;
  },

  /**
   * Export a single slice as audio file
   */
  getSliceExportUrl(sessionId: string, bankId: string, sliceIndex: number): string {
    return `${API_BASE}/api/slice/export-slice/${sessionId}/${bankId}/${sliceIndex}`;
  },

  /**
   * Get WebSocket URL for real-time sequencer
   */
  getWebSocketUrl(sessionId: string): string {
    const wsBase = API_BASE.replace('http', 'ws');
    return `${wsBase}/api/slice/ws/${sessionId}`;
  },
};

// =============================================================================
// WEBSOCKET MANAGER
// =============================================================================

export class SequencerWebSocket {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private onTrigger: (event: TriggerEvent, beat: number) => void;
  private onBeat: (beat: number) => void;
  private onStateChange: (isPlaying: boolean, beat: number) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(
    sessionId: string,
    callbacks: {
      onTrigger: (event: TriggerEvent, beat: number) => void;
      onBeat: (beat: number) => void;
      onStateChange: (isPlaying: boolean, beat: number) => void;
    }
  ) {
    this.sessionId = sessionId;
    this.onTrigger = callbacks.onTrigger;
    this.onBeat = callbacks.onBeat;
    this.onStateChange = callbacks.onStateChange;
  }

  connect(): void {
    const url = sliceApi.getWebSocketUrl(this.sessionId);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[SequencerWS] Connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'trigger':
          this.onTrigger(data.event, data.beat);
          break;
        case 'beat':
          this.onBeat(data.beat);
          break;
        case 'state':
          this.onStateChange(data.is_playing, data.beat);
          break;
        case 'loaded':
          console.log(`[SequencerWS] Loaded ${data.num_events} events`);
          break;
        case 'pong':
          // Keep-alive response
          break;
      }
    };

    this.ws.onclose = () => {
      console.log('[SequencerWS] Disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[SequencerWS] Error:', error);
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[SequencerWS] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    }
  }

  loadSequence(events: TriggerEvent[], bpm: number): void {
    this.send({ type: 'load_sequence', events, bpm });
  }

  play(): void {
    this.send({ type: 'play' });
  }

  stop(): void {
    this.send({ type: 'stop' });
  }

  seek(beat: number): void {
    this.send({ type: 'seek', beat });
  }

  setBpm(bpm: number): void {
    this.send({ type: 'set_bpm', bpm });
  }

  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent reconnection
    this.ws?.close();
  }
}

export default sliceApi;
