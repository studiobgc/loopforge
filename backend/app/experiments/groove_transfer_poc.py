"""
Proof-of-Concept: Groove Transfer Engine
Demonstrates micro-timing extraction and application.
"""

import numpy as np
import librosa
from pathlib import Path
from typing import List, Tuple

class GrooveEngine:
    """
    Extract and transfer micro-timing (groove/swing/feel) between tracks.
    
    Unlike simple BPM matching, this preserves the HUMAN FEEL of timing.
    """
    
    def __init__(self, sr: int = 44100):
        self.sr = sr
    
    def extract_groove_template(
        self, 
        audio: np.ndarray,
        bpm: float
    ) -> List[float]:
        """
        Extract groove template (timing deviations from perfect grid).
        
        Returns:
            List of timing offsets (in seconds) for each detected onset
        """
        # Detect onsets
        onset_env = librosa.onset.onset_strength(y=audio, sr=self.sr)
        onsets = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=self.sr,
            units='time'
        )
        
        # Calculate perfect grid positions
        beat_duration = 60.0 / bpm
        subdivision = beat_duration / 4  # 16th note grid
        
        # For each onset, find nearest grid point and calculate offset
        groove_template = []
        
        for onset_time in onsets:
            # Find nearest grid position
            grid_position = round(onset_time / subdivision) * subdivision
            
            # Calculate deviation
            offset = onset_time - grid_position
            
            groove_template.append({
                'time': onset_time,
                'grid_position': grid_position,
                'offset': offset,
                'offset_ms': offset * 1000
            })
        
        return groove_template
    
    def apply_groove_template(
        self,
        audio: np.ndarray,
        target_bpm: float,
        groove_template: List[dict]
    ) -> np.ndarray:
        """
        Apply groove template to audio by time-warping onsets.
        
        This is complex - simplified version uses phase vocoder stretching
        at different rates in different regions.
        """
        # Detect onsets in target audio
        onset_env = librosa.onset.onset_strength(y=audio, sr=self.sr)
        target_onsets = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=self.sr,
            units='time'
        )
        
        # Build time-warp map
        # We want to shift each onset by the groove offset
        
        # Simplified: Apply average swing amount
        avg_offset = np.mean([g['offset'] for g in groove_template])
        
        print(f"  Average groove offset: {avg_offset * 1000:.2f}ms")
        print(f"  This groove is {'ahead' if avg_offset > 0 else 'behind'} the grid")
        
        # For full implementation, we'd use dynamic time warping
        # to align and warp each onset individually.
        # For now, return original (this is a proof-of-concept)
        
        return audio
    
    def analyze_groove_character(self, groove_template: List[dict]) -> dict:
        """
        Analyze groove characteristics for display/comparison.
        """
        offsets = [g['offset_ms'] for g in groove_template]
        
        return {
            'mean_offset_ms': np.mean(offsets),
            'std_offset_ms': np.std(offsets),
            'swing_amount': np.mean([abs(o) for o in offsets]),
            'tightness': 1.0 / (np.std(offsets) + 0.001),  # Inverse of variance
            'groove_type': 'swung' if np.mean(offsets) > 2 else 'straight'
        }


def demo_groove_transfer():
    """Demonstrate groove extraction and analysis."""
    
    print("🎵 GROOVE TRANSFER ENGINE - Proof of Concept")
    print("=" * 60)
    
    # Mock audio (sine wave with irregular timing)
    sr = 44100
    bpm = 120.0
    duration = 4.0
    
    # Create audio with intentional swing
    t = np.linspace(0, duration, int(sr * duration))
    audio = np.zeros_like(t)
    
    # Add "hits" with swing (every other 8th note is late)
    beat_duration = 60.0 / bpm
    eighth_note = beat_duration / 2
    
    for i in range(int(duration / eighth_note)):
        hit_time = i * eighth_note
        
        # Add swing: every other hit is 30ms late
        if i % 2 == 1:
            hit_time += 0.03  # 30ms swing
        
        # Create transient
        hit_sample = int(hit_time * sr)
        if hit_sample < len(audio):
            # Exponential decay hit
            decay = np.exp(-np.arange(2000) / 500)
            end_idx = min(hit_sample + 2000, len(audio))
            audio[hit_sample:end_idx] += decay[:end_idx - hit_sample]
    
    # Extract groove
    engine = GrooveEngine(sr=sr)
    
    print("\n📊 Extracting groove template...")
    groove_template = engine.extract_groove_template(audio, bpm)
    
    print(f"   Detected {len(groove_template)} onsets")
    print("\n   First 5 onsets:")
    for i, onset in enumerate(groove_template[:5]):
        print(f"     {i+1}. Time: {onset['time']:.3f}s | "
              f"Grid: {onset['grid_position']:.3f}s | "
              f"Offset: {onset['offset_ms']:+.1f}ms")
    
    # Analyze character
    print("\n🔬 Groove Analysis:")
    character = engine.analyze_groove_character(groove_template)
    for key, value in character.items():
        if isinstance(value, float):
            print(f"   {key}: {value:.2f}")
        else:
            print(f"   {key}: {value}")
    
    print("\n✅ Groove template extracted successfully!")
    print("   This template can now be applied to any other track.")
    print("\n💡 Real Implementation:")
    print("   - Use dynamic time warping to align target to template")
    print("   - Apply phase vocoder stretching per region")
    print("   - Preserve transient sharpness while shifting timing")


if __name__ == "__main__":
    demo_groove_transfer()
