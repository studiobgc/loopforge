import librosa
import numpy as np
import scipy.ndimage
from pathlib import Path
from typing import List, Dict, Tuple
from sklearn.cluster import AgglomerativeClustering

class StructureEngine:
    def __init__(self, sr=44100):
        self.sr = sr

    def analyze_structure(self, audio_path: Path) -> List[Dict]:
        """
        Analyzes the audio file to find repeating sections (Verse, Chorus, etc.)
        using Self-Similarity Matrices (SSM) and Clustering.
        """
        from app.engines.torch_utils import load_audio
        tensor = load_audio(str(audio_path), sr=self.sr)
        y = tensor.cpu().numpy()
        if y.ndim == 2:
            y = np.mean(y, axis=0) # Mono for structure analysis
        sr = self.sr
        
        # 1. Feature Extraction (MFCC + Chroma)
        # We use a large hop length for "macro" structure
        hop_length = 1024
        S = np.abs(librosa.stft(y, hop_length=hop_length))
        
        # Chroma for harmonic content (chords)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
        # MFCC for timbral content (instruments)
        mfcc = librosa.feature.mfcc(S=librosa.power_to_db(S), n_mfcc=13)
        
        # Stack features
        features = np.vstack([chroma, mfcc])
        
        # 2. Self-Similarity Matrix (SSM)
        # Recurrence matrix shows where the song repeats itself
        R = librosa.segment.recurrence_matrix(features, width=3, mode='affinity', sym=True)
        
        # Filter to remove diagonals (self-similarity at t=0) and noise
        df = librosa.segment.timelag_filter(scipy.ndimage.median_filter(R, size=(1, 7)))
        
        # 3. Clustering (Finding Sections)
        # We want to group time segments that are similar
        # Agglomerative Clustering on the features
        # Number of clusters = roughly number of song parts (Verse, Chorus, Bridge ~ 3-4)
        n_clusters = 4 
        
        # Synchronize features to beats for cleaner segmentation
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beats, sr=sr)
        
        # Sync features to beats
        features_sync = librosa.util.sync(features, beats)
        
        # Cluster the beat-synced features
        from sklearn.metrics import silhouette_score
        
        best_n = 3
        best_score = -1
        best_labels = None
        
        # Dynamic Cluster Selection (The "Ear" tunes itself)
        # We try 2 to 6 clusters (Verse, Chorus, Bridge, Pre, Outro, etc.)
        for n in range(2, 7):
            model = AgglomerativeClustering(n_clusters=n, linkage='ward')
            curr_labels = model.fit_predict(features_sync.T)
            score = silhouette_score(features_sync.T, curr_labels)
            if score > best_score:
                best_score = score
                best_n = n
                best_labels = curr_labels
        
        labels = best_labels
        print(f"[STRUCTURE] Detected {best_n} distinct sections (Score: {best_score:.2f})")
        
        # 4. Construct Segments
        # Group consecutive beats with the same label
        segments = []
        current_label = labels[0]
        start_beat_idx = 0
        
        for i, label in enumerate(labels):
            if label != current_label:
                # End of segment
                end_beat_idx = i
                segments.append({
                    "label": int(current_label),
                    "start_time": beat_times[start_beat_idx],
                    "end_time": beat_times[end_beat_idx],
                    "duration": beat_times[end_beat_idx] - beat_times[start_beat_idx]
                })
                current_label = label
                start_beat_idx = i
        
        # Add last segment
        segments.append({
            "label": int(current_label),
            "start_time": beat_times[start_beat_idx],
            "end_time": beat_times[-1],
            "duration": beat_times[-1] - beat_times[start_beat_idx]
        })
        
        # Filter short segments (< 4 bars roughly)
        # 4 bars at 120bpm = 8s. Let's say < 4s is noise.
        segments = [s for s in segments if s['duration'] > 4.0]
        
        return segments

    def find_best_loops(self, audio_path: Path, role: str) -> List[Dict]:
        """
        Uses structure analysis to find the most representative loops for a role.
        """
        segments = self.analyze_structure(audio_path)
        
        # Heuristic:
        # Chorus is usually the most repeated loud section.
        # Verse is usually quieter/different.
        
        # For now, we just return the segments as candidates for the LoopFactory to process
        # But we can tag them.
        
        # Let's find the "Densest" segment (most repetition)
        # Or just return all valid segments.
        
        return segments
