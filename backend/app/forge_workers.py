import os
import shutil
import subprocess
import traceback
from pathlib import Path
from typing import Optional, List, Dict, Any
import numpy as np

# We need to be careful with imports here to avoid heavy loads if not needed
# But for workers, they need these.

def analyze_track_task(path_str: str):
    """Analyze track for Key and BPM (runs in ProcessPoolExecutor)."""
    try:
        import librosa
        from pathlib import Path
        from app.engines.vocal_forge import TrackAnalysis
        
        # Get full duration first (fast)
        total_duration = librosa.get_duration(path=path_str)
        
        # Load audio (limit to 180s for speed - enough for Key/BPM)
        from app.engines.torch_utils import load_audio
        tensor = load_audio(path_str, sr=44100, duration=180)
        y = tensor.cpu().numpy()
        if y.ndim == 2:
            y = y.mean(axis=0)
        sr = 44100
        
        # BPM
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
        bpm = float(tempo) if tempo > 0 else 120.0
        
        # Key
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_avg = np.mean(chroma, axis=1)
        key_idx = np.argmax(chroma_avg)
        KEY_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        key = KEY_ORDER[key_idx]
        
        return TrackAnalysis(
            filename=Path(path_str).name,
            filepath=Path(path_str),
            duration_seconds=total_duration,
            sample_rate=sr,
            key=key,
            mode="minor",
            key_confidence=0.8,
            bpm=bpm
        )
    except Exception as e:
        print(f"[WORKER ERROR] analyze_track_task failed for {path_str}: {e}")
        traceback.print_exc()
        return None

def worker_extract_stem(filepath_str: str, output_dir_str: str, filename: str, stem_name: str, shifts: int = 1, overlap: float = 0.25, progress_callback=None) -> Optional[Path]:
    """Extract stem using Demucs (runs in ThreadPoolExecutor to share model RAM)."""
    try:
        from app.model_manager import get_separator
        
        filepath = Path(filepath_str)
        output_dir = Path(output_dir_str)
        stem_dir = output_dir / "stems" / filename.replace('.', '_')
        stem_dir.mkdir(parents=True, exist_ok=True)
        
        separator = get_separator()
        print(f"[WORKER] Starting separation for {filename} stem {stem_name} on {separator.device} (shifts={shifts}, overlap={overlap})")
        stems = separator.separate_sync(filepath, stem_dir, shifts=shifts, overlap=overlap, progress_callback=progress_callback)
        print(f"[WORKER] Finished separation for {filename} stem {stem_name}")
        return stems.get(stem_name)
    except Exception as e:
        print(f"[WORKER ERROR] worker_extract_stem failed for {filename}: {e}")
        traceback.print_exc()
        return None

def worker_process_vocal(stem_path_str: str, output_dir_str: str, preset_name: str, anchor_key: str, anchor_mode: str, custom_artifacts: dict = None, correction_strength: float = 0.8):
    """Process vocal with preset (runs in ProcessPoolExecutor)."""
    try:
        from app.engines import VocalForge
        from app.engines.vocal_forge import ProcessingConfig
        
        stem_path = Path(stem_path_str)
        output_dir = Path(output_dir_str)
        
        # Instantiate VocalForge for this worker
        forge = VocalForge() 
        
        # Determine config based on inputs
        if custom_artifacts:
            # Custom settings override preset
            config = ProcessingConfig(
                target_key=anchor_key, 
                target_mode=anchor_mode,
                correction_strength=correction_strength,
                custom_artifacts=custom_artifacts,
                artifact_preset=None # Ensure preset doesn't override custom
            )
            out_name = "custom_fx"
        else:
            # Use preset
            config = ProcessingConfig(
                target_key=anchor_key, 
                target_mode=anchor_mode,
                correction_strength=0.8, 
                artifact_preset=preset_name.lower().replace(' ', '_')
            )
            out_name = preset_name.lower().replace(' ', '_')

        preset_dir = output_dir / out_name
        preset_dir.mkdir(exist_ok=True)
        
        result = forge.process_track(stem_path, preset_dir, config)
        return result.output_path if result.status == "success" else None, out_name
    except Exception as e:
        print(f"[WORKER ERROR] worker_process_vocal failed for {stem_path_str}: {e}")
        traceback.print_exc()
        return None, preset_name

def worker_process_instrumental(path_str: str, semitones: int, source_bpm: float = None, target_bpm: float = None):
    """Time stretch and pitch shift audio using GPU-accelerated PyTorch (runs in ThreadPool)."""
    try:
        from app.engines.torch_utils import load_audio, pitch_shift
        from app.engines.time_engine import TimeStretchEngine
        
        # Load to GPU
        waveform = load_audio(path_str)
        sr = 44100 # load_audio defaults to 44100
        
        # 1. Time Stretch
        if source_bpm and target_bpm and source_bpm > 0 and target_bpm > 0:
            # Only stretch if difference is significant (> 1 BPM)
            if abs(source_bpm - target_bpm) > 1.0:
                time_engine = TimeStretchEngine(sr=sr)
                waveform = time_engine.match_bpm(waveform, source_bpm, target_bpm)
        
        # 2. Pitch Shift
        if semitones != 0:
            waveform = pitch_shift(waveform, sr, semitones)
            
        return waveform, sr
    except Exception as e:
        print(f"[WORKER ERROR] worker_process_instrumental failed for {path_str}: {e}")
        traceback.print_exc()
        return None, None

def worker_create_shadow(base_audio, sr, output_dir_str: str, role: str, filename: str):
    """Create shadow effect using GPU convolution."""
    try:
        from app.engines.torch_utils import pitch_shift, apply_convolution, save_audio
        import torch
        
        output_dir = Path(output_dir_str)
        
        # Ensure input is tensor
        if not isinstance(base_audio, torch.Tensor):
            # Fallback if passed numpy
            import torchaudio
            base_audio = torch.from_numpy(base_audio).float()
            if base_audio.ndim == 1: base_audio = base_audio.unsqueeze(0)
            
        # Pitch shift -12
        shadow_audio = pitch_shift(base_audio, sr, -12)
        
        # Apply smoothing convolution
        shadow_audio = apply_convolution(shadow_audio, kernel_size=20)
            
        out_name = f"{role}_{Path(filename).stem}_SHADOW.wav"
        out_p = output_dir / out_name
        
        save_audio(str(out_p), shadow_audio, sr)
        return out_p
    except Exception as e:
        print(f"[WORKER ERROR] worker_create_shadow failed: {e}")
        traceback.print_exc()
        return None

def worker_create_sparkle(base_audio, sr, output_dir_str: str, role: str, filename: str):
    """Create sparkle effect using GPU convolution."""
    try:
        from app.engines.torch_utils import pitch_shift, apply_convolution, save_audio
        import torch
        
        output_dir = Path(output_dir_str)
        
        # Ensure input is tensor
        if not isinstance(base_audio, torch.Tensor):
            import torchaudio
            base_audio = torch.from_numpy(base_audio).float()
            if base_audio.ndim == 1: base_audio = base_audio.unsqueeze(0)
            
        # Pitch shift +12
        sparkle_audio = pitch_shift(base_audio, sr, 12)
        
        # High-pass filter via subtraction of low-pass
        low = apply_convolution(sparkle_audio, kernel_size=15)
        sparkle_audio = sparkle_audio - low
            
        out_name = f"{role}_{Path(filename).stem}_SPARKLE.wav"
        out_p = output_dir / out_name
        
        save_audio(str(out_p), sparkle_audio, sr)
        return out_p
    except Exception as e:
        print(f"[WORKER ERROR] worker_create_sparkle failed: {e}")
        traceback.print_exc()
        return None

def worker_extract_loops(loop_source_path_str: str, output_dir_str: str, role: str, master_bpm: float, anchor_key: str):
    """Extract loops (runs in ProcessPoolExecutor)."""
    try:
        from app.engines.loop_factory import LoopFactory
        
        loop_factory = LoopFactory()
        return loop_factory.process(Path(loop_source_path_str), Path(output_dir_str), role, master_bpm, target_key=anchor_key)
    except Exception as e:
        print(f"[WORKER ERROR] worker_extract_loops failed: {e}")
        traceback.print_exc()
        return []

def worker_analyze_stem_inline(stem_path_str: str):
    """Analyze stem key/bpm inline."""
    try:
        import librosa
        
        y, sr = librosa.load(stem_path_str, sr=44100, mono=True)
        # onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        # tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        key_idx = np.argmax(np.mean(chroma, axis=1))
        KEY_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        return KEY_ORDER[key_idx]
    except Exception as e:
        print(f"[WORKER ERROR] worker_analyze_stem_inline failed: {e}")
        traceback.print_exc()
        return "C" # Default fallback
