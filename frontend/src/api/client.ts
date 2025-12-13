/**
 * Loop Forge API Client v2
 * 
 * Clean, typed API client for the new backend architecture.
 */

import axios, { AxiosInstance } from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// =============================================================================
// TYPES
// =============================================================================

export interface Session {
  id: string;
  name: string | null;
  source_filename: string | null;
  bpm: number | null;
  key: string | null;
  duration_seconds: number | null;
  created_at: string;
  stems: Stem[];
  jobs: Job[];
}

export interface Capabilities {
  api_version: string;
  features: Record<string, boolean>;
  limits: {
    max_upload_mb: number;
  };
  formats: {
    audio: string[];
  };
}

export interface Stem {
  id: string;
  name: string;
  filename: string;
  path: string;
  // Per-stem analysis
  detected_key?: string;
  detected_bpm?: number;
  key_confidence?: number;
}

export interface Job {
  id: string;
  session_id: string;
  job_type: 'separation' | 'analysis' | 'stem_analysis' | 'slicing' | 'sequencing' | 'export' | 'moments' | 'peaks';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  output_paths: Record<string, any>;  // Can include moments data, peaks path, stem paths, etc.
  error_message: string | null;
}

export interface Moment {
  type: 'hit' | 'phrase' | 'texture' | 'change';
  start: number;
  end: number;
  confidence: number;
  energy: number;
  brightness: number;
  label: string;
}

export interface SliceBank {
  id: string;
  source_filename: string;
  role: string;
  num_slices: number;
  total_duration: number;
  slices: Slice[];
  statistics: {
    mean_energy: number;
    max_energy: number;
    energy_variance: number;
  };
}

export interface Slice {
  index: number;
  start_time: number;
  end_time: number;
  duration: number;
  rms_energy: number;
  transient_strength: number;
  spectral_centroid: number;
}

export interface TriggerEvent {
  time: number;
  slice_index: number;
  velocity: number;
  duration?: number;
  pitch_shift: number;
  reverse: boolean;
  pan: number;
  rule_modified: boolean;
}

export interface Sequence {
  sequence_id: string;
  slice_bank_id: string;
  duration_beats: number;
  bpm: number;
  mode: string;
  num_events: number;
  events: TriggerEvent[];
}

// =============================================================================
// API CLIENT
// =============================================================================

class LoopForgeClient {
  private http: AxiosInstance;

  constructor(baseURL: string = API_BASE) {
    this.http = axios.create({
      baseURL,
      timeout: 60000,
    });
  }

  // ===========================================================================
  // SESSIONS
  // ===========================================================================

  /**
   * Upload a file and start processing
   */
  async upload(
    file: File,
    options: { autoSeparate?: boolean; autoAnalyze?: boolean; previewDuration?: number } = {}
  ): Promise<{
    session_id: string;
    filename: string;
    source?: { asset_id: string | null; path: string; url: string; content_hash: string };
    jobs: { id: string; type: string; preview?: boolean }[];
  }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('auto_separate', String(options.autoSeparate ?? true));
    formData.append('auto_analyze', String(options.autoAnalyze ?? true));
    if (options.previewDuration && options.previewDuration > 0) {
      formData.append('preview_duration', String(options.previewDuration));
    }

    const response = await this.http.post('/api/sessions/upload', formData, {
      timeout: 600000,
    });
    return response.data;
  }

  /**
   * Backend-driven feature flags and limits
   */
  async getCapabilities(): Promise<Capabilities> {
    const response = await this.http.get('/api/capabilities');
    return response.data;
  }

  /**
   * Get session details
   */
  async getSession(sessionId: string): Promise<Session> {
    const response = await this.http.get(`/api/sessions/${sessionId}`);
    return response.data;
  }

  /**
   * List recent sessions
   */
  async listSessions(limit: number = 20): Promise<{ sessions: Session[] }> {
    const response = await this.http.get('/api/sessions', { params: { limit } });
    return response.data;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.http.delete(`/api/sessions/${sessionId}`);
  }

  // ===========================================================================
  // JOBS
  // ===========================================================================

  /**
   * Get job status
   */
  async getJob(jobId: string): Promise<Job> {
    const response = await this.http.get(`/api/jobs/${jobId}`);
    return response.data;
  }

  /**
   * List jobs for a session
   */
  async listJobs(sessionId: string): Promise<{ jobs: Job[] }> {
    const response = await this.http.get('/api/jobs', { params: { session_id: sessionId } });
    return response.data;
  }

  /**
   * Cancel a job (pending or running)
   */
  async cancelJob(jobId: string): Promise<{ cancelled: string }> {
    const response = await this.http.post(`/api/jobs/${jobId}/cancel`);
    return response.data;
  }

  // ===========================================================================
  // ASSETS
  // ===========================================================================

  /**
   * Get download URL for a stem
   */
  getStemDownloadUrl(sessionId: string, stemName: string): string {
    return `${API_BASE}/api/assets/session/${sessionId}/download/${stemName}`;
  }

  /**
   * Get download URL for all stems as ZIP
   */
  getAllStemsDownloadUrl(sessionId: string): string {
    return `${API_BASE}/api/assets/session/${sessionId}/download-all`;
  }

  /**
   * Get peaks URL for source audio (for instant waveform without full decode)
   */
  getSourcePeaksUrl(sessionId: string): string {
    return `${API_BASE}/api/assets/session/${sessionId}/source/peaks`;
  }

  /**
   * Get peaks URL for a specific asset
   */
  getAssetPeaksUrl(assetId: string): string {
    return `${API_BASE}/api/assets/${assetId}/peaks`;
  }

  // ===========================================================================
  // SLICES
  // ===========================================================================

  /**
   * Create a slice bank from a stem
   */
  async createSliceBank(
    sessionId: string,
    stemPath: string,
    role: string = 'unknown',
    bpm?: number,
    key?: string
  ): Promise<SliceBank> {
    const response = await this.http.post('/api/slices/banks', {
      session_id: sessionId,
      stem_path: stemPath,
      role,
      bpm,
      key,
    });
    return response.data;
  }

  /**
   * Get slice bank details
   */
  async getSliceBank(sessionId: string, bankId: string): Promise<SliceBank> {
    const response = await this.http.get(`/api/slices/banks/${sessionId}/${bankId}`);
    return response.data;
  }

  /**
   * List slice banks for a session
   */
  async listSliceBanks(sessionId: string): Promise<{ banks: SliceBank[] }> {
    const response = await this.http.get(`/api/slices/banks/${sessionId}`);
    return response.data;
  }

  /**
   * Generate a trigger sequence
   */
  async generateSequence(params: {
    sessionId: string;
    sliceBankId: string;
    durationBeats?: number;
    bpm?: number;
    mode?: string;
    preset?: string;
    euclideanHits?: number;
    euclideanSteps?: number;
    euclideanRotation?: number;
    subdivision?: number;
    probabilities?: number[];
  }): Promise<Sequence> {
    const response = await this.http.post('/api/slices/sequences/generate', {
      session_id: params.sessionId,
      slice_bank_id: params.sliceBankId,
      duration_beats: params.durationBeats ?? 16,
      bpm: params.bpm ?? 120,
      mode: params.mode ?? 'sequential',
      preset: params.preset,
      euclidean_hits: params.euclideanHits,
      euclidean_steps: params.euclideanSteps,
      euclidean_rotation: params.euclideanRotation ?? 0,
      subdivision: params.subdivision ?? 1,
      probabilities: params.probabilities,
    });
    return response.data;
  }

  /**
   * Get available presets
   */
  async getPresets(): Promise<{ presets: { name: string; mode: string }[] }> {
    const response = await this.http.get('/api/slices/presets');
    return response.data;
  }

  // ===========================================================================
  // MOMENTS (Octatrack-style region detection)
  // ===========================================================================

  /**
   * Detect moments (hits, phrases, textures, changes) in a long audio file
   */
  async detectMoments(audioPath: string, bias: 'hits' | 'phrases' | 'textures' | 'balanced' = 'balanced'): Promise<{
    audio_path: string;
    bias: string;
    total_moments: number;
    moments: Array<{
      id: string;
      type: 'hit' | 'phrase' | 'texture' | 'change';
      start_time: number;
      end_time: number;
      duration: number;
      energy: number;
      brightness: number;
      label: string;
      confidence: number;
    }>;
    by_type: {
      hits: any[];
      phrases: any[];
      textures: any[];
      changes: any[];
    };
  }> {
    const response = await this.http.post('/api/moments/detect', {
      audio_path: audioPath,
      bias,
    });
    return response.data;
  }

  /**
   * Create slice bank from a specific region (Mark In/Out workflow)
   */
  async createRegionSlices(params: {
    sessionId: string;
    audioPath: string;
    startTime: number;
    endTime: number;
    role?: string;
  }): Promise<{
    id: string;
    source_path: string;
    role: string;
    region: { start_time: number; end_time: number; duration: number };
    num_slices: number;
    slices: any[];
  }> {
    const response = await this.http.post('/api/moments/region-slices', {
      session_id: params.sessionId,
      audio_path: params.audioPath,
      start_time: params.startTime,
      end_time: params.endTime,
      role: params.role ?? 'unknown',
    });
    return response.data;
  }

  // ===========================================================================
  // BOUNCE / RESAMPLE
  // ===========================================================================

  /**
   * Bounce pattern to audio and auto-slice it back to pads
   */
  async bounceAndSlice(params: {
    sessionId: string;
    stemId: string;
    patternEvents: Array<{ beat: number; sliceIndex: number; velocity: number; microOffset: number }>;
    bpm: number;
    bars?: number;
    swing?: number;
    name?: string;
  }): Promise<{
    bounce: { id: string; path: string; duration_seconds: number };
    slice_bank: { id: string; num_slices: number; slices: any[] } | null;
  }> {
    const response = await this.http.post('/api/bounce/render-and-slice', {
      session_id: params.sessionId,
      stem_id: params.stemId,
      pattern_events: params.patternEvents,
      bpm: params.bpm,
      bars: params.bars ?? 4,
      swing: params.swing ?? 0,
      name: params.name,
    });
    return response.data;
  }

  // ===========================================================================
  // GRID ANALYSIS (Beat/Downbeat Detection)
  // ===========================================================================

  /**
   * Analyze audio for beat grid (BPM, beats, downbeats)
   */
  async analyzeGrid(
    sessionId: string,
    options: { stem?: string; timeSignatureBeats?: number; timeSignatureUnit?: number } = {}
  ): Promise<{
    session_id: string;
    stem: string | null;
    grid: {
      bpm: number;
      bpm_confidence: number;
      time_signature: [number, number];
      beats: number[];
      downbeats: number[];
      duration: number;
      beat_duration: number;
      bar_duration: number;
      num_beats: number;
      num_bars: number;
    };
  }> {
    const params = new URLSearchParams();
    if (options.stem) params.append('stem', options.stem);
    if (options.timeSignatureBeats) params.append('time_signature_beats', String(options.timeSignatureBeats));
    if (options.timeSignatureUnit) params.append('time_signature_unit', String(options.timeSignatureUnit));
    
    const response = await this.http.get(`/api/grid/analyze/${sessionId}?${params}`);
    return response.data;
  }

  /**
   * Quantize slice boundaries to the beat grid
   */
  async quantizeSlicesToGrid(
    sliceBankId: string,
    options: { strength?: number; mode?: 'nearest' | 'floor' | 'ceil' } = {}
  ): Promise<{
    slice_bank_id: string;
    quantized_slices: number;
    grid_bpm: number;
    strength: number;
    mode: string;
  }> {
    const params = new URLSearchParams();
    if (options.strength !== undefined) params.append('strength', String(options.strength));
    if (options.mode) params.append('mode', options.mode);
    
    const response = await this.http.post(`/api/grid/quantize-slices/${sliceBankId}?${params}`);
    return response.data;
  }

  // ===========================================================================
  // EMBEDDINGS (CLAP Semantic Search)
  // ===========================================================================

  /**
   * Generate CLAP embeddings for all slices in a slice bank
   */
  async generateEmbeddings(sliceBankId: string): Promise<{
    slice_bank_id: string;
    embeddings_generated: number;
    total_slices: number;
  }> {
    const response = await this.http.post(`/api/embeddings/generate/${sliceBankId}`);
    return response.data;
  }

  /**
   * Search slices by text description (e.g., "punchy kick", "snappy snare")
   */
  async searchSlicesByText(
    sliceBankId: string,
    query: string,
    topK: number = 8
  ): Promise<{
    query: string;
    results: Array<{
      slice_index: number;
      score: number;
      start_time: number;
      end_time: number;
      rms_energy: number;
    }>;
    total_searched: number;
  }> {
    const response = await this.http.post('/api/embeddings/search/text', {
      slice_bank_id: sliceBankId,
      query,
      top_k: topK,
    });
    return response.data;
  }

  /**
   * Find slices similar to a reference slice
   */
  async findSimilarSlices(
    sliceBankId: string,
    referenceSliceIndex: number,
    topK: number = 8
  ): Promise<{
    reference_slice: number;
    results: Array<{
      slice_index: number;
      score: number;
      start_time: number;
      end_time: number;
    }>;
  }> {
    const response = await this.http.post('/api/embeddings/search/similar', {
      slice_bank_id: sliceBankId,
      reference_slice_index: referenceSliceIndex,
      top_k: topK,
    });
    return response.data;
  }

  /**
   * Generate an auto-kit with diverse or criteria-based slice selection
   */
  async generateAutoKit(
    sliceBankId: string,
    options: { numPads?: number; strategy?: 'diverse' | 'punchy' | 'bright' | 'deep' } = {}
  ): Promise<{
    slice_bank_id: string;
    strategy: string;
    kit: Array<{
      pad: number;
      slice_index: number;
      start_time: number;
      end_time: number;
      rms_energy: number;
    }>;
    num_pads_filled: number;
  }> {
    const response = await this.http.post('/api/embeddings/auto-kit', {
      slice_bank_id: sliceBankId,
      num_pads: options.numPads ?? 16,
      strategy: options.strategy ?? 'diverse',
    });
    return response.data;
  }

  /**
   * Rank all slices by similarity to a text criteria
   */
  async rankSlices(
    sliceBankId: string,
    criteria: string
  ): Promise<{
    criteria: string;
    ranked_slices: Array<{
      slice_index: number;
      score: number;
      start_time: number;
      end_time: number;
      rms_energy: number;
      transient_strength: number;
    }>;
    total_ranked: number;
  }> {
    const response = await this.http.post('/api/embeddings/rank', {
      slice_bank_id: sliceBankId,
      criteria,
    });
    return response.data;
  }

  // ===========================================================================
  // EFFECTS (Harmonic Filterbank, etc.)
  // ===========================================================================

  /**
   * Apply advanced harmonic filterbank to a stem
   * Time-varying spectral filterbank inspired by Harmonium (SuperCollider)
   */
  async applyHarmonicFilter(params: {
    sessionId: string;
    stemPath: string;
    rootNote: string;
    mode?: 'major' | 'minor' | 'chromatic' | 'pentatonic' | 'dorian';
    numHarmonics?: number;
    resonance?: number;
    mix?: number;
    spectralTilt?: number;
    voicing?: 'natural' | 'odd_only' | 'fifth' | 'spread' | 'dense';
    motion?: 'static' | 'breathe' | 'pulse' | 'shimmer' | 'drift';
    motionRate?: number;
    motionDepth?: number;
    preset?: string;
  }): Promise<{
    success: boolean;
    output_path: string;
    output_url: string;
    root_note: string;
    mode: string;
    num_harmonics: number;
    resonance: number;
    voicing: string;
    motion: string;
    spectral_tilt: number;
    preset_used: string | null;
  }> {
    const response = await this.http.post('/api/effects/harmonic-filter', {
      session_id: params.sessionId,
      stem_path: params.stemPath,
      root_note: params.rootNote,
      mode: params.mode ?? 'major',
      num_harmonics: params.numHarmonics ?? 16,
      resonance: params.resonance ?? 0.5,
      mix: params.mix ?? 1.0,
      spectral_tilt: params.spectralTilt ?? 0,
      voicing: params.voicing ?? 'natural',
      motion: params.motion ?? 'static',
      motion_rate: params.motionRate ?? 0.1,
      motion_depth: params.motionDepth ?? 0.3,
      preset: params.preset,
    });
    return response.data;
  }

  /**
   * Preview harmonic frequencies for a given key/mode
   */
  async previewHarmonicFrequencies(
    rootNote: string,
    mode: string = 'major',
    numHarmonics: number = 16
  ): Promise<{
    root_note: string;
    mode: string;
    num_harmonics: number;
    frequencies: number[];
    frequency_count: number;
  }> {
    const response = await this.http.get('/api/effects/harmonic-filter/preview-frequencies', {
      params: { root_note: rootNote, mode, num_harmonics: numHarmonics },
    });
    return response.data;
  }

  // ===========================================================================
  // WEBSOCKET
  // ===========================================================================

  /**
   * Get WebSocket URL for a session
   */
  getWebSocketUrl(sessionId: string): string {
    const wsBase = API_BASE.replace('http', 'ws');
    return `${wsBase}/api/ws/${sessionId}`;
  }

  /**
   * Get WebSocket URL for sequencer
   */
  getSequencerWebSocketUrl(sessionId: string): string {
    const wsBase = API_BASE.replace('http', 'ws');
    return `${wsBase}/api/ws/sequencer/${sessionId}`;
  }
}

// Singleton instance
export const api = new LoopForgeClient();

export default api;
