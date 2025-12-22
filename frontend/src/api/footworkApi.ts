/**
 * Footwork Production API Client
 * 
 * Handles all communication with the footwork backend endpoints.
 * Follows the same pattern as sliceApi.ts for consistency.
 */

import axios, { AxiosInstance } from 'axios';

const API_BASE = '/api/footwork';

// =============================================================================
// TYPES
// =============================================================================

export interface DrumSynthesisParams {
  drum_type: 'kick' | 'snare' | 'hat';
  freq_start?: number;
  freq_end?: number;
  decay?: number;
  saturation?: number;
  duration?: number;
}

export interface DrumSynthesisResponse {
  drum_type: string;
  audio_data: string; // base64-encoded WAV
  sample_rate: number;
  duration: number;
}

export interface PatternGenerationRequest {
  preset?: string;
  mode?: string;
  pattern_config?: {
    type: 'polyrhythmic' | 'juke' | 'offbeat' | 'micro_timing';
    layers?: Array<{
      hits: number;
      steps: number;
      subdivision: number;
      offset: number;
    }>;
    pattern_name?: string;
    loop_length?: number;
    base_subdivision?: number;
    offbeat_ratio?: number;
    swing_amount?: number;
    pattern?: boolean[];
    base_source?: any;
    offset_range?: [number, number];
    offset_pattern?: number[];
    randomize?: boolean;
  };
  duration_beats: number;
  bpm: number;
  num_slices: number;
}

export interface PatternGenerationResponse {
  preset: string;
  mode: string;
  duration_beats: number;
  bpm: number;
  num_events: number;
  events: Array<{
    time: number;
    slice_index: number;
    velocity: number;
    micro_offset?: number;
    envelope_sweep?: number;
    saturation_amount?: number;
    swing_amount?: number;
    [key: string]: any;
  }>;
}

export interface PatternSynthesisRequest {
  pattern: Array<{
    time: number;
    type: 'kick' | 'snare' | 'hat';
    params: {
      freq_start?: number;
      freq_end?: number;
      decay?: number;
      saturation?: number;
      duration?: number;
      filter_cutoff?: number;
      brightness?: number;
    };
  }>;
  bpm: number;
  duration_beats: number;
}

export interface PatternSynthesisResponse {
  audio_data: string; // base64-encoded WAV
  sample_rate: number;
  duration_beats: number;
  bpm: number;
  num_hits: number;
}

export interface PresetInfo {
  mode: string;
  trigger_source_type: string;
}

export interface PresetsResponse {
  presets: Record<string, PresetInfo>;
  count: number;
}

// =============================================================================
// API CLIENT
// =============================================================================

class FootworkApiClient {
  private http: AxiosInstance;

  constructor(baseURL: string = API_BASE) {
    this.http = axios.create({
      baseURL,
      timeout: 30000, // 30 seconds for synthesis
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Error interceptor
    this.http.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          // Server responded with error
          const message = error.response.data?.detail || error.response.data?.message || error.message;
          error.message = message;
        } else if (error.request) {
          error.message = 'No response from server - check if backend is running';
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Synthesize a TR-808 style drum hit
   */
  async synthesizeDrum(params: DrumSynthesisParams): Promise<DrumSynthesisResponse> {
    const response = await this.http.post<DrumSynthesisResponse>('/synthesize-drum', params);
    return response.data;
  }

  /**
   * Generate a footwork pattern sequence
   */
  async generatePattern(request: PatternGenerationRequest): Promise<PatternGenerationResponse> {
    const response = await this.http.post<PatternGenerationResponse>('/generate-pattern', request);
    return response.data;
  }

  /**
   * List all available footwork presets
   */
  async listPresets(): Promise<PresetsResponse> {
    const response = await this.http.get<PresetsResponse>('/presets');
    return response.data;
  }

  /**
   * Synthesize a complete drum pattern
   */
  async synthesizePattern(request: PatternSynthesisRequest): Promise<PatternSynthesisResponse> {
    const response = await this.http.post<PatternSynthesisResponse>('/synthesize-pattern', request);
    return response.data;
  }
}

// Export singleton instance
export const footworkApi = new FootworkApiClient();

