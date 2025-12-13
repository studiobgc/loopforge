"""
Harmonic Filterbank Engine (Advanced)

Inspired by Harmonium (Trevor Treglia's SuperCollider instrument).

This is a time-varying spectral filterbank that extracts pitched material
from complex audio sources. Unlike simple EQ, this creates resonant filters
at harmonic intervals that can shimmer, pulse, and evolve over time.

Features matching Harmonium concepts:
- Per-partial amplitude control (spectral tilt/rolloff)
- LFO modulation on filter resonance (breathing/pulsing)
- Spectral shimmer (micro-detuning of partials)
- Harmonic motion (slow frequency drift)
- Multiple voicing modes (unison, spread, odd-only)
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
    }
    
    def __init__(self):
        self._rng = np.random.default_rng(42)
    
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
    ) -> np.ndarray:
        """
        Create time-varying filterbank masks.
        
        Args:
            harmonics: List of (freq, harmonic_num, weight)
            sr: Sample rate
            num_frames: Number of STFT frames
            n_fft: FFT size
            resonance: Base filter resonance
            spectral_tilt: dB/octave tilt (negative = darker)
            motion: Motion type
            motion_rate: LFO rate in Hz
            motion_depth: Modulation depth 0-1
            
        Returns:
            Time-varying mask [n_bins, num_frames]
        """
        n_bins = n_fft // 2 + 1
        freq_bins = np.fft.rfftfreq(n_fft, 1/sr)
        
        # Initialize mask for all frames
        masks = np.zeros((n_bins, num_frames))
        
        # Base Q factor
        q_base = 5 + resonance * 45
        
        # Reference frequency for tilt calculation
        ref_freq = 1000.0
        
        # Generate time array for LFO
        frame_times = np.arange(num_frames) * (n_fft / 4) / sr
        
        # Generate motion LFO
        if motion == 'breathe':
            lfo = 0.5 + 0.5 * np.sin(2 * np.pi * motion_rate * frame_times)
            lfo = 1.0 - motion_depth + motion_depth * lfo
        elif motion == 'pulse':
            lfo = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * motion_rate * frame_times))
            lfo = 1.0 - motion_depth + motion_depth * lfo
        elif motion == 'shimmer':
            # Per-partial random phase offsets for shimmer
            lfo = np.ones(num_frames)  # Base - shimmer applied per-partial
        elif motion == 'drift':
            # Slow random walk
            drift = np.cumsum(self._rng.normal(0, motion_rate, num_frames))
            drift = drift / (np.max(np.abs(drift)) + 1e-8) * motion_depth
            lfo = 1.0 + drift
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
        hop_length: int = 1024
    ) -> np.ndarray:
        """
        Apply time-varying harmonic filterbank to audio.
        """
        from scipy.signal import stft, istft
        
        # Handle stereo with slight decorrelation for width
        if audio.ndim == 2:
            # Slightly different motion phase for L/R
            left = self.apply_filterbank(
                audio[0], sr, root_note, mode, num_harmonics, resonance,
                spectral_tilt, voicing, motion, motion_rate, motion_depth,
                mix, n_fft, hop_length
            )
            # Offset motion phase for right channel
            self._rng = np.random.default_rng(43)
            right = self.apply_filterbank(
                audio[1], sr, root_note, mode, num_harmonics, resonance,
                spectral_tilt, voicing, motion, motion_rate * 1.01, motion_depth,
                mix, n_fft, hop_length
            )
            self._rng = np.random.default_rng(42)
            return np.stack([left, right])
        
        # Get harmonics
        harmonics = self.get_harmonic_frequencies(root_note, mode, num_harmonics, voicing=voicing)
        
        # STFT
        f, t, Zxx = stft(audio, sr, nperseg=n_fft, noverlap=n_fft - hop_length)
        num_frames = Zxx.shape[1]
        
        # Create time-varying filterbank
        masks = self.create_time_varying_filterbank(
            harmonics, sr, num_frames, n_fft, resonance,
            spectral_tilt, motion, motion_rate, motion_depth
        )
        
        # Apply masks
        Zxx_filtered = Zxx * masks
        
        # ISTFT
        _, filtered = istft(Zxx_filtered, sr, nperseg=n_fft, noverlap=n_fft - hop_length)
        
        # Match length
        if len(filtered) > len(audio):
            filtered = filtered[:len(audio)]
        elif len(filtered) < len(audio):
            filtered = np.pad(filtered, (0, len(audio) - len(filtered)))
        
        # Mix
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
        preset: Optional[str] = None
    ) -> HarmonicFilterResult:
        """
        Process an audio file through the advanced harmonic filterbank.
        """
        # Apply preset if specified
        if preset and preset in self.PRESETS:
            p = self.PRESETS[preset]
            num_harmonics = p.get('num_harmonics', num_harmonics)
            resonance = p.get('resonance', resonance)
            spectral_tilt = p.get('spectral_tilt', spectral_tilt)
            voicing = p.get('voicing', voicing)
            motion = p.get('motion', motion)
            motion_rate = p.get('motion_rate', motion_rate)
            motion_depth = p.get('motion_depth', motion_depth)
        
        # Load audio
        audio, sr = sf.read(str(input_path))
        
        if audio.ndim == 2:
            audio = audio.T
        
        # Apply filterbank
        filtered = self.apply_filterbank(
            audio, sr, root_note, mode, num_harmonics, resonance,
            spectral_tilt, voicing, motion, motion_rate, motion_depth, mix
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
        )


# Singleton instance
_filterbank: Optional[HarmonicFilterbank] = None

def get_harmonic_filterbank() -> HarmonicFilterbank:
    """Get or create the harmonic filterbank instance."""
    global _filterbank
    if _filterbank is None:
        _filterbank = HarmonicFilterbank()
    return _filterbank
