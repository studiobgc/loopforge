"""
GrooveEngine - Micro-Timing Transfer System

Extract and apply the "human feel" (swing, shuffle, micro-timing) from one track to another.

Technical Approach:
1. Onset Detection: Detect all transients in source audio
2. Grid Analysis: Compare onset times to perfect quantized grid
3. Groove Template: Store timing deviations as a template
4. Dynamic Time Warping: Apply template to target audio while preserving transients
"""

import numpy as np
import librosa
import scipy.interpolate
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass


@dataclass
class GrooveTemplate:
    """
    Represents the micro-timing characteristics of a groove.
    """
    bpm: float
    onsets: np.ndarray              # Original onset times (seconds)
    grid_positions: np.ndarray      # Nearest grid positions (seconds)
    offsets: np.ndarray             # Timing deviations (seconds)
    subdivision: float              # Grid subdivision (e.g., 16th note duration)
    
    @property
    def swing_amount(self) -> float:
        """Average absolute deviation from grid."""
        return float(np.mean(np.abs(self.offsets)))
    
    @property
    def groove_type(self) -> str:
        """Classify groove type."""
        mean_offset = np.mean(self.offsets * 1000)  # ms
        if abs(mean_offset) < 5:
            return "straight"
        elif mean_offset > 5:
            return "laid_back"
        else:
            return "rushed"
    
    @property
    def tightness(self) -> float:
        """How consistent is the timing? (0-1, higher = tighter)"""
        std = np.std(self.offsets * 1000)  # ms
        # Normalize: 0ms std = 1.0 (perfect), 50ms std = 0.0 (loose)
        return float(np.clip(1.0 - (std / 50.0), 0, 1))


class GrooveEngine:
    """
    Engine for extracting and transferring groove (micro-timing) between audio tracks.
    
    This is the "secret sauce" that lets you make a quantized MIDI drum pattern
    feel like it was played by J Dilla.
    """
    
    def __init__(self, sr: int = 44100):
        self.sr = sr
    
    def extract_groove(
        self,
        audio: np.ndarray,
        bpm: float,
        subdivision: str = "16th"
    ) -> GrooveTemplate:
        """
        Extract groove template from audio.
        
        Args:
            audio: Input audio (mono)
            bpm: Tempo in BPM
            subdivision: Grid subdivision ('8th', '16th', '32nd')
        
        Returns:
            GrooveTemplate containing timing information
        """
        # Convert to mono if needed
        if audio.ndim > 1:
            audio = librosa.to_mono(audio)
        
        # Calculate grid parameters
        beat_duration = 60.0 / bpm
        subdivisions = {
            "8th": 2,
            "16th": 4,
            "32nd": 8,
            "triplet": 3
        }
        subdivision_factor = subdivisions.get(subdivision, 4)
        subdivision_duration = beat_duration / subdivision_factor
        
        # Detect onsets
        onset_env = librosa.onset.onset_strength(
            y=audio, 
            sr=self.sr,
            aggregate=np.median
        )
        
        onsets = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=self.sr,
            units='time',
            backtrack=True  # More accurate onset times
        )
        
        # Calculate grid positions and offsets
        grid_positions = np.zeros_like(onsets)
        offsets = np.zeros_like(onsets)
        
        for i, onset_time in enumerate(onsets):
            # Find nearest grid point
            grid_idx = np.round(onset_time / subdivision_duration)
            grid_pos = grid_idx * subdivision_duration
            
            grid_positions[i] = grid_pos
            offsets[i] = onset_time - grid_pos
        
        return GrooveTemplate(
            bpm=bpm,
            onsets=onsets,
            grid_positions=grid_positions,
            offsets=offsets,
            subdivision=subdivision_duration
        )
    
    def apply_groove(
        self,
        audio: np.ndarray,
        target_bpm: float,
        groove_template: GrooveTemplate,
        strength: float = 1.0
    ) -> np.ndarray:
        """
        Apply groove template to audio using dynamic time warping.
        
        Args:
            audio: Target audio to apply groove to
            target_bpm: BPM of target audio
            groove_template: Groove template to apply
            strength: How much groove to apply (0-1)
        
        Returns:
            Grooved audio
        """
        if audio.ndim > 1:
            audio = librosa.to_mono(audio)
        
        # Detect onsets in target
        onset_env = librosa.onset.onset_strength(y=audio, sr=self.sr)
        target_onsets = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=self.sr,
            units='time',
            backtrack=True
        )
        
        if len(target_onsets) == 0:
            return audio  # No onsets to groove
        
        # Build time-warp mapping
        # We'll create a mapping from old time to new time
        original_times = np.arange(len(audio)) / self.sr
        warped_times = original_times.copy()
        
        # For each onset in target, shift it by interpolated groove amount
        beat_duration = 60.0 / target_bpm
        
        for target_onset in target_onsets:
            # Find which beat this onset is on
            beat_position = target_onset / beat_duration
            
            # Find corresponding groove offset
            # Use modulo to loop the groove template
            template_length = groove_template.bpm * len(groove_template.offsets) / 60.0
            template_beat = beat_position % template_length
            
            # Interpolate offset from template
            template_beat_positions = groove_template.grid_positions / (60.0 / groove_template.bpm)
            
            if len(template_beat_positions) > 1:
                offset_interp = np.interp(
                    template_beat,
                    template_beat_positions % template_length,
                    groove_template.offsets
                )
            else:
                offset_interp = 0
            
            # Apply offset with strength
            offset = offset_interp * strength
            
            # Shift times around this onset
            onset_sample = int(target_onset * self.sr)
            window_size = int(0.1 * self.sr)  # 100ms window
            
            start_idx = max(0, onset_sample - window_size)
            end_idx = min(len(warped_times), onset_sample + window_size)
            
            # Create smooth transition using gaussian window
            indices = np.arange(start_idx, end_idx)
            center = onset_sample
            distances = np.abs(indices - center)
            weights = np.exp(-(distances ** 2) / (2 * (window_size / 3) ** 2))
            
            # Apply time shift
            warped_times[start_idx:end_idx] += offset * weights
        
        # Ensure monotonically increasing
        warped_times = np.maximum.accumulate(warped_times)
        
        # Resample audio using warped time mapping
        # We need to interpolate the audio at the new time positions
        sample_indices = warped_times * self.sr
        sample_indices = np.clip(sample_indices, 0, len(audio) - 1)
        
        # Interpolate
        warped_audio = np.interp(
            np.arange(len(audio)),
            sample_indices,
            audio
        )
        
        return warped_audio.astype(np.float32)
    
    def analyze_compatibility(
        self,
        groove_a: GrooveTemplate,
        groove_b: GrooveTemplate
    ) -> Dict[str, float]:
        """
        Analyze how compatible two grooves are.
        
        Returns metrics about groove similarity.
        """
        # Compare swing amounts
        swing_diff = abs(groove_a.swing_amount - groove_b.swing_amount)
        swing_similarity = 1.0 - np.clip(swing_diff / 0.05, 0, 1)  # 50ms max diff
        
        # Compare tightness
        tightness_diff = abs(groove_a.tightness - groove_b.tightness)
        tightness_similarity = 1.0 - tightness_diff
        
        # Overall compatibility
        compatibility = (swing_similarity + tightness_similarity) / 2
        
        return {
            'compatibility': float(compatibility),
            'swing_similarity': float(swing_similarity),
            'tightness_similarity': float(tightness_similarity),
            'swing_diff_ms': float(swing_diff * 1000),
            'recommendation': 'compatible' if compatibility > 0.7 else 'different_feel'
        }
    
    def visualize_groove(self, groove: GrooveTemplate) -> Dict:
        """
        Generate visualization data for groove display.
        
        Returns data suitable for plotting/UI display.
        """
        return {
            'bpm': groove.bpm,
            'type': groove.groove_type,
            'swing_amount_ms': groove.swing_amount * 1000,
            'tightness': groove.tightness,
            'onset_count': len(groove.onsets),
            'offsets_ms': (groove.offsets * 1000).tolist(),
            'histogram': {
                'bins': np.linspace(-50, 50, 20).tolist(),
                'counts': np.histogram(groove.offsets * 1000, bins=20)[0].tolist()
            }
        }
