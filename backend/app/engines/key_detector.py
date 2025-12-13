"""
KeyDetector Engine
Professional-grade key detection using chromagram analysis.

Uses Krumhansl-Schmuckler key-finding algorithm with
HPCP-style chromagram extraction for accurate results.
"""

import numpy as np
from pathlib import Path
from typing import Optional, Callable
from dataclasses import dataclass
import librosa


@dataclass
class KeyResult:
    """Result of key detection analysis."""
    key: str                    # e.g., "C", "F#"
    mode: str                   # "major" or "minor"
    confidence: float           # 0.0 - 1.0
    correlation: float          # Raw correlation score
    alternate_key: str          # Second-best guess
    alternate_mode: str
    alternate_confidence: float
    bpm: Optional[float] = None
    
    @property
    def full_key(self) -> str:
        return f"{self.key} {self.mode}"
    
    def to_dict(self) -> dict:
        return {
            'key': self.key,
            'mode': self.mode,
            'full_key': self.full_key,
            'confidence': round(self.confidence, 3),
            'alternate': f"{self.alternate_key} {self.alternate_mode}",
            'alternate_confidence': round(self.alternate_confidence, 3),
            'bpm': round(self.bpm, 1) if self.bpm else None
        }


class KeyDetector:
    """
    Advanced key detection engine using chromagram analysis
    and Krumhansl-Schmuckler key profiles.
    
    Features:
    - HPCP-style chromagram extraction
    - Major/minor mode detection
    - Confidence scoring
    - BPM estimation
    - Batch processing support
    """
    
    # Krumhansl-Schmuckler key profiles (normalized)
    # These are empirically-derived profiles for major/minor keys
    MAJOR_PROFILE = np.array([
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
        2.52, 5.19, 2.39, 3.66, 2.29, 2.88
    ])
    MINOR_PROFILE = np.array([
        6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
        2.54, 4.75, 3.98, 2.69, 3.34, 3.17
    ])
    
    # Note names for output
    NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 
                  'F#', 'G', 'G#', 'A', 'A#', 'B']
    
    def __init__(self, hop_length: int = 512, n_chroma: int = 12):
        """
        Initialize key detector.
        
        Args:
            hop_length: STFT hop length (affects temporal resolution)
            n_chroma: Number of chroma bins (12 = standard semitones)
        """
        self.hop_length = hop_length
        self.n_chroma = n_chroma
        
        # Normalize profiles
        self.major_profile = self.MAJOR_PROFILE / np.linalg.norm(self.MAJOR_PROFILE)
        self.minor_profile = self.MINOR_PROFILE / np.linalg.norm(self.MINOR_PROFILE)
    
    def detect_key(
        self, 
        audio: np.ndarray, 
        sr: int,
        estimate_bpm: bool = True,
        use_essentia: bool = True
    ) -> KeyResult:
        """
        Detect musical key from audio using Ensemble (Essentia + Librosa).
        
        Combines Librosa's CQT-based detection with Essentia's HPCP algorithm
        for maximum accuracy on polyphonic sources.
        
        Args:
            audio: Audio waveform (mono or stereo)
            sr: Sample rate
            estimate_bpm: Whether to also estimate tempo
            
        Returns:
            KeyResult with detected key, mode, and confidence
        """
        # Convert to mono if stereo
        if audio.ndim > 1:
            audio = librosa.to_mono(audio)
        
        # 1. Essentia Detection (Primary)
        essentia_data = None
        if use_essentia:
            try:
                import essentia.standard as es
                
                # Essentia expects float32
                audio_f32 = audio.astype(np.float32)
                
                # Use the 'Key' algorithm which handles the full pipeline
                # profileType='edma' is best for electronic/pop
                key_algo = es.Key(
                    profileType='edma', 
                    numHarmonics=4, 
                    slope=0.6, 
                    usePolyphony=True, 
                    useThreeChords=True
                )
                
                key, scale, strength, first_cand, first_score, second_cand, second_score = key_algo(audio_f32)
                
                essentia_data = {
                    'key': key,
                    'mode': scale, # 'major' or 'minor'
                    'confidence': strength,
                    'alt_key': second_cand, # might be key string or index? usually string in high-level algo
                    'alt_score': second_score
                }
                
            except ImportError:
                # print("[KEY] Essentia not installed, using Librosa only")
                pass
            except Exception as e:
                print(f"[KEY] Essentia detection failed: {e}")
        
        # 2. Librosa Detection (Secondary/Fallback)
        # Extract chromagram using CQT (better frequency resolution)
        chroma = librosa.feature.chroma_cqt(
            y=audio, 
            sr=sr,
            hop_length=self.hop_length,
            n_chroma=self.n_chroma,
            bins_per_octave=36  # High resolution
        )
        
        # Average chroma across time (weighted by energy)
        chroma_mean = np.mean(chroma, axis=1)
        chroma_norm = np.linalg.norm(chroma_mean)
        if not np.isfinite(chroma_norm) or chroma_norm == 0:
            chroma_mean = np.ones(self.n_chroma) / np.sqrt(self.n_chroma)
        else:
            chroma_mean = chroma_mean / chroma_norm
        
        # Correlate with all possible key profiles
        correlations = []
        
        for shift in range(12):
            rotated = np.roll(chroma_mean, -shift)
            major_corr = np.corrcoef(rotated, self.major_profile)[0, 1]
            correlations.append((shift, 'major', major_corr))
            minor_corr = np.corrcoef(rotated, self.minor_profile)[0, 1]
            correlations.append((shift, 'minor', minor_corr))
        
        correlations.sort(key=lambda x: x[2], reverse=True)
        
        best_shift, best_mode, best_corr = correlations[0]
        alt_shift, alt_mode, alt_corr = correlations[1]
        
        # Calculate Librosa confidence
        all_corrs = np.array([c[2] for c in correlations])
        librosa_confidence = np.exp(best_corr) / np.sum(np.exp(all_corrs))
        librosa_alt_confidence = np.exp(alt_corr) / np.sum(np.exp(all_corrs))
        
        librosa_key = self.NOTE_NAMES[best_shift]
        librosa_alt_key = self.NOTE_NAMES[alt_shift]
        
        # 3. Ensemble Decision
        final_key = librosa_key
        final_mode = best_mode
        final_confidence = float(librosa_confidence)
        final_alt_key = librosa_alt_key
        final_alt_mode = alt_mode
        final_alt_conf = float(librosa_alt_confidence)
        
        if essentia_data:
            # Normalize Essentia key names if needed (Essentia uses standard names)
            # If they agree, boost confidence
            if essentia_data['key'] == librosa_key and essentia_data['mode'] == best_mode:
                final_confidence = min(1.0, (final_confidence + essentia_data['confidence']) / 1.5)
            else:
                # Disagreement: Prefer Essentia for confidence > 0.6, else average or stick to Librosa
                # Essentia is generally better for polyphonic audio
                if essentia_data['confidence'] > 0.5:
                    final_key = essentia_data['key']
                    final_mode = essentia_data['mode']
                    final_confidence = essentia_data['confidence']
                    
                    # Set Librosa result as alternate
                    final_alt_key = librosa_key
                    final_alt_mode = best_mode
                    final_alt_conf = librosa_confidence
        
        # Estimate BPM if requested
        bpm = None
        if estimate_bpm:
            tempo, _ = librosa.beat.beat_track(y=audio, sr=sr)
            bpm = float(tempo) if np.isscalar(tempo) else float(tempo[0])
        
        return KeyResult(
            key=final_key,
            mode=final_mode,
            confidence=float(final_confidence),
            correlation=float(best_corr), # Keep raw correlation from Librosa as metric
            alternate_key=final_alt_key,
            alternate_mode=final_alt_mode,
            alternate_confidence=float(final_alt_conf),
            bpm=bpm
        )
    
    def detect_from_file(
        self, 
        filepath: Path,
        estimate_bpm: bool = True
    ) -> KeyResult:
        """Load audio from file and detect key."""
        audio, sr = librosa.load(str(filepath), sr=None, mono=True)
        return self.detect_key(audio, sr, estimate_bpm)
    
    def batch_detect(
        self,
        filepaths: list[Path],
        progress_callback: Optional[Callable[[int, int, str], None]] = None
    ) -> list[dict]:
        """
        Batch key detection for multiple files.
        
        Args:
            filepaths: List of audio file paths
            progress_callback: Optional callback(current, total, filename)
            
        Returns:
            List of key detection results as dicts
        """
        results = []
        total = len(filepaths)
        
        for i, filepath in enumerate(filepaths):
            if progress_callback:
                progress_callback(i + 1, total, filepath.name)
            
            try:
                result = self.detect_from_file(filepath)
                results.append({
                    'filename': filepath.name,
                    'status': 'success',
                    **result.to_dict()
                })
            except Exception as e:
                results.append({
                    'filename': filepath.name,
                    'status': 'error',
                    'error': str(e)
                })
        
        return results
    
    @staticmethod
    def get_scale_pitches(key: str, mode: str) -> list[int]:
        """
        Get MIDI pitch classes for a given key/mode.
        Useful for pitch snapping in auto-tune.
        
        Args:
            key: Root note (e.g., "C", "F#")
            mode: "major" or "minor"
            
        Returns:
            List of pitch classes (0-11) in the scale
        """
        note_to_num = {
            'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
            'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
            'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
        }
        
        # Scale intervals (semitones from root)
        major_intervals = [0, 2, 4, 5, 7, 9, 11]
        minor_intervals = [0, 2, 3, 5, 7, 8, 10]  # Natural minor
        
        root = note_to_num.get(key, 0)
        intervals = major_intervals if mode == 'major' else minor_intervals
        
        return [(root + i) % 12 for i in intervals]
    
    @staticmethod
    def pitch_to_nearest_scale(
        pitch_hz: float, 
        scale_pitches: list[int],
        reference_a4: float = 440.0
    ) -> tuple[float, int]:
        """
        Snap a pitch to the nearest note in a scale.
        
        Args:
            pitch_hz: Input pitch in Hz
            scale_pitches: List of pitch classes (0-11) in target scale
            reference_a4: Reference frequency for A4
            
        Returns:
            (snapped_pitch_hz, shift_cents)
        """
        if pitch_hz <= 0:
            return pitch_hz, 0
        
        # Convert Hz to MIDI note number
        midi_note = 12 * np.log2(pitch_hz / reference_a4) + 69
        
        # Get pitch class (0-11)
        pitch_class = int(round(midi_note)) % 12
        octave = int(round(midi_note)) // 12
        
        # Find nearest pitch class in scale
        min_distance = 12
        nearest_pc = pitch_class
        
        for pc in scale_pitches:
            # Distance considering wrap-around
            dist = min(abs(pc - pitch_class), 12 - abs(pc - pitch_class))
            if dist < min_distance:
                min_distance = dist
                nearest_pc = pc
        
        # Reconstruct MIDI note
        target_midi = octave * 12 + nearest_pc
        
        # Handle wrap-around at octave boundaries
        if nearest_pc < pitch_class and pitch_class - nearest_pc > 6:
            target_midi += 12
        elif nearest_pc > pitch_class and nearest_pc - pitch_class > 6:
            target_midi -= 12
        
        # Convert back to Hz
        target_hz = reference_a4 * (2 ** ((target_midi - 69) / 12))
        
        # Calculate shift in cents
        shift_cents = 1200 * np.log2(target_hz / pitch_hz)
        
        return target_hz, int(round(shift_cents))
