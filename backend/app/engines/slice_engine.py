"""
Slice Engine - Autechre-inspired sample slicing and analysis.

Detects transients, creates slice banks, and provides intelligent
slice selection with spectral analysis.
"""

import librosa
import numpy as np
import soundfile as sf
import random
from pathlib import Path
from typing import List, Dict, Optional, Tuple, TYPE_CHECKING
from dataclasses import dataclass, field, asdict
from enum import Enum
import json

if TYPE_CHECKING:
    import random as random_module


class SliceRole(Enum):
    """Role of the source stem"""
    DRUMS = "drums"
    BASS = "bass"
    VOCALS = "vocals"
    OTHER = "other"
    UNKNOWN = "unknown"


@dataclass
class Slice:
    """
    A single slice from an audio file.
    
    Contains precise sample boundaries and spectral analysis
    for intelligent selection and manipulation.
    """
    index: int
    start_sample: int
    end_sample: int
    start_time: float
    end_time: float
    duration: float
    
    # Analysis data
    transient_strength: float = 0.0      # How "hard" the attack is (0-1)
    spectral_centroid: float = 0.0       # Brightness in Hz
    rms_energy: float = 0.0              # Loudness (0-1 normalized)
    zero_crossing_rate: float = 0.0      # Noisiness indicator
    spectral_flatness: float = 0.0       # Noise vs tone (0=tone, 1=noise)
    
    # Click-free playback points
    zero_crossing_start: int = 0
    zero_crossing_end: int = 0
    
    # Optional metadata
    pitch_hz: Optional[float] = None
    note_name: Optional[str] = None
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'Slice':
        return cls(**data)


@dataclass
class SliceBank:
    """
    A collection of slices from a single audio source.
    
    The fundamental unit for the Trigger Engine to operate on.
    """
    id: str
    source_path: str
    source_filename: str
    role: SliceRole
    slices: List[Slice] = field(default_factory=list)
    
    # Global properties
    sample_rate: int = 44100
    total_duration: float = 0.0
    total_samples: int = 0
    bpm: Optional[float] = None
    key: Optional[str] = None
    
    # Statistics for weighted selection
    mean_energy: float = 0.0
    max_energy: float = 0.0
    energy_variance: float = 0.0
    
    def __len__(self) -> int:
        return len(self.slices)
    
    def get_slice(self, index: int) -> Slice:
        """Get slice by index (wraps around for continuous triggering)"""
        if not self.slices:
            raise ValueError("SliceBank is empty")
        return self.slices[index % len(self.slices)]
    
    def get_slice_by_time(self, time: float) -> Optional[Slice]:
        """Get the slice that contains this time position"""
        for s in self.slices:
            if s.start_time <= time < s.end_time:
                return s
        return None
    
    def get_slices_by_energy(self, min_energy: float = 0.0, max_energy: float = 1.0) -> List[Slice]:
        """Filter slices by energy range"""
        return [s for s in self.slices if min_energy <= s.rms_energy <= max_energy]
    
    def get_slices_by_brightness(self, min_centroid: float = 0, max_centroid: float = 20000) -> List[Slice]:
        """Filter slices by spectral centroid (brightness)"""
        return [s for s in self.slices if min_centroid <= s.spectral_centroid <= max_centroid]
    
    def get_random_weighted(
        self, 
        weight_by: str = 'energy', 
        temperature: float = 1.0,
        rng: Optional['random.Random'] = None
    ) -> Slice:
        """
        Get a random slice with probability weighted by an attribute.
        
        Args:
            weight_by: 'energy', 'transient', 'brightness', or 'uniform'
            temperature: Higher = more random, Lower = more biased toward high values
            rng: Optional seeded Random instance for reproducible selection
        """
        import random as random_module
        
        if not self.slices:
            raise ValueError("SliceBank is empty")
        
        # Use provided RNG or fall back to global random
        _rng = rng or random_module
        
        if weight_by == 'uniform':
            return _rng.choice(self.slices)
        
        # Get weights based on attribute
        if weight_by == 'energy':
            weights = [s.rms_energy for s in self.slices]
        elif weight_by == 'transient':
            weights = [s.transient_strength for s in self.slices]
        elif weight_by == 'brightness':
            weights = [s.spectral_centroid / 10000 for s in self.slices]  # Normalize
        else:
            weights = [1.0] * len(self.slices)
        
        # Apply temperature
        weights = np.array(weights) ** (1.0 / max(temperature, 0.01))
        
        # Normalize to probabilities
        weights = weights / (weights.sum() + 1e-8)
        
        # Use seeded selection if RNG provided
        if rng is not None:
            # Manual weighted selection using seeded RNG
            r = rng.random()
            cumsum = 0.0
            for i, w in enumerate(weights):
                cumsum += w
                if r <= cumsum:
                    return self.slices[i]
            return self.slices[-1]
        
        return np.random.choice(self.slices, p=weights)
    
    def to_dict(self) -> Dict:
        return {
            'id': self.id,
            'source_path': self.source_path,
            'source_filename': self.source_filename,
            'role': self.role.value,
            'slices': [s.to_dict() for s in self.slices],
            'sample_rate': self.sample_rate,
            'total_duration': self.total_duration,
            'total_samples': self.total_samples,
            'bpm': self.bpm,
            'key': self.key,
            'mean_energy': self.mean_energy,
            'max_energy': self.max_energy,
            'energy_variance': self.energy_variance,
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'SliceBank':
        slices = [Slice.from_dict(s) for s in data.get('slices', [])]
        return cls(
            id=data['id'],
            source_path=data['source_path'],
            source_filename=data['source_filename'],
            role=SliceRole(data['role']),
            slices=slices,
            sample_rate=data.get('sample_rate', 44100),
            total_duration=data.get('total_duration', 0.0),
            total_samples=data.get('total_samples', 0),
            bpm=data.get('bpm'),
            key=data.get('key'),
            mean_energy=data.get('mean_energy', 0.0),
            max_energy=data.get('max_energy', 0.0),
            energy_variance=data.get('energy_variance', 0.0),
        )
    
    def save(self, path: Path):
        """Save slice bank to JSON"""
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
    
    @classmethod
    def load(cls, path: Path) -> 'SliceBank':
        """Load slice bank from JSON"""
        with open(path, 'r') as f:
            return cls.from_dict(json.load(f))


class SliceEngine:
    """
    The core engine for slicing audio files.
    
    Detects transients using multiple algorithms and creates
    SliceBanks with rich spectral analysis for each slice.
    """
    
    def __init__(self, sr: int = 44100):
        self.sr = sr
        
        # Onset detection parameters (tuned for musical transients)
        self.onset_params = {
            'pre_max': 3,
            'post_max': 3,
            'pre_avg': 3,
            'post_avg': 5,
            'delta': 0.07,  # Sensitivity (lower = more onsets)
            'wait': 10,     # Minimum frames between onsets
        }
        
        # Role-specific parameters
        self.role_params = {
            SliceRole.DRUMS: {
                'delta': 0.05,   # More sensitive for drums
                'wait': 5,       # Allow rapid hits
                'min_slice_ms': 50,
            },
            SliceRole.BASS: {
                'delta': 0.1,    # Less sensitive
                'wait': 20,      # Bass notes are longer
                'min_slice_ms': 100,
            },
            SliceRole.VOCALS: {
                'delta': 0.15,   # Even less sensitive
                'wait': 30,      # Vocal phrases are longer
                'min_slice_ms': 200,
            },
            SliceRole.OTHER: {
                'delta': 0.08,
                'wait': 15,
                'min_slice_ms': 80,
            },
        }
    
    def load_audio(self, path: Path) -> Tuple[np.ndarray, int]:
        """Load audio file and return (audio, sample_rate)"""
        y, sr = librosa.load(str(path), sr=self.sr, mono=False)
        
        # Ensure we have the right shape
        if y.ndim == 1:
            y = np.stack([y, y])  # Mono to stereo
        elif y.shape[0] > 2:
            y = y[:2]  # Truncate to stereo
            
        return y, sr
    
    def detect_onsets(
        self, 
        y_mono: np.ndarray, 
        role: SliceRole = SliceRole.UNKNOWN
    ) -> np.ndarray:
        """
        Detect onset positions using multiple methods and consensus.
        
        Returns array of sample positions.
        """
        # Get role-specific parameters
        params = self.role_params.get(role, self.role_params[SliceRole.OTHER])
        
        # Method 1: Standard onset detection with onset envelope
        onset_env = librosa.onset.onset_strength(y=y_mono, sr=self.sr)
        onsets_1 = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=self.sr,
            units='samples',
            backtrack=True,
            delta=params['delta'],
            wait=params['wait'],
        )
        
        # Method 2: High-frequency content (better for percussive)
        # Use mel spectrogram with higher frequency emphasis
        onset_env_hfc = librosa.onset.onset_strength(
            y=y_mono, sr=self.sr,
            aggregate=np.median,
            fmax=8000,
        )
        onsets_2 = librosa.onset.onset_detect(
            onset_envelope=onset_env_hfc,
            sr=self.sr,
            units='samples',
            backtrack=True,
            delta=params['delta'] * 1.5,
            wait=params['wait'],
        )
        
        # Combine and deduplicate
        all_onsets = np.unique(np.concatenate([onsets_1, onsets_2]))
        
        # Filter onsets that are too close together
        min_samples = int(params['min_slice_ms'] * self.sr / 1000)
        filtered = [all_onsets[0]] if len(all_onsets) > 0 else []
        
        for onset in all_onsets[1:]:
            if onset - filtered[-1] >= min_samples:
                filtered.append(onset)
        
        return np.array(filtered)
    
    def analyze_slice(
        self, 
        y_mono: np.ndarray, 
        start: int, 
        end: int
    ) -> Dict:
        """
        Perform spectral analysis on a slice.
        
        Returns dictionary of analysis features.
        """
        chunk = y_mono[start:end]
        
        if len(chunk) < 512:
            # Too short for meaningful analysis
            return {
                'transient_strength': 0.0,
                'spectral_centroid': 0.0,
                'rms_energy': 0.0,
                'zero_crossing_rate': 0.0,
                'spectral_flatness': 0.0,
            }
        
        # RMS Energy
        rms = librosa.feature.rms(y=chunk)[0]
        rms_energy = float(np.mean(rms))
        
        # Transient strength (ratio of max to mean in onset envelope)
        onset_env = librosa.onset.onset_strength(y=chunk, sr=self.sr)
        if len(onset_env) > 0 and np.mean(onset_env) > 0:
            transient_strength = float(np.max(onset_env) / (np.mean(onset_env) + 1e-8))
            transient_strength = min(1.0, transient_strength / 10)  # Normalize
        else:
            transient_strength = 0.0
        
        # Spectral centroid (brightness)
        centroid = librosa.feature.spectral_centroid(y=chunk, sr=self.sr)[0]
        spectral_centroid = float(np.mean(centroid))
        
        # Zero crossing rate
        zcr = librosa.feature.zero_crossing_rate(chunk)[0]
        zero_crossing_rate = float(np.mean(zcr))
        
        # Spectral flatness
        flatness = librosa.feature.spectral_flatness(y=chunk)[0]
        spectral_flatness = float(np.mean(flatness))
        
        return {
            'transient_strength': transient_strength,
            'spectral_centroid': spectral_centroid,
            'rms_energy': rms_energy,
            'zero_crossing_rate': zero_crossing_rate,
            'spectral_flatness': spectral_flatness,
        }
    
    def find_zero_crossing(self, y: np.ndarray, position: int, window_ms: float = 5.0) -> int:
        """
        Find the nearest zero crossing to a position.
        
        This ensures click-free playback.
        """
        window_samples = int(window_ms * self.sr / 1000)
        
        start = max(0, position - window_samples)
        end = min(len(y), position + window_samples)
        
        region = y[start:end]
        
        # Find zero crossings
        zero_crossings = np.where(np.diff(np.signbit(region)))[0]
        
        if len(zero_crossings) == 0:
            return position  # No zero crossings found
        
        # Find closest to center
        center = position - start
        closest_idx = zero_crossings[np.argmin(np.abs(zero_crossings - center))]
        
        return start + closest_idx
    
    def create_slice_bank(
        self,
        audio_path: Path,
        role: SliceRole = SliceRole.UNKNOWN,
        bpm: Optional[float] = None,
        key: Optional[str] = None,
        min_slices: int = 4,
        max_slices: int = 128,
    ) -> SliceBank:
        """
        Create a SliceBank from an audio file.
        
        This is the main entry point for slicing.
        """
        import uuid
        
        # Load audio
        y, sr = self.load_audio(audio_path)
        y_mono = librosa.to_mono(y)
        
        total_samples = len(y_mono)
        total_duration = total_samples / sr
        
        # Detect onsets
        onsets = self.detect_onsets(y_mono, role)
        
        # Ensure we have reasonable number of slices
        if len(onsets) < min_slices:
            # Too few onsets - create evenly spaced slices
            num_slices = min_slices
            onsets = np.linspace(0, total_samples - 1, num_slices + 1).astype(int)[:-1]
        elif len(onsets) > max_slices:
            # Too many - keep the strongest
            onset_strengths = []
            onset_env = librosa.onset.onset_strength(y=y_mono, sr=sr)
            frames = librosa.samples_to_frames(onsets)
            for frame in frames:
                if frame < len(onset_env):
                    onset_strengths.append(onset_env[frame])
                else:
                    onset_strengths.append(0)
            
            # Keep top N by strength
            indices = np.argsort(onset_strengths)[-max_slices:]
            onsets = np.sort(onsets[indices])
        
        # Create slices
        slices = []
        for i, start in enumerate(onsets):
            # End is next onset or end of file
            if i < len(onsets) - 1:
                end = onsets[i + 1]
            else:
                end = total_samples
            
            # Find zero crossings for click-free playback
            zc_start = self.find_zero_crossing(y_mono, start)
            zc_end = self.find_zero_crossing(y_mono, end)
            
            # Analyze slice
            analysis = self.analyze_slice(y_mono, start, end)
            
            slice_obj = Slice(
                index=i,
                start_sample=int(start),
                end_sample=int(end),
                start_time=start / sr,
                end_time=end / sr,
                duration=(end - start) / sr,
                transient_strength=analysis['transient_strength'],
                spectral_centroid=analysis['spectral_centroid'],
                rms_energy=analysis['rms_energy'],
                zero_crossing_rate=analysis['zero_crossing_rate'],
                spectral_flatness=analysis['spectral_flatness'],
                zero_crossing_start=int(zc_start),
                zero_crossing_end=int(zc_end),
            )
            slices.append(slice_obj)
        
        # Calculate statistics
        energies = [s.rms_energy for s in slices]
        mean_energy = float(np.mean(energies)) if energies else 0.0
        max_energy = float(np.max(energies)) if energies else 0.0
        energy_variance = float(np.var(energies)) if energies else 0.0
        
        # Create bank
        bank = SliceBank(
            id=str(uuid.uuid4()),
            source_path=str(audio_path),
            source_filename=audio_path.name,
            role=role,
            slices=slices,
            sample_rate=sr,
            total_duration=total_duration,
            total_samples=total_samples,
            bpm=bpm,
            key=key,
            mean_energy=mean_energy,
            max_energy=max_energy,
            energy_variance=energy_variance,
        )
        
        return bank
    
    def export_slice(
        self,
        audio_path: Path,
        slice_obj: Slice,
        output_path: Path,
        use_zero_crossings: bool = True,
        fade_ms: float = 2.0,
    ) -> Path:
        """
        Export a single slice to a file.
        
        Args:
            audio_path: Source audio file
            slice_obj: The slice to export
            output_path: Where to save the slice
            use_zero_crossings: Use zero-crossing points for click-free export
            fade_ms: Fade in/out duration in milliseconds
        """
        y, sr = self.load_audio(audio_path)
        
        if use_zero_crossings:
            start = slice_obj.zero_crossing_start
            end = slice_obj.zero_crossing_end
        else:
            start = slice_obj.start_sample
            end = slice_obj.end_sample
        
        # Extract slice
        slice_audio = y[:, start:end].copy()
        
        # Apply fade
        fade_samples = int(fade_ms * sr / 1000)
        if slice_audio.shape[1] > fade_samples * 2:
            fade_in = np.linspace(0, 1, fade_samples)
            fade_out = np.linspace(1, 0, fade_samples)
            slice_audio[:, :fade_samples] *= fade_in
            slice_audio[:, -fade_samples:] *= fade_out
        
        # Save
        sf.write(str(output_path), slice_audio.T, sr)
        
        return output_path


# Convenience function for quick slicing
def slice_audio(
    audio_path: Path,
    role: str = "unknown",
    bpm: Optional[float] = None,
    key: Optional[str] = None,
) -> SliceBank:
    """
    Quick function to slice an audio file.
    
    Args:
        audio_path: Path to audio file
        role: One of 'drums', 'bass', 'vocals', 'other', 'unknown'
        bpm: BPM of the source (optional)
        key: Musical key (optional)
    
    Returns:
        SliceBank with detected slices
    """
    engine = SliceEngine()
    role_enum = SliceRole(role) if role in [r.value for r in SliceRole] else SliceRole.UNKNOWN
    return engine.create_slice_bank(audio_path, role_enum, bpm, key)
