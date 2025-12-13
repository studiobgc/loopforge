import torch
import numpy as np
import scipy.ndimage
from pathlib import Path
from typing import List, Dict
from app.engines.torch_utils import load_audio
from app.engines.torch_analysis import compute_rms, compute_spectral_flatness, compute_periodicity

class VocalSaliency:
    def __init__(self, sr=44100):
        self.sr = sr

    def analyze_catchiness(self, audio_path: Path) -> List[Dict]:
        """
        Analyzes a vocal stem to find the most 'catchy' or 'salient' parts.
        Heuristic: High energy + High tonality (singing) + Stable pitch.
        GPU-Accelerated for M3 Max.
        """
        # 1. Load to GPU
        y_tensor = load_audio(str(audio_path), sr=self.sr)
        
        # Convert to mono if stereo
        if y_tensor.shape[0] > 1:
            y_tensor = torch.mean(y_tensor, dim=0, keepdim=True)
            
        # 2. Compute Features on GPU
        hop_length = 512
        
        # RMS Energy
        rms_tensor = compute_rms(y_tensor, hop_length=hop_length)
        rms = rms_tensor.cpu().numpy()[0]
        
        # Spectral Flatness
        flatness_tensor = compute_spectral_flatness(y_tensor, hop_length=hop_length)
        flatness = flatness_tensor.cpu().numpy()[0]
        tonality = 1.0 - flatness
        
        # Periodicity (Voicedness) - Replaces slow pYIN
        periodicity_tensor = compute_periodicity(y_tensor, hop_length=hop_length)
        voiced_prob = periodicity_tensor.cpu().numpy()[0]
        
        # 3. Calculate Score
        # Normalize metrics
        def normalize(x):
            return (x - np.min(x)) / (np.max(x) - np.min(x) + 1e-10)
            
        rms_norm = normalize(rms)
        tonality_norm = normalize(tonality)
        voiced_norm = normalize(voiced_prob)
        
        # Combined score
        # Weighting: Singing (Tonality) is most important for "catchiness"
        saliency_curve = (rms_norm * 0.3) + (tonality_norm * 0.5) + (voiced_norm * 0.2)
        
        # Smooth the curve
        saliency_curve = scipy.ndimage.gaussian_filter1d(saliency_curve, sigma=20)
        
        # Find peaks/regions
        # We want 4-bar loops (approx 8s at 120bpm)
        window_size_sec = 8.0
        window_size_frames = int(window_size_sec * self.sr / hop_length)
        
        candidates = []
        
        # Sliding window
        if len(saliency_curve) > window_size_frames:
            # Vectorized window averaging for speed
            # Create a uniform kernel
            kernel = np.ones(window_size_frames) / window_size_frames
            windowed_scores = np.convolve(saliency_curve, kernel, mode='valid')
            
            # Find peaks in the windowed scores
            # Simple peak picking: find local maxima separated by window size
            peaks, _ = scipy.signal.find_peaks(windowed_scores, distance=window_size_frames//2)
            
            for i in peaks:
                score = windowed_scores[i]
                start_frame = i
                end_frame = i + window_size_frames
                
                # Convert frames to time
                # frame_index * hop / sr
                start_time = start_frame * hop_length / self.sr
                end_time = end_frame * hop_length / self.sr
                
                candidates.append({
                    "start_time": start_time,
                    "end_time": end_time,
                    "score": float(score)
                })
        
        # Sort by score
        candidates.sort(key=lambda x: x['score'], reverse=True)
        
        return candidates[:5] # Top 5 catchy moments
