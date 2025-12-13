export interface ForgeSource {
    filename: string;
    path: string;
    key?: string;
    mode?: string;
    full_key?: string;
    bpm?: number;
    role?: string | null;
    duration?: number;
    tags?: string[];
}

export interface ForgeResult {
    role: string;
    preset: string;
    filename: string;
    path: string;
    key?: string;
    bpm?: number;
}

export interface ForgeSession {
    session_id: string;
    status: 'created' | 'analyzing' | 'analyzed' | 'processing' | 'complete' | 'error';
    progress: number;
    message: string;
    sources: ForgeSource[];
    results: ForgeResult[];
    anchor_key?: string;
    zip_path?: string;
    track_progress?: Record<string, { status: string; progress: number }>;
}

export interface LoopViewModel {
    id: string;
    filename: string; // Added filename
    role: string;
    bpm: number;
    key: string;
    path: string;
    peaks_filename?: string;
    peaks_path?: string;
    bars?: number;

    // UI State
    selected: boolean;
    duration: number | null;
    cropStart: number;
    cropEnd: number;
    gain: number;
    loopPlayback: boolean;
    transients: number[];
    texture?: string;
    parent?: string;
    dna?: {
        energy: number;
        rhythm: number;
        tonality: number;
    };
    tags?: string[];
    shift_amount?: number;
    effect_chain?: string[];
}

export interface VocalSettings {
    correction_strength: number;
    formant_shift: number;
    pitch_wobble: number;
    stutter_intensity: number;
    bitcrush_depth: number;
    phase_smear: number;
}

export interface ProcessingConfig {
    // Dual-Anchor System (Chimera Protocol)
    rhythm_anchor_filename?: string;     // Track to use as BPM reference
    harmonic_anchor_filename?: string;   // Track to use as Key reference
    target_bpm?: number;                 // Manual BPM override
    target_key?: string;                 // Manual key override  
    target_mode?: string;                // Manual mode override
    roles: Record<string, string>;
    enabled_presets: string[];
    crops: Record<string, { start: number; end: number }>;
    quality?: string;
    vocal_settings?: VocalSettings;
}
