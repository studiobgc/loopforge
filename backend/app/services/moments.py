"""
Moments Detection Service - Octatrack-style intelligent audio region detection

Detects and classifies "moments" in long audio files:
- Hits (transients / percussive)
- Phrases (vocal/melodic activity)  
- Textures (steady atmospheric beds)
- Changes (energy/brightness shifts)
"""

import numpy as np
import librosa
from dataclasses import dataclass, asdict
from enum import Enum
from typing import List, Optional
import uuid


class MomentType(str, Enum):
    HIT = "hit"
    PHRASE = "phrase"
    TEXTURE = "texture"
    CHANGE = "change"
    SILENCE = "silence"


@dataclass
class Moment:
    id: str
    type: MomentType
    start_time: float
    end_time: float
    duration: float
    energy: float
    brightness: float
    label: str
    confidence: float

    def to_dict(self):
        return {
            **asdict(self),
            "type": self.type.value,
        }


class MomentsDetector:
    """Fast, practical moment detection for long audio files."""

    def __init__(
        self,
        sr: int = 22050,
        hop_length: int = 512,
        min_moment_duration: float = 0.5,
        max_moment_duration: float = 30.0,
    ):
        self.sr = sr
        self.hop_length = hop_length
        self.min_moment_duration = min_moment_duration
        self.max_moment_duration = max_moment_duration

    def detect(self, audio_path: str, bias: str = "balanced") -> List[Moment]:
        """
        Detect moments in an audio file.
        
        Args:
            audio_path: Path to audio file
            bias: Detection bias - "hits", "phrases", "textures", or "balanced"
        
        Returns:
            List of detected Moment objects
        """
        # Load audio (downsampled for speed on long files)
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True)
        duration = len(y) / sr

        moments = []

        # 1) Detect transient hits
        if bias in ("hits", "balanced"):
            hits = self._detect_hits(y, sr)
            moments.extend(hits)

        # 2) Detect phrases (sustained energy regions)
        if bias in ("phrases", "balanced"):
            phrases = self._detect_phrases(y, sr)
            moments.extend(phrases)

        # 3) Detect textures (low-variance sustained regions)
        if bias in ("textures", "balanced"):
            textures = self._detect_textures(y, sr)
            moments.extend(textures)

        # 4) Detect energy/brightness changes
        changes = self._detect_changes(y, sr)
        moments.extend(changes)

        # Sort by start time and deduplicate overlaps
        moments = self._dedupe_moments(moments)
        moments.sort(key=lambda m: m.start_time)

        # Auto-label moments
        for i, m in enumerate(moments):
            m.label = self._generate_label(m, i)

        return moments

    def _detect_hits(self, y: np.ndarray, sr: int) -> List[Moment]:
        """
        Detect transient/percussive hits using multi-band onset detection.
        
        CTO-level: Uses both standard onset strength AND spectral flux for
        better accuracy on different types of transients. Spectral flux
        captures high-frequency content changes (cymbals, hi-hats) that
        standard onset detection might miss.
        """
        # Standard onset envelope
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=self.hop_length)
        
        # CTO-level: Also compute spectral flux for HF transients
        spectral_flux = librosa.onset.onset_strength(
            y=y, sr=sr, hop_length=self.hop_length,
            feature=librosa.feature.melspectrogram,
            fmin=2000,  # Focus on high frequencies
            fmax=sr // 2
        )
        
        # Combine both methods with weighted average
        combined_env = onset_env * 0.6 + spectral_flux * 0.4
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=combined_env,  # CTO-level: Use combined envelope
            sr=sr,
            hop_length=self.hop_length,
            backtrack=True,
        )
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=self.hop_length)

        # Compute RMS for energy
        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)[0]
        
        # Compute spectral centroid for brightness
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=self.hop_length)[0]

        hits = []
        for onset_time in onset_times:
            frame = int(onset_time * sr / self.hop_length)
            if frame >= len(rms):
                continue

            # Only keep strong transients
            local_rms = rms[max(0, frame - 2):frame + 3].mean() if frame < len(rms) else 0
            if local_rms < np.percentile(rms, 60):
                continue

            hit_duration = min(0.5, self.min_moment_duration)
            end_time = min(onset_time + hit_duration, len(y) / sr)

            hits.append(Moment(
                id=str(uuid.uuid4()),
                type=MomentType.HIT,
                start_time=onset_time,
                end_time=end_time,
                duration=end_time - onset_time,
                energy=float(local_rms),
                brightness=float(centroid[frame] / sr) if frame < len(centroid) else 0.5,
                label="",
                confidence=min(1.0, local_rms / (np.max(rms) + 1e-6)),
            ))

        return hits

    def _detect_phrases(self, y: np.ndarray, sr: int) -> List[Moment]:
        """Detect sustained melodic/vocal phrases."""
        # RMS energy
        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)[0]
        
        # Spectral flatness (lower = more tonal/voiced)
        flatness = librosa.feature.spectral_flatness(y=y, hop_length=self.hop_length)[0]
        
        # Spectral centroid
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=self.hop_length)[0]

        # Find regions with high energy + low flatness (tonal)
        energy_thresh = np.percentile(rms, 40)
        flatness_thresh = np.percentile(flatness, 60)

        in_phrase = False
        phrase_start = 0
        phrases = []

        frame_duration = self.hop_length / sr

        for i, (r, f) in enumerate(zip(rms, flatness)):
            is_tonal = r > energy_thresh and f < flatness_thresh
            time = i * frame_duration

            if is_tonal and not in_phrase:
                in_phrase = True
                phrase_start = time
            elif not is_tonal and in_phrase:
                in_phrase = False
                phrase_end = time
                duration = phrase_end - phrase_start

                if self.min_moment_duration <= duration <= self.max_moment_duration:
                    start_frame = int(phrase_start / frame_duration)
                    end_frame = int(phrase_end / frame_duration)
                    
                    phrases.append(Moment(
                        id=str(uuid.uuid4()),
                        type=MomentType.PHRASE,
                        start_time=phrase_start,
                        end_time=phrase_end,
                        duration=duration,
                        energy=float(rms[start_frame:end_frame].mean()),
                        brightness=float(centroid[start_frame:end_frame].mean() / sr),
                        label="",
                        confidence=0.7,
                    ))

        return phrases

    def _detect_textures(self, y: np.ndarray, sr: int) -> List[Moment]:
        """Detect atmospheric/textural regions (steady, low-variance)."""
        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)[0]
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=self.hop_length)[0]

        # Use a sliding window to find low-variance regions
        window_frames = int(2.0 * sr / self.hop_length)  # 2 second window
        frame_duration = self.hop_length / sr

        textures = []
        i = 0

        while i < len(rms) - window_frames:
            window_rms = rms[i:i + window_frames]
            variance = np.var(window_rms)
            mean_energy = np.mean(window_rms)

            # Low variance + some energy = texture
            # Guard against reshape failure: truncate to nearest multiple of chunk_size
            chunk_size = max(1, window_frames // 4)
            truncated_len = (len(rms) // chunk_size) * chunk_size
            if truncated_len < chunk_size:
                # Audio too short for texture detection
                break
            rms_chunks = rms[:truncated_len].reshape(-1, chunk_size)
            variance_threshold = np.percentile(np.var(rms_chunks, axis=1), 30)
            if variance < variance_threshold and mean_energy > np.percentile(rms, 20):
                start_time = i * frame_duration
                
                # Extend until variance increases
                end_frame = i + window_frames
                while end_frame < len(rms) - 1:
                    next_var = np.var(rms[end_frame:min(end_frame + window_frames // 2, len(rms))])
                    if next_var > variance * 3:
                        break
                    end_frame += window_frames // 4

                end_time = min(end_frame * frame_duration, len(y) / sr)
                duration = end_time - start_time

                if self.min_moment_duration <= duration <= self.max_moment_duration:
                    textures.append(Moment(
                        id=str(uuid.uuid4()),
                        type=MomentType.TEXTURE,
                        start_time=start_time,
                        end_time=end_time,
                        duration=duration,
                        energy=float(mean_energy),
                        brightness=float(centroid[i:end_frame].mean() / sr),
                        label="",
                        confidence=0.6,
                    ))

                i = end_frame
            else:
                i += window_frames // 2

        return textures

    def _detect_changes(self, y: np.ndarray, sr: int) -> List[Moment]:
        """Detect significant energy/timbral change points."""
        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)[0]
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=self.hop_length)[0]

        # Compute deltas
        rms_delta = np.abs(np.diff(rms))
        centroid_delta = np.abs(np.diff(centroid))

        # Normalize
        rms_delta_norm = rms_delta / (np.max(rms_delta) + 1e-6)
        centroid_delta_norm = centroid_delta / (np.max(centroid_delta) + 1e-6)

        # Combined change score
        change_score = rms_delta_norm * 0.6 + centroid_delta_norm * 0.4

        # Find peaks
        threshold = np.percentile(change_score, 90)
        frame_duration = self.hop_length / sr

        changes = []
        min_gap_frames = int(2.0 / frame_duration)  # 2 second minimum gap
        last_change_frame = -min_gap_frames

        for i, score in enumerate(change_score):
            if score > threshold and (i - last_change_frame) > min_gap_frames:
                time = i * frame_duration
                changes.append(Moment(
                    id=str(uuid.uuid4()),
                    type=MomentType.CHANGE,
                    start_time=time,
                    end_time=time + 0.1,
                    duration=0.1,
                    energy=float(rms[i]) if i < len(rms) else 0,
                    brightness=float(centroid[i] / sr) if i < len(centroid) else 0.5,
                    label="",
                    confidence=float(score),
                ))
                last_change_frame = i

        return changes

    def _dedupe_moments(self, moments: List[Moment]) -> List[Moment]:
        """Remove overlapping moments, preferring higher confidence."""
        if not moments:
            return []

        moments.sort(key=lambda m: (-m.confidence, m.start_time))
        kept = []
        
        for m in moments:
            overlaps = False
            for k in kept:
                if not (m.end_time < k.start_time or m.start_time > k.end_time):
                    # Check if same type and heavily overlapping
                    if m.type == k.type:
                        overlap = min(m.end_time, k.end_time) - max(m.start_time, k.start_time)
                        if overlap > min(m.duration, k.duration) * 0.5:
                            overlaps = True
                            break
            if not overlaps:
                kept.append(m)

        return kept

    def _generate_label(self, m: Moment, index: int) -> str:
        """Generate a human-readable label for a moment."""
        type_labels = {
            MomentType.HIT: "Hit",
            MomentType.PHRASE: "Phrase",
            MomentType.TEXTURE: "Texture",
            MomentType.CHANGE: "Change",
            MomentType.SILENCE: "Silence",
        }
        
        energy_desc = "loud" if m.energy > 0.5 else "soft" if m.energy > 0.2 else "quiet"
        brightness_desc = "bright" if m.brightness > 0.6 else "warm" if m.brightness > 0.3 else "dark"
        
        return f"{type_labels[m.type]} {index + 1} — {energy_desc}, {brightness_desc}"


def detect_moments(audio_path: str, bias: str = "balanced") -> List[dict]:
    """
    Convenience function to detect moments and return as dicts.
    
    Args:
        audio_path: Path to audio file
        bias: "hits", "phrases", "textures", or "balanced"
    
    Returns:
        List of moment dictionaries
    """
    detector = MomentsDetector()
    moments = detector.detect(audio_path, bias=bias)
    return [m.to_dict() for m in moments]
