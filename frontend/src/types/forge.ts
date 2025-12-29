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
    
    // Per-track FX state
    fxEnabled?: boolean;
    fxPreset?: FxPresetName;
    fxSettings?: VocalSettings;
}

// Available FX presets (maps to backend ArtifactEngine presets)
export type FxPresetName = 'none' | 'bladee_classic' | 'glitch_artifact' | 'digital_decay' | 'ghost_voice' | 'yeat_rage' | 'autechre_granular' | 'custom';

export const FX_PRESETS: { id: FxPresetName; label: string; description: string; tags: string[] }[] = [
    { id: 'none', label: 'DRY', description: 'No processing', tags: [] },
    { id: 'bladee_classic', label: 'DRAIN', description: 'Whitearmor/Gud style: instant hard tune, +2 formant, clean', tags: ['drain gang', 'ethereal', 'clean'] },
    { id: 'yeat_rage', label: 'RAGE', description: 'Yeat style: instant tune, -2 formant, heavy compression', tags: ['rage', 'trap', 'aggressive'] },
    { id: 'glitch_artifact', label: 'GLITCH', description: 'SOPHIE/Arca style: stutter, bitcrush, chaos', tags: ['hyperpop', 'experimental', 'destructive'] },
    { id: 'digital_decay', label: 'LO-FI', description: 'Burial style: tape saturation, wobble, degraded', tags: ['lo-fi', 'nostalgic', 'warm'] },
    { id: 'ghost_voice', label: 'GHOST', description: 'James Blake style: high formant, phase smear, ethereal', tags: ['ambient', 'ethereal', 'otherworldly'] },
    { id: 'autechre_granular', label: 'GRANULAR', description: 'Autechre style: granular stutter, spectral freeze, chaotic', tags: ['idm', 'experimental', 'glitch'] },
    { id: 'custom', label: 'CUSTOM', description: 'Manual parameter control', tags: ['manual'] },
];

/**
 * Advanced vocal/audio effect settings.
 * All parameters map to backend ArtifactEngine processing.
 */
export interface VocalSettings {
    // === PITCH CORRECTION (Melodyne/Auto-Tune style) ===
    /** 0.0-1.0: Pitch snap intensity (0=natural, 1=hard tune) */
    correction_strength: number;
    /** 0-100ms: Retune speed (0=instant/robotic, 50=natural) */
    correction_speed_ms: number;
    /** Keep natural pitch variation vs flatten */
    preserve_vibrato: boolean;
    /** 0.0-1.0: Random micro-detuning for organic feel */
    humanize_amount: number;
    
    // === FORMANT MANIPULATION (Vocal tract modeling) ===
    /** Semitones (-24 to +24): Spectral envelope warp */
    formant_shift: number;
    /** Independent of pitch vs linked */
    formant_preserve: boolean;
    /** 0.5-2.0: Vocal tract length multiplier (1.0=normal) */
    throat_length: number;
    
    // === DIGITAL DEGRADATION ===
    /** Target sample rate Hz (6900-44100) */
    bitcrush_rate: number;
    /** Bit depth (8-24, lower=crunchier) */
    bitcrush_depth: number;
    /** 'none', 'mild', 'harsh': Anti-aliasing bypass */
    aliasing_mode: 'none' | 'mild' | 'harsh';
    
    // === DYNAMICS ===
    /** 1.0-20.0: Dynamic range reduction */
    compression_ratio: number;
    /** -40 to 0 dB: Level where compression starts */
    compression_threshold_db: number;
    /** 0.0-1.0: Harmonic distortion amount */
    saturation: number;
    /** 'tape', 'tube', 'digital', 'transistor' */
    saturation_type: 'tape' | 'tube' | 'digital' | 'transistor';
    
    // === MODULATION ===
    /** 0.0-1.0: Pitch instability depth (semitones) */
    pitch_wobble: number;
    /** Hz (0.5-20): LFO rate for pitch mod */
    wobble_speed: number;
    /** 'sine', 'random', 'drift': Modulation shape */
    wobble_shape: 'sine' | 'random' | 'drift';
    
    // === GLITCH/STUTTER ===
    /** 0.0-1.0: Probability of stutter events */
    stutter_intensity: number;
    /** 'random', '16th', 'triplet', 'chaos' */
    stutter_pattern: 'random' | '16th' | 'triplet' | 'chaos';
    
    // === SPECTRAL ===
    /** 0.0-1.0: Phase randomization (ethereal/washy) */
    phase_smear: number;
    /** 0.0-1.0: Spectral sustain/drone amount */
    spectral_freeze: number;
    
    // === LAYERING ===
    /** 0.0-1.0: Mix with corrupted copies */
    layer_corruption: number;
    /** 0-50 cents: Stereo doubling detune */
    double_track_detune: number;
}

/** Default settings for a clean/dry signal */
export const DEFAULT_VOCAL_SETTINGS: VocalSettings = {
    correction_strength: 0,
    correction_speed_ms: 0,
    preserve_vibrato: true,
    humanize_amount: 0,
    formant_shift: 0,
    formant_preserve: true,
    throat_length: 1.0,
    bitcrush_rate: 44100,
    bitcrush_depth: 24,
    aliasing_mode: 'none',
    compression_ratio: 1.0,
    compression_threshold_db: 0,
    saturation: 0,
    saturation_type: 'tape',
    pitch_wobble: 0,
    wobble_speed: 4.0,
    wobble_shape: 'sine',
    stutter_intensity: 0,
    stutter_pattern: 'random',
    phase_smear: 0,
    spectral_freeze: 0,
    layer_corruption: 0,
    double_track_detune: 0,
};

/** Bladee/Drain Gang preset values */
export const BLADEE_PRESET: Partial<VocalSettings> = {
    correction_strength: 0.95,
    correction_speed_ms: 0,
    preserve_vibrato: false,
    humanize_amount: 0.02,
    formant_shift: 2,
    throat_length: 0.92,
    saturation: 0.25,
    double_track_detune: 8,
};

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
