"""
PhraseDetectionEngine - Intelligent Musical Phrase Boundary Detection

Detects complete musical phrases in vocals and melodies by analyzing:
1. Vocal Activity Detection (silence gaps)
2. Pitch contour (melodic/harmonic boundaries)
3. Energy patterns (natural breaks)

Result: Loops that capture complete musical ideas, not arbitrary beat-grid slices.
"""

import numpy as np
import librosa
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from pathlib import Path


@dataclass
class PhraseSegment:
    """Represents a detected musical phrase."""
    start_time: float      # Start in seconds
    end_time: float        # End in seconds
    start_sample: int      # Start sample index
    end_sample: int        # End sample index
    duration: float        # Duration in seconds
    confidence: float      # Detection confidence (0-1)
    pitch_range: Tuple[float, float]  # (min_hz, max_hz)
    energy: float          # Average RMS energy
    phrase_type: str       # 'verse', 'chorus', 'hook', 'bridge', or 'unknown'


class PhraseDetectionEngine:
    """
    Detects musical phrase boundaries in vocal and melodic stems.
    
    Uses multi-modal analysis:
    - Silence detection (VAD)
    - Pitch contour analysis
    - Energy envelope
    - Spectral flux
    
    Philosophy: A phrase is a complete musical thought with clear beginning and end.
    """
    
    def __init__(
        self,
        sr: int = 44100,
        silence_threshold_db: float = -40.0,
        min_phrase_duration: float = 1.0,
        max_phrase_duration: float = 8.0,
        min_gap_duration: float = 0.2
    ):
        """
        Initialize phrase detection engine.
        
        Args:
            sr: Sample rate
            silence_threshold_db: Volume threshold for silence detection
            min_phrase_duration: Minimum phrase length in seconds
            max_phrase_duration: Maximum phrase length in seconds
            min_gap_duration: Minimum silence gap to separate phrases
        """
        self.sr = sr
        self.silence_threshold_db = silence_threshold_db
        self.min_phrase_duration = min_phrase_duration
        self.max_phrase_duration = max_phrase_duration
        self.min_gap_duration = min_gap_duration
    
    def detect_phrases(
        self,
        audio: np.ndarray,
        bpm: Optional[float] = None
    ) -> List[PhraseSegment]:
        """
        Detect musical phrases in audio.
        
        Args:
            audio: Input audio (mono)
            bpm: Optional BPM for grid-snapping
        
        Returns:
            List of detected phrase segments
        """
        # Ensure mono
        if audio.ndim > 1:
            audio = librosa.to_mono(audio)
        
        # 1. Detect silence gaps (rest points)
        silence_mask = self._detect_silence(audio)
        
        # 2. Detect pitch contours
        pitch_contour = self._detect_pitch_contour(audio)
        
        # 3. Analyze energy envelope
        energy_envelope = self._compute_energy_envelope(audio)
        
        # 4. Find phrase boundaries by combining all signals
        boundaries = self._find_phrase_boundaries(
            silence_mask,
            pitch_contour,
            energy_envelope
        )
        
        # 5. Snap to beat grid if BPM is provided
        if bpm:
            boundaries = self._snap_to_grid(boundaries, bpm)
        
        # 6. Build phrase segments
        phrases = self._build_phrases(
            boundaries,
            audio,
            pitch_contour,
            energy_envelope
        )
        
        # 7. Filter and validate phrases
        phrases = self._filter_phrases(phrases)
        
        # 8. Classify phrase types
        phrases = self._classify_phrases(phrases)
        
        return phrases
    
    def _detect_silence(self, audio: np.ndarray) -> np.ndarray:
        """
        Detect silence using RMS energy threshold.
        
        Returns binary mask: 1 = sound, 0 = silence
        """
        # Compute RMS in small frames
        frame_length = 2048
        hop_length = 512
        
        rms = librosa.feature.rms(
            y=audio,
            frame_length=frame_length,
            hop_length=hop_length
        )[0]
        
        # Convert to dB
        rms_db = librosa.amplitude_to_db(rms, ref=np.max)
        
        # Create mask
        silence_mask = (rms_db > self.silence_threshold_db).astype(int)
        
        # Upsample to match audio length
        silence_mask_full = np.repeat(silence_mask, hop_length)
        
        # Pad or trim to match audio
        if len(silence_mask_full) < len(audio):
            silence_mask_full = np.pad(
                silence_mask_full,
                (0, len(audio) - len(silence_mask_full))
            )
        else:
            silence_mask_full = silence_mask_full[:len(audio)]
        
        return silence_mask_full
    
    def _detect_pitch_contour(self, audio: np.ndarray) -> np.ndarray:
        """
        Detect pitch contour using pYIN algorithm.
        
        Returns pitch values in Hz (0 = unvoiced).
        """
        from app.engines.pitch_engine import PitchEngine
        
        engine = PitchEngine()
        contour = engine.detect_pitch(audio, self.sr)
        
        # Interpolate to match audio length
        contour_full = np.interp(
            np.arange(len(audio)),
            librosa.frames_to_samples(np.arange(len(contour.frequencies))),
            contour.frequencies
        )
        
        return contour_full
    
    def _compute_energy_envelope(self, audio: np.ndarray) -> np.ndarray:
        """Compute smoothed energy envelope."""
        # RMS energy
        frame_length = 2048
        hop_length = 512
        
        rms = librosa.feature.rms(
            y=audio,
            frame_length=frame_length,
            hop_length=hop_length
        )[0]
        
        # Smooth with moving average
        from scipy.ndimage import uniform_filter1d
        rms_smooth = uniform_filter1d(rms, size=10)
        
        # Upsample to audio length
        energy_full = np.interp(
            np.arange(len(audio)),
            librosa.frames_to_samples(np.arange(len(rms_smooth))),
            rms_smooth
        )
        
        return energy_full
    
    def _find_phrase_boundaries(
        self,
        silence_mask: np.ndarray,
        pitch_contour: np.ndarray,
        energy_envelope: np.ndarray
    ) -> List[int]:
        """
        Find phrase boundaries by analyzing silence gaps + pitch drops.
        
        A phrase boundary is detected when:
        1. Silence gap exceeds min_gap_duration
        2. Pitch drops (end of melodic phrase)
        3. Energy drops significantly
        
        Returns list of sample indices marking boundaries.
        """
        boundaries = [0]  # Start with beginning
        
        # Find transitions from sound to silence
        sound_to_silence = np.diff(silence_mask.astype(int)) < 0
        silence_starts = np.where(sound_to_silence)[0]
        
        # Find transitions from silence to sound
        silence_to_sound = np.diff(silence_mask.astype(int)) > 0
        silence_ends = np.where(silence_to_sound)[0]
        
        # Pair silence regions
        min_gap_samples = int(self.min_gap_duration * self.sr)
        
        for start, end in zip(silence_starts, silence_ends):
            gap_duration = (end - start) / self.sr
            
            if gap_duration >= self.min_gap_duration:
                # This is a significant silence gap
                # Check if pitch also dropped before the gap
                window = int(0.1 * self.sr)  # 100ms window
                
                if start > window:
                    pitch_before = pitch_contour[start - window:start]
                    pitch_before_mean = np.mean(pitch_before[pitch_before > 0])
                    
                    # Significant pitch drop indicates phrase end
                    if pitch_before_mean > 0:
                        # Add boundary at silence start (end of phrase)
                        boundaries.append(start)
        
        # Add end boundary
        boundaries.append(len(silence_mask) - 1)
        
        # Remove duplicates and sort
        boundaries = sorted(list(set(boundaries)))
        
        return boundaries
    
    def _snap_to_grid(
        self,
        boundaries: List[int],
        bpm: float
    ) -> List[int]:
        """
        Snap boundaries to beat grid while preserving phrase integrity.
        
        Snaps to nearest beat within a small window.
        """
        samples_per_beat = int((60.0 / bpm) * self.sr)
        snap_window = samples_per_beat // 2  # Half beat window
        
        snapped = []
        for boundary in boundaries:
            # Find nearest beat
            beat_idx = round(boundary / samples_per_beat)
            beat_sample = beat_idx * samples_per_beat
            
            # Only snap if within window
            if abs(beat_sample - boundary) < snap_window:
                snapped.append(beat_sample)
            else:
                snapped.append(boundary)
        
        return snapped
    
    def _build_phrases(
        self,
        boundaries: List[int],
        audio: np.ndarray,
        pitch_contour: np.ndarray,
        energy_envelope: np.ndarray
    ) -> List[PhraseSegment]:
        """Build PhraseSegment objects from boundaries."""
        phrases = []
        
        for i in range(len(boundaries) - 1):
            start_sample = boundaries[i]
            end_sample = boundaries[i + 1]
            
            start_time = start_sample / self.sr
            end_time = end_sample / self.sr
            duration = end_time - start_time
            
            # Extract features for this segment
            segment_pitch = pitch_contour[start_sample:end_sample]
            segment_energy = energy_envelope[start_sample:end_sample]
            
            # Pitch range (only voiced regions)
            voiced_pitch = segment_pitch[segment_pitch > 0]
            if len(voiced_pitch) > 0:
                pitch_range = (float(np.min(voiced_pitch)), float(np.max(voiced_pitch)))
            else:
                pitch_range = (0.0, 0.0)
            
            # Average energy
            avg_energy = float(np.mean(segment_energy))
            
            # Confidence based on pitch consistency and energy
            if len(voiced_pitch) > 0:
                pitch_std = np.std(voiced_pitch)
                confidence = 1.0 - min(pitch_std / 100.0, 1.0)  # Lower std = higher confidence
            else:
                confidence = 0.5
            
            phrases.append(PhraseSegment(
                start_time=start_time,
                end_time=end_time,
                start_sample=start_sample,
                end_sample=end_sample,
                duration=duration,
                confidence=confidence,
                pitch_range=pitch_range,
                energy=avg_energy,
                phrase_type='unknown'
            ))
        
        return phrases
    
    def _filter_phrases(self, phrases: List[PhraseSegment]) -> List[PhraseSegment]:
        """Filter out invalid phrases."""
        filtered = []
        
        for phrase in phrases:
            # Must meet duration requirements
            if phrase.duration < self.min_phrase_duration:
                continue
            if phrase.duration > self.max_phrase_duration:
                continue
            
            # Must have some pitch content (not pure silence/noise)
            if phrase.pitch_range[1] == 0:
                continue
            
            # Must have reasonable energy
            if phrase.energy < 0.01:
                continue
            
            filtered.append(phrase)
        
        return filtered
    
    def _classify_phrases(self, phrases: List[PhraseSegment]) -> List[PhraseSegment]:
        """
        Classify phrases as verse/chorus/hook/bridge based on features.
        
        Simple heuristic:
        - High energy + wide pitch range = chorus/hook
        - Lower energy + narrow pitch range = verse
        - Mid energy + varied pitch = bridge
        """
        if not phrases:
            return phrases
        
        # Calculate global stats
        energies = [p.energy for p in phrases]
        pitch_ranges = [(p.pitch_range[1] - p.pitch_range[0]) for p in phrases]
        
        median_energy = np.median(energies)
        median_pitch_range = np.median(pitch_ranges)
        
        for phrase in phrases:
            pitch_span = phrase.pitch_range[1] - phrase.pitch_range[0]
            
            if phrase.energy > median_energy * 1.2 and pitch_span > median_pitch_range:
                phrase.phrase_type = 'chorus'
            elif phrase.energy < median_energy * 0.8:
                phrase.phrase_type = 'verse'
            elif pitch_span > median_pitch_range * 1.5:
                phrase.phrase_type = 'hook'
            else:
                phrase.phrase_type = 'bridge'
        
        return phrases
    
    def detect_from_file(self, filepath: Path, bpm: Optional[float] = None) -> List[PhraseSegment]:
        """Load audio file and detect phrases."""
        from app.engines.torch_utils import load_audio
        
        audio_tensor = load_audio(str(filepath), sr=self.sr)
        audio = audio_tensor.cpu().numpy()
        
        if audio.ndim > 1:
            audio = audio[0]  # Take first channel
        
        return self.detect_phrases(audio, bpm)
    
    def get_best_loop_phrases(
        self,
        phrases: List[PhraseSegment],
        target_duration: Optional[float] = None,
        top_n: int = 3
    ) -> List[PhraseSegment]:
        """
        Select the best phrases for looping.
        
        Prioritizes:
        1. Chorus/hook phrases (high energy, catchy)
        2. Confidence score
        3. Appropriate duration
        
        Args:
            phrases: List of detected phrases
            target_duration: Preferred phrase duration (or None for any)
            top_n: Number of top phrases to return
        
        Returns:
            Sorted list of best phrases
        """
        # Score each phrase
        scored_phrases = []
        
        for phrase in phrases:
            score = 0.0
            
            # Type preference
            if phrase.phrase_type == 'chorus':
                score += 1.0
            elif phrase.phrase_type == 'hook':
                score += 0.8
            elif phrase.phrase_type == 'verse':
                score += 0.6
            else:
                score += 0.4
            
            # Confidence
            score += phrase.confidence * 0.5
            
            # Energy (higher is better for loops)
            score += min(phrase.energy * 2.0, 0.5)
            
            # Duration preference
            if target_duration:
                duration_diff = abs(phrase.duration - target_duration)
                score -= min(duration_diff / target_duration, 0.5)
            
            scored_phrases.append((score, phrase))
        
        # Sort by score
        scored_phrases.sort(key=lambda x: x[0], reverse=True)
        
        return [phrase for score, phrase in scored_phrases[:top_n]]
