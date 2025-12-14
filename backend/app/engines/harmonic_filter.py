"""
Harmonic Filterbank Engine

Time-varying spectral filterbank for extracting pitched material from
complex audio sources (field recordings, noise, voice memos, etc.).

Core technique: STFT → harmonic mask → iSTFT
The mask passes only frequencies at harmonic intervals of the target pitch,
effectively "tuning" any audio material to a musical key.

Key features:
- Envelope following: filter response tracks input dynamics (attack/release)
- Spectral flux: transient detection modulates filter behavior  
- Per-partial amplitude control via spectral tilt (dB/octave)
- Multiple voicing modes (natural, odd-only, fifths, spread, dense)
- Motion types: static, breathe, pulse, shimmer, drift, follow

References:
- Spectral processing: J.O. Smith, "Spectral Audio Signal Processing"
- Envelope followers: analog synthesizer design (Moog, Buchla)
- Harmonium instrument: Trevor Treglia (SuperCollider)
"""

import numpy as np
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from enum import Enum
import soundfile as sf


class VoicingMode(str, Enum):
    """How harmonics are distributed across the spectrum."""
    NATURAL = "natural"      # Standard harmonic series (1, 2, 3, 4...)
    ODD_ONLY = "odd_only"    # Odd harmonics only (1, 3, 5, 7...) - hollow/clarinet-like
    FIFTH = "fifth"          # Root + fifth emphasis (power chord voicing)
    SPREAD = "spread"        # Wider spacing between partials
    DENSE = "dense"          # Tighter clustering in low-mids


class MotionType(str, Enum):
    """Type of temporal modulation."""
    STATIC = "static"        # No movement
    BREATHE = "breathe"      # Slow sine LFO on resonance
    PULSE = "pulse"          # Rhythmic gating
    SHIMMER = "shimmer"      # Micro-detuning for chorus effect
    DRIFT = "drift"          # Slow random walk on frequencies
    FOLLOW = "follow"        # Envelope follower - tracks input dynamics
    TRANSIENT = "transient"  # Spectral flux - responds to transients


@dataclass
class EnvelopeFollowerParams:
    """
    Parameters for envelope follower.
    
    Based on analog envelope follower design:
    - Attack: how quickly the envelope rises to meet input level
    - Release: how quickly the envelope falls when input decreases
    - Sensitivity: input gain before envelope detection
    """
    attack_ms: float = 10.0      # Attack time in milliseconds
    release_ms: float = 100.0    # Release time in milliseconds  
    sensitivity: float = 1.0     # Input sensitivity multiplier
    floor: float = 0.0           # Minimum envelope value (0-1)
    ceiling: float = 1.0         # Maximum envelope value (0-1)


@dataclass 
class SpectralFluxParams:
    """
    Parameters for spectral flux (transient) detection.
    
    Spectral flux measures frame-to-frame spectral change.
    High flux = transient/attack. Used to modulate filter response.
    """
    threshold: float = 0.1       # Flux threshold for "transient" detection
    decay_ms: float = 50.0       # How quickly transient response decays
    sensitivity: float = 1.0     # Flux sensitivity multiplier
    rectify: bool = True         # Only detect increases (onsets), not decreases


@dataclass
class HarmonicFilterResult:
    """Result of harmonic filtering."""
    output_path: str
    root_note: str
    mode: str
    num_harmonics: int
    resonance: float
    voicing: str
    motion: str
    spectral_tilt: float
    envelope_params: Optional[Dict[str, float]] = None
    flux_params: Optional[Dict[str, float]] = None
    
    def to_dict(self) -> dict:
        return {
            "output_path": self.output_path,
            "root_note": self.root_note,
            "mode": self.mode,
            "num_harmonics": self.num_harmonics,
            "resonance": self.resonance,
            "voicing": self.voicing,
            "motion": self.motion,
            "spectral_tilt": self.spectral_tilt,
            "envelope_params": self.envelope_params,
            "flux_params": self.flux_params,
        }


class HarmonicFilterbank:
    """
    Advanced harmonic filterbank inspired by Harmonium (SuperCollider).
    
    Creates time-varying resonant filters at harmonic intervals with:
    - Per-partial amplitude control (spectral tilt)
    - LFO modulation (breathing, pulsing, shimmer)
    - Multiple voicing modes
    - Spectral motion and drift
    """
    
    # Note frequencies (A4 = 440Hz)
    NOTE_FREQUENCIES = {
        'C': 261.63, 'C#': 277.18, 'Db': 277.18,
        'D': 293.66, 'D#': 311.13, 'Eb': 311.13,
        'E': 329.63,
        'F': 349.23, 'F#': 369.99, 'Gb': 369.99,
        'G': 392.00, 'G#': 415.30, 'Ab': 415.30,
        'A': 440.00, 'A#': 466.16, 'Bb': 466.16,
        'B': 493.88,
    }
    
    # Scale intervals (semitones from root)
    SCALE_INTERVALS = {
        'major': [0, 2, 4, 5, 7, 9, 11],
        'minor': [0, 2, 3, 5, 7, 8, 10],
        'chromatic': list(range(12)),
        'pentatonic': [0, 2, 4, 7, 9],
        'dorian': [0, 2, 3, 5, 7, 9, 10],
    }
    
    # Presets for quick access
    PRESETS: Dict[str, Dict[str, Any]] = {
        'drone': {
            'num_harmonics': 24,
            'resonance': 0.7,
            'spectral_tilt': -3.0,
            'voicing': 'natural',
            'motion': 'breathe',
            'motion_rate': 0.1,
            'motion_depth': 0.3,
        },
        'crystalline': {
            'num_harmonics': 32,
            'resonance': 0.85,
            'spectral_tilt': 2.0,
            'voicing': 'spread',
            'motion': 'shimmer',
            'motion_rate': 3.0,
            'motion_depth': 0.15,
        },
        'hollow': {
            'num_harmonics': 16,
            'resonance': 0.6,
            'spectral_tilt': -1.0,
            'voicing': 'odd_only',
            'motion': 'static',
            'motion_rate': 0,
            'motion_depth': 0,
        },
        'warm': {
            'num_harmonics': 12,
            'resonance': 0.4,
            'spectral_tilt': -6.0,
            'voicing': 'dense',
            'motion': 'breathe',
            'motion_rate': 0.05,
            'motion_depth': 0.2,
        },
        'ethereal': {
            'num_harmonics': 20,
            'resonance': 0.75,
            'spectral_tilt': 0,
            'voicing': 'fifth',
            'motion': 'drift',
            'motion_rate': 0.02,
            'motion_depth': 0.1,
        },
        # Envelope-following presets - timbre shaped by input dynamics
        'responsive': {
            'num_harmonics': 20,
            'resonance': 0.6,
            'spectral_tilt': 0,
            'voicing': 'natural',
            'motion': 'follow',
            'motion_rate': 0,
            'motion_depth': 0.7,
            'env_attack_ms': 10.0,
            'env_release_ms': 150.0,
        },
        'vocal': {
            'num_harmonics': 16,
            'resonance': 0.5,
            'spectral_tilt': -2.0,
            'voicing': 'natural',
            'motion': 'follow',
            'motion_rate': 0,
            'motion_depth': 0.8,
            'env_attack_ms': 5.0,
            'env_release_ms': 80.0,
        },
        'percussive': {
            'num_harmonics': 24,
            'resonance': 0.8,
            'spectral_tilt': 3.0,
            'voicing': 'spread',
            'motion': 'transient',
            'motion_rate': 0,
            'motion_depth': 0.9,
            'flux_threshold': 0.15,
            'flux_decay_ms': 30.0,
        },
        'field': {
            'num_harmonics': 28,
            'resonance': 0.65,
            'spectral_tilt': -1.0,
            'voicing': 'natural',
            'motion': 'follow',
            'motion_rate': 0,
            'motion_depth': 0.6,
            'env_attack_ms': 20.0,
            'env_release_ms': 200.0,
        },
    }
    
    def __init__(self):
        self._rng = np.random.default_rng(42)
    
    # =========================================================================
    # ENVELOPE FOLLOWER - Analog-style dynamics tracking
    # =========================================================================
    
    def extract_envelope(
        self,
        audio: np.ndarray,
        sr: int,
        frame_length: int,
        hop_length: int,
        attack_ms: float = 10.0,
        release_ms: float = 100.0,
        sensitivity: float = 1.0,
        floor: float = 0.0,
        ceiling: float = 1.0,
    ) -> np.ndarray:
        """
        Extract amplitude envelope from audio using attack/release smoothing.
        
        This mimics analog envelope followers (Moog, Buchla designs).
        The envelope rises quickly on transients (attack) and falls
        slowly during decay (release), creating natural dynamic tracking.
        
        Args:
            audio: Input audio (mono)
            sr: Sample rate
            frame_length: Analysis frame size (matches STFT)
            hop_length: Hop between frames
            attack_ms: Attack time constant in milliseconds
            release_ms: Release time constant in milliseconds
            sensitivity: Pre-envelope gain multiplier
            floor: Minimum output value
            ceiling: Maximum output value
            
        Returns:
            Envelope curve, one value per STFT frame, normalized to [floor, ceiling]
        """
        # Calculate time constants (convert ms to coefficient)
        # Using standard RC filter formula: coeff = 1 - exp(-1 / (tau * sr))
        attack_samples = (attack_ms / 1000.0) * sr
        release_samples = (release_ms / 1000.0) * sr
        attack_coeff = 1.0 - np.exp(-2.2 / attack_samples) if attack_samples > 0 else 1.0
        release_coeff = 1.0 - np.exp(-2.2 / release_samples) if release_samples > 0 else 1.0
        
        # Calculate RMS energy per frame
        num_frames = 1 + (len(audio) - frame_length) // hop_length
        rms_frames = np.zeros(num_frames)
        
        for i in range(num_frames):
            start = i * hop_length
            end = start + frame_length
            frame = audio[start:end] * sensitivity
            rms_frames[i] = np.sqrt(np.mean(frame ** 2))
        
        # Apply attack/release smoothing
        envelope = np.zeros(num_frames)
        envelope[0] = rms_frames[0]
        
        for i in range(1, num_frames):
            if rms_frames[i] > envelope[i-1]:
                # Attack: input rising
                envelope[i] = envelope[i-1] + attack_coeff * (rms_frames[i] - envelope[i-1])
            else:
                # Release: input falling
                envelope[i] = envelope[i-1] + release_coeff * (rms_frames[i] - envelope[i-1])
        
        # Normalize to [0, 1] then scale to [floor, ceiling]
        env_max = np.max(envelope)
        if env_max > 0:
            envelope = envelope / env_max
        envelope = floor + envelope * (ceiling - floor)
        
        return envelope
    
    # =========================================================================
    # SPECTRAL FLUX - Transient/onset detection
    # =========================================================================
    
    def compute_spectral_flux(
        self,
        stft_magnitude: np.ndarray,
        sr: int,
        hop_length: int,
        threshold: float = 0.1,
        decay_ms: float = 50.0,
        sensitivity: float = 1.0,
        rectify: bool = True,
    ) -> np.ndarray:
        """
        Compute spectral flux from STFT magnitude.
        
        Spectral flux measures the rate of change of the spectrum.
        High flux = transient/attack. Used to detect onsets and
        modulate filter behavior in response to sonic events.
        
        Based on: Bello et al., "A Tutorial on Onset Detection in Music Signals"
        
        Args:
            stft_magnitude: Magnitude spectrogram [n_bins, n_frames]
            sr: Sample rate
            hop_length: STFT hop length
            threshold: Flux values below this are zeroed
            decay_ms: Exponential decay time for flux response
            sensitivity: Output scaling
            rectify: If True, only detect increases (onsets), not decreases
            
        Returns:
            Flux curve, one value per frame, normalized to [0, 1]
        """
        n_frames = stft_magnitude.shape[1]
        flux = np.zeros(n_frames)
        
        # Compute frame-to-frame difference
        for i in range(1, n_frames):
            diff = stft_magnitude[:, i] - stft_magnitude[:, i-1]
            if rectify:
                diff = np.maximum(diff, 0)  # Only positive changes (onsets)
            flux[i] = np.sum(diff ** 2)
        
        # Normalize
        flux_max = np.max(flux)
        if flux_max > 0:
            flux = flux / flux_max
        
        # Apply threshold
        flux = np.where(flux > threshold, flux, 0)
        
        # Apply exponential decay (smoothing)
        decay_samples = (decay_ms / 1000.0) * sr / hop_length
        decay_coeff = np.exp(-1.0 / decay_samples) if decay_samples > 0 else 0
        
        smoothed = np.zeros(n_frames)
        for i in range(n_frames):
            if flux[i] > smoothed[i-1] if i > 0 else 0:
                smoothed[i] = flux[i]
            else:
                smoothed[i] = smoothed[i-1] * decay_coeff if i > 0 else 0
        
        return smoothed * sensitivity
    
    def get_harmonic_frequencies(
        self,
        root_note: str,
        mode: str = 'major',
        num_harmonics: int = 16,
        octave: int = 3,
        voicing: str = 'natural'
    ) -> List[tuple]:
        """
        Generate harmonic frequencies with per-partial info.
        
        Returns list of (frequency, harmonic_number, amplitude_weight)
        """
        base_freq = self.NOTE_FREQUENCIES.get(root_note, 261.63)
        base_freq = base_freq * (2 ** (octave - 4))
        
        intervals = self.SCALE_INTERVALS.get(mode, self.SCALE_INTERVALS['major'])
        harmonics = []
        
        # Determine which harmonic numbers to use based on voicing
        if voicing == 'odd_only':
            h_numbers = [h for h in range(1, num_harmonics * 2 + 1) if h % 2 == 1][:num_harmonics]
        elif voicing == 'spread':
            h_numbers = [1, 2, 3, 5, 7, 9, 12, 15, 18, 22, 26, 31][:num_harmonics]
        elif voicing == 'dense':
            h_numbers = list(range(1, min(num_harmonics + 1, 13)))  # Focus on low partials
        elif voicing == 'fifth':
            # Emphasize root, fifth, octave patterns
            h_numbers = [1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, 27][:num_harmonics]
        else:  # natural
            h_numbers = list(range(1, num_harmonics + 1))
        
        for interval in intervals:
            scale_freq = base_freq * (2 ** (interval / 12))
            
            for h in h_numbers:
                freq = scale_freq * h
                if freq < 20000:
                    # Natural amplitude weight (higher harmonics quieter)
                    weight = 1.0 / (h ** 0.5)
                    harmonics.append((freq, h, weight))
        
        # Remove duplicates (by frequency, keeping lowest harmonic number)
        seen_freqs = {}
        for freq, h, weight in harmonics:
            freq_key = round(freq, 1)
            if freq_key not in seen_freqs or h < seen_freqs[freq_key][1]:
                seen_freqs[freq_key] = (freq, h, weight)
        
        return sorted(seen_freqs.values(), key=lambda x: x[0])
    
    def create_time_varying_filterbank(
        self,
        harmonics: List[tuple],
        sr: int,
        num_frames: int,
        n_fft: int = 4096,
        resonance: float = 0.5,
        spectral_tilt: float = 0.0,
        motion: str = 'static',
        motion_rate: float = 0.1,
        motion_depth: float = 0.3,
        envelope: Optional[np.ndarray] = None,
        spectral_flux: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """
        Create time-varying filterbank masks.
        
        Args:
            harmonics: List of (freq, harmonic_num, weight)
            sr: Sample rate
            num_frames: Number of STFT frames
            n_fft: FFT size
            resonance: Base filter resonance (0-1)
            spectral_tilt: dB/octave tilt (negative = darker)
            motion: Motion type (static, breathe, pulse, shimmer, drift, follow, transient)
            motion_rate: LFO rate in Hz (for LFO-based motion)
            motion_depth: Modulation depth 0-1
            envelope: Pre-computed envelope follower output (for 'follow' motion)
            spectral_flux: Pre-computed spectral flux (for 'transient' motion)
            
        Returns:
            Time-varying mask [n_bins, num_frames]
        """
        n_bins = n_fft // 2 + 1
        freq_bins = np.fft.rfftfreq(n_fft, 1/sr)
        
        # Initialize mask for all frames
        masks = np.zeros((n_bins, num_frames))
        
        # Base Q factor (resonance 0-1 maps to Q 5-50)
        q_base = 5 + resonance * 45
        
        # Reference frequency for tilt calculation
        ref_freq = 1000.0
        
        # Generate time array for LFO
        frame_times = np.arange(num_frames) * (n_fft / 4) / sr
        
        # Generate modulation signal based on motion type
        if motion == 'breathe':
            # Sinusoidal LFO
            lfo = 0.5 + 0.5 * np.sin(2 * np.pi * motion_rate * frame_times)
            lfo = 1.0 - motion_depth + motion_depth * lfo
        elif motion == 'pulse':
            # Square wave LFO (rhythmic gating)
            lfo = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * motion_rate * frame_times))
            lfo = 1.0 - motion_depth + motion_depth * lfo
        elif motion == 'shimmer':
            # Per-partial random phase offsets for shimmer (handled in loop below)
            lfo = np.ones(num_frames)
        elif motion == 'drift':
            # Slow random walk on frequencies
            drift = np.cumsum(self._rng.normal(0, motion_rate, num_frames))
            drift = drift / (np.max(np.abs(drift)) + 1e-8) * motion_depth
            lfo = 1.0 + drift
        elif motion == 'follow' and envelope is not None:
            # Envelope follower: filter response tracks input dynamics
            # High envelope = more open filters (higher Q, brighter)
            lfo = 1.0 - motion_depth + motion_depth * envelope
        elif motion == 'transient' and spectral_flux is not None:
            # Spectral flux: transients open filters momentarily
            # Combine with a base level so sound isn't gated
            base_level = 0.3
            lfo = base_level + (1.0 - base_level) * spectral_flux * motion_depth
            lfo = np.clip(lfo, 0.1, 1.0)
        else:
            lfo = np.ones(num_frames)
        
        for freq, h_num, base_weight in harmonics:
            if freq <= 0 or freq >= sr / 2:
                continue
            
            # Apply spectral tilt
            if spectral_tilt != 0 and freq > 0:
                octaves_from_ref = np.log2(freq / ref_freq)
                tilt_factor = 10 ** (spectral_tilt * octaves_from_ref / 20)
                weight = base_weight * tilt_factor
            else:
                weight = base_weight
            
            # Q factor with possible per-frame modulation
            q = q_base * lfo
            bandwidth = freq / q
            sigma = bandwidth / 2.355
            
            # Create per-frame Gaussian filters
            for frame_idx in range(num_frames):
                frame_sigma = sigma[frame_idx] if hasattr(sigma, '__len__') else sigma
                
                # Shimmer: micro-detune each partial
                if motion == 'shimmer':
                    phase = self._rng.random() * 2 * np.pi
                    detune = 1.0 + motion_depth * 0.01 * np.sin(
                        2 * np.pi * motion_rate * frame_times[frame_idx] + phase * h_num
                    )
                    frame_freq = freq * detune
                else:
                    frame_freq = freq
                
                gaussian = weight * np.exp(-0.5 * ((freq_bins - frame_freq) / frame_sigma) ** 2)
                masks[:, frame_idx] = np.maximum(masks[:, frame_idx], gaussian)
        
        # Normalize per frame
        for i in range(num_frames):
            max_val = np.max(masks[:, i])
            if max_val > 0:
                masks[:, i] /= max_val
        
        return masks
    
    def apply_filterbank(
        self,
        audio: np.ndarray,
        sr: int,
        root_note: str,
        mode: str = 'major',
        num_harmonics: int = 16,
        resonance: float = 0.5,
        spectral_tilt: float = 0.0,
        voicing: str = 'natural',
        motion: str = 'static',
        motion_rate: float = 0.1,
        motion_depth: float = 0.3,
        mix: float = 1.0,
        n_fft: int = 4096,
        hop_length: int = 1024,
        # Envelope follower parameters
        env_attack_ms: float = 10.0,
        env_release_ms: float = 100.0,
        env_sensitivity: float = 1.0,
        # Spectral flux parameters
        flux_threshold: float = 0.1,
        flux_decay_ms: float = 50.0,
        flux_sensitivity: float = 1.0,
    ) -> np.ndarray:
        """
        Apply time-varying harmonic filterbank to audio.
        
        For motion='follow': filter response tracks input amplitude envelope.
        For motion='transient': filter response reacts to spectral changes/onsets.
        
        Args:
            audio: Input audio (mono or stereo)
            sr: Sample rate
            root_note: Target root note (e.g., 'C', 'F#')
            mode: Scale mode (major, minor, pentatonic, dorian, chromatic)
            num_harmonics: Number of harmonics in filterbank
            resonance: Filter resonance 0-1 (controls Q factor)
            spectral_tilt: dB/octave slope (negative=darker, positive=brighter)
            voicing: Harmonic voicing mode
            motion: Modulation type (static, breathe, pulse, shimmer, drift, follow, transient)
            motion_rate: LFO rate in Hz (for LFO modes)
            motion_depth: Modulation depth 0-1
            mix: Dry/wet mix 0-1
            n_fft: FFT size for STFT
            hop_length: Hop length for STFT
            env_attack_ms: Envelope follower attack time (ms)
            env_release_ms: Envelope follower release time (ms)
            env_sensitivity: Envelope input gain
            flux_threshold: Spectral flux onset threshold
            flux_decay_ms: Spectral flux decay time (ms)
            flux_sensitivity: Spectral flux output gain
            
        Returns:
            Filtered audio
        """
        from scipy.signal import stft, istft
        
        # Handle stereo with slight decorrelation for width
        if audio.ndim == 2:
            left = self.apply_filterbank(
                audio[0], sr, root_note, mode, num_harmonics, resonance,
                spectral_tilt, voicing, motion, motion_rate, motion_depth,
                mix, n_fft, hop_length, env_attack_ms, env_release_ms,
                env_sensitivity, flux_threshold, flux_decay_ms, flux_sensitivity
            )
            self._rng = np.random.default_rng(43)
            right = self.apply_filterbank(
                audio[1], sr, root_note, mode, num_harmonics, resonance,
                spectral_tilt, voicing, motion, motion_rate * 1.01, motion_depth,
                mix, n_fft, hop_length, env_attack_ms, env_release_ms,
                env_sensitivity, flux_threshold, flux_decay_ms, flux_sensitivity
            )
            self._rng = np.random.default_rng(42)
            return np.stack([left, right])
        
        # Get harmonics for target key
        harmonics = self.get_harmonic_frequencies(root_note, mode, num_harmonics, voicing=voicing)
        
        # STFT analysis
        f, t, Zxx = stft(audio, sr, nperseg=n_fft, noverlap=n_fft - hop_length)
        num_frames = Zxx.shape[1]
        stft_magnitude = np.abs(Zxx)
        
        # Extract envelope if using envelope-following motion
        envelope = None
        if motion == 'follow':
            envelope = self.extract_envelope(
                audio, sr, n_fft, hop_length,
                attack_ms=env_attack_ms,
                release_ms=env_release_ms,
                sensitivity=env_sensitivity,
                floor=0.1,  # Don't let it go fully silent
                ceiling=1.0,
            )
            # Ensure envelope matches frame count
            if len(envelope) != num_frames:
                envelope = np.interp(
                    np.linspace(0, 1, num_frames),
                    np.linspace(0, 1, len(envelope)),
                    envelope
                )
        
        # Compute spectral flux if using transient-reactive motion
        spectral_flux = None
        if motion == 'transient':
            spectral_flux = self.compute_spectral_flux(
                stft_magnitude, sr, hop_length,
                threshold=flux_threshold,
                decay_ms=flux_decay_ms,
                sensitivity=flux_sensitivity,
                rectify=True,
            )
        
        # Create time-varying filterbank
        masks = self.create_time_varying_filterbank(
            harmonics, sr, num_frames, n_fft, resonance,
            spectral_tilt, motion, motion_rate, motion_depth,
            envelope=envelope, spectral_flux=spectral_flux
        )
        
        # Apply masks to STFT
        Zxx_filtered = Zxx * masks
        
        # ISTFT reconstruction
        _, filtered = istft(Zxx_filtered, sr, nperseg=n_fft, noverlap=n_fft - hop_length)
        
        # Match output length to input
        if len(filtered) > len(audio):
            filtered = filtered[:len(audio)]
        elif len(filtered) < len(audio):
            filtered = np.pad(filtered, (0, len(audio) - len(filtered)))
        
        # Dry/wet mix
        output = audio * (1 - mix) + filtered * mix
        
        # Soft clip to prevent harsh distortion
        max_val = np.max(np.abs(output))
        if max_val > 0.99:
            output = np.tanh(output / max_val) * 0.99
        
        return output
    
    def process_file(
        self,
        input_path: Path,
        output_path: Path,
        root_note: str,
        mode: str = 'major',
        num_harmonics: int = 16,
        resonance: float = 0.5,
        spectral_tilt: float = 0.0,
        voicing: str = 'natural',
        motion: str = 'static',
        motion_rate: float = 0.1,
        motion_depth: float = 0.3,
        mix: float = 1.0,
        preset: Optional[str] = None,
        # Envelope follower parameters (for motion='follow')
        env_attack_ms: float = 10.0,
        env_release_ms: float = 100.0,
        env_sensitivity: float = 1.0,
        # Spectral flux parameters (for motion='transient')
        flux_threshold: float = 0.1,
        flux_decay_ms: float = 50.0,
        flux_sensitivity: float = 1.0,
    ) -> HarmonicFilterResult:
        """
        Process an audio file through the harmonic filterbank.
        
        For voice memos, field recordings, and complex audio sources.
        Extracts pitched material by filtering through harmonic series.
        
        Args:
            input_path: Source audio file
            output_path: Destination for processed audio
            root_note: Target root note (C, C#, D, etc.)
            mode: Scale mode (major, minor, pentatonic, dorian, chromatic)
            num_harmonics: Number of harmonic partials (4-32)
            resonance: Filter Q factor (0-1, higher = narrower peaks)
            spectral_tilt: dB/octave slope (negative = darker)
            voicing: Harmonic distribution (natural, odd_only, fifth, spread, dense)
            motion: Modulation type:
                - static: No modulation
                - breathe: Slow sine LFO
                - pulse: Rhythmic gating
                - shimmer: Micro-detuning
                - drift: Random walk
                - follow: Envelope follower (tracks input dynamics)
                - transient: Spectral flux (responds to onsets)
            motion_rate: LFO rate in Hz
            motion_depth: Modulation amount (0-1)
            mix: Dry/wet (0=dry, 1=wet)
            preset: Named preset (overrides other params)
            env_attack_ms: Envelope follower attack time
            env_release_ms: Envelope follower release time
            env_sensitivity: Envelope input gain
            flux_threshold: Spectral flux onset threshold
            flux_decay_ms: Spectral flux decay time
            flux_sensitivity: Spectral flux output gain
        """
        # Apply preset if specified
        envelope_params = None
        flux_params = None
        
        if preset and preset in self.PRESETS:
            p = self.PRESETS[preset]
            num_harmonics = p.get('num_harmonics', num_harmonics)
            resonance = p.get('resonance', resonance)
            spectral_tilt = p.get('spectral_tilt', spectral_tilt)
            voicing = p.get('voicing', voicing)
            motion = p.get('motion', motion)
            motion_rate = p.get('motion_rate', motion_rate)
            motion_depth = p.get('motion_depth', motion_depth)
            # Envelope follower params from preset
            env_attack_ms = p.get('env_attack_ms', env_attack_ms)
            env_release_ms = p.get('env_release_ms', env_release_ms)
            # Spectral flux params from preset
            flux_threshold = p.get('flux_threshold', flux_threshold)
            flux_decay_ms = p.get('flux_decay_ms', flux_decay_ms)
        
        # Track params for result
        if motion == 'follow':
            envelope_params = {
                'attack_ms': env_attack_ms,
                'release_ms': env_release_ms,
                'sensitivity': env_sensitivity,
            }
        if motion == 'transient':
            flux_params = {
                'threshold': flux_threshold,
                'decay_ms': flux_decay_ms,
                'sensitivity': flux_sensitivity,
            }
        
        # Load audio
        audio, sr = sf.read(str(input_path))
        
        if audio.ndim == 2:
            audio = audio.T
        
        # Apply filterbank
        filtered = self.apply_filterbank(
            audio, sr, root_note, mode, num_harmonics, resonance,
            spectral_tilt, voicing, motion, motion_rate, motion_depth, mix,
            env_attack_ms=env_attack_ms,
            env_release_ms=env_release_ms,
            env_sensitivity=env_sensitivity,
            flux_threshold=flux_threshold,
            flux_decay_ms=flux_decay_ms,
            flux_sensitivity=flux_sensitivity,
        )
        
        if filtered.ndim == 2:
            filtered = filtered.T
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), filtered, sr)
        
        return HarmonicFilterResult(
            output_path=str(output_path),
            root_note=root_note,
            mode=mode,
            num_harmonics=num_harmonics,
            resonance=resonance,
            voicing=voicing,
            motion=motion,
            spectral_tilt=spectral_tilt,
            envelope_params=envelope_params,
            flux_params=flux_params,
        )


# Singleton instance
_filterbank: Optional[HarmonicFilterbank] = None

def get_harmonic_filterbank() -> HarmonicFilterbank:
    """Get or create the harmonic filterbank instance."""
    global _filterbank
    if _filterbank is None:
        _filterbank = HarmonicFilterbank()
    return _filterbank
