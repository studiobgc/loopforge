"""
Grid Engine - Beat and downbeat detection for grid-aware slicing.

Uses Essentia's beat tracking algorithms for professional-grade
tempo and beat detection, enabling musical grid alignment.

Features:
- BPM detection with confidence scoring
- Beat positions (every beat)
- Downbeat positions (every bar start)
- Grid quantization for slice alignment
"""

import numpy as np
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
import librosa


@dataclass
class GridAnalysis:
    """
    Complete musical grid analysis for an audio file.
    """
    bpm: float
    bpm_confidence: float
    time_signature: Tuple[int, int]  # (beats_per_bar, beat_unit) e.g. (4, 4)
    
    # Beat positions in seconds
    beats: List[float]
    
    # Downbeat positions in seconds (first beat of each bar)
    downbeats: List[float]
    
    # Duration of the audio
    duration: float
    
    # Grid resolution in seconds (1 beat)
    beat_duration: float
    
    # Bar duration in seconds
    bar_duration: float
    
    def to_dict(self) -> Dict:
        return {
            **asdict(self),
            'time_signature': list(self.time_signature),
            'num_beats': len(self.beats),
            'num_bars': len(self.downbeats),
        }
    
    def quantize_to_beat(self, time: float, mode: str = 'nearest') -> float:
        """
        Quantize a time position to the nearest beat.
        
        Args:
            time: Time in seconds
            mode: 'nearest', 'floor', or 'ceil'
        """
        if not self.beats:
            return time
            
        beats_arr = np.array(self.beats)
        
        if mode == 'floor':
            idx = np.searchsorted(beats_arr, time, side='right') - 1
            return beats_arr[max(0, idx)]
        elif mode == 'ceil':
            idx = np.searchsorted(beats_arr, time, side='left')
            return beats_arr[min(idx, len(beats_arr) - 1)]
        else:  # nearest
            idx = np.abs(beats_arr - time).argmin()
            return beats_arr[idx]
    
    def quantize_to_downbeat(self, time: float, mode: str = 'nearest') -> float:
        """Quantize to nearest downbeat (bar start)"""
        if not self.downbeats:
            return time
            
        downbeats_arr = np.array(self.downbeats)
        
        if mode == 'floor':
            idx = np.searchsorted(downbeats_arr, time, side='right') - 1
            return downbeats_arr[max(0, idx)]
        elif mode == 'ceil':
            idx = np.searchsorted(downbeats_arr, time, side='left')
            return downbeats_arr[min(idx, len(downbeats_arr) - 1)]
        else:
            idx = np.abs(downbeats_arr - time).argmin()
            return downbeats_arr[idx]
    
    def get_beat_index(self, time: float) -> int:
        """Get the beat index (0-based) for a given time"""
        if not self.beats:
            return 0
        beats_arr = np.array(self.beats)
        idx = np.searchsorted(beats_arr, time, side='right') - 1
        return max(0, idx)
    
    def get_bar_beat(self, time: float) -> Tuple[int, int]:
        """
        Get bar and beat position for a time.
        Returns (bar_number, beat_within_bar) - both 0-indexed.
        """
        beat_idx = self.get_beat_index(time)
        beats_per_bar = self.time_signature[0]
        bar = beat_idx // beats_per_bar
        beat = beat_idx % beats_per_bar
        return (bar, beat)


class GridEngine:
    """
    Musical grid detection engine.
    
    Uses Essentia for beat tracking with librosa fallback.
    Optimized for M3 Max performance.
    """
    
    def __init__(self, sr: int = 44100):
        self.sr = sr
        self._essentia_available = self._check_essentia()
    
    def _check_essentia(self) -> bool:
        """Check if Essentia is available"""
        try:
            import essentia.standard as es
            return True
        except ImportError:
            print("[GRID] Essentia not available, using librosa fallback")
            return False
    
    def analyze(
        self, 
        audio_path: Path,
        time_signature: Tuple[int, int] = (4, 4),
    ) -> GridAnalysis:
        """
        Analyze audio file for beat grid.
        
        Args:
            audio_path: Path to audio file
            time_signature: Expected time signature (beats_per_bar, beat_unit)
        
        Returns:
            GridAnalysis with beats, downbeats, and BPM
        """
        # Load audio
        y, sr = librosa.load(str(audio_path), sr=self.sr, mono=True)
        duration = len(y) / sr
        
        if self._essentia_available:
            return self._analyze_essentia(y, sr, duration, time_signature)
        else:
            return self._analyze_librosa(y, sr, duration, time_signature)
    
    def _analyze_essentia(
        self, 
        y: np.ndarray, 
        sr: int,
        duration: float,
        time_signature: Tuple[int, int],
    ) -> GridAnalysis:
        """Essentia-based beat detection (more accurate)"""
        import essentia.standard as es
        
        # Essentia expects float32
        audio = y.astype(np.float32)
        
        # Beat tracking with RhythmExtractor2013 (state-of-the-art)
        rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
        bpm, beats, beats_confidence, _, beats_intervals = rhythm_extractor(audio)
        
        # BPM confidence from consistency of beat intervals
        if len(beats_intervals) > 1:
            interval_std = np.std(beats_intervals)
            interval_mean = np.mean(beats_intervals)
            bpm_confidence = max(0, 1 - (interval_std / (interval_mean + 1e-8)))
        else:
            bpm_confidence = 0.5
        
        # Convert beats to list
        beats_list = beats.tolist()
        
        # Estimate downbeats (every N beats based on time signature)
        beats_per_bar = time_signature[0]
        downbeats = []
        
        # Use BeatTrackerDegara for downbeat estimation if available
        try:
            beat_tracker = es.BeatTrackerDegara()
            degara_beats = beat_tracker(audio)
            
            # Find downbeats by grouping beats
            if len(degara_beats) >= beats_per_bar:
                # Simple heuristic: every Nth beat is a downbeat
                for i in range(0, len(beats_list), beats_per_bar):
                    if i < len(beats_list):
                        downbeats.append(beats_list[i])
        except Exception:
            # Fallback: every Nth beat
            for i in range(0, len(beats_list), beats_per_bar):
                if i < len(beats_list):
                    downbeats.append(beats_list[i])
        
        # Calculate durations
        beat_duration = 60.0 / bpm if bpm > 0 else 0.5
        bar_duration = beat_duration * beats_per_bar
        
        return GridAnalysis(
            bpm=float(bpm),
            bpm_confidence=float(bpm_confidence),
            time_signature=time_signature,
            beats=beats_list,
            downbeats=downbeats,
            duration=duration,
            beat_duration=beat_duration,
            bar_duration=bar_duration,
        )
    
    def _analyze_librosa(
        self, 
        y: np.ndarray, 
        sr: int,
        duration: float,
        time_signature: Tuple[int, int],
    ) -> GridAnalysis:
        """Librosa fallback for beat detection"""
        # Tempo and beat detection
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units='frames')
        
        # Handle tempo as array (librosa 0.10+)
        if hasattr(tempo, '__len__'):
            bpm = float(tempo[0]) if len(tempo) > 0 else 120.0
        else:
            bpm = float(tempo)
        
        # Convert frames to time
        beats_list = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        
        # Confidence from beat strength
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        if len(beat_frames) > 0:
            beat_strengths = onset_env[beat_frames[beat_frames < len(onset_env)]]
            bpm_confidence = float(np.mean(beat_strengths) / (np.max(onset_env) + 1e-8))
        else:
            bpm_confidence = 0.5
        
        # Downbeats
        beats_per_bar = time_signature[0]
        downbeats = [beats_list[i] for i in range(0, len(beats_list), beats_per_bar)]
        
        # Durations
        beat_duration = 60.0 / bpm if bpm > 0 else 0.5
        bar_duration = beat_duration * beats_per_bar
        
        return GridAnalysis(
            bpm=bpm,
            bpm_confidence=bpm_confidence,
            time_signature=time_signature,
            beats=beats_list,
            downbeats=downbeats,
            duration=duration,
            beat_duration=beat_duration,
            bar_duration=bar_duration,
        )
    
    def quantize_onsets_to_grid(
        self,
        onsets: List[float],
        grid: GridAnalysis,
        strength: float = 1.0,
        mode: str = 'nearest',
    ) -> List[float]:
        """
        Quantize onset times to the beat grid.
        
        Args:
            onsets: List of onset times in seconds
            grid: GridAnalysis from analyze()
            strength: 0.0 = no quantization, 1.0 = full snap to grid
            mode: 'nearest', 'floor', or 'ceil'
        
        Returns:
            Quantized onset times
        """
        if strength == 0 or not grid.beats:
            return onsets
        
        quantized = []
        for onset in onsets:
            grid_time = grid.quantize_to_beat(onset, mode)
            # Blend between original and quantized based on strength
            new_time = onset + (grid_time - onset) * strength
            quantized.append(new_time)
        
        return quantized


# Singleton instance
_grid_engine: Optional[GridEngine] = None


def get_grid_engine() -> GridEngine:
    """Get the grid engine singleton"""
    global _grid_engine
    if _grid_engine is None:
        _grid_engine = GridEngine()
    return _grid_engine
