"""
Job Workers

Processor functions for each job type.
These are the actual work units that run in background threads.
"""

from pathlib import Path
from typing import Dict, Any, Callable, Optional
import traceback

from .models import JobType, StemRole, Asset
from .queue import Worker
from .storage import get_storage
from .database import get_db


@Worker(JobType.SEPARATION)
def process_separation(job, progress: Callable[[float, str], None]) -> Dict[str, Any]:
    """
    Separate audio into stems using Demucs.
    
    Input: job.input_path = path to audio file
    Output: {"drums": "/path/to/drums.wav", "bass": "/path/to/bass.wav", ...}
    
    Set LOOPFORGE_QUICK_MODE=1 to skip Demucs and just copy the file as stems (for testing).
    """
    import os
    import shutil
    
    input_path = Path(job.input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    
    session_id = job.session_id
    storage = get_storage()
    
    # QUICK MODE: Skip Demucs, just copy file as all stems (for testing UI flow)
    if os.environ.get("LOOPFORGE_QUICK_MODE") == "1":
        progress(10, "Quick mode: copying as stems...")
        output_paths = {}
        for stem_name in ["drums", "bass", "vocals", "other"]:
            progress(20 + 15 * ["drums", "bass", "vocals", "other"].index(stem_name), f"Creating {stem_name}...")
            final_path = storage.save_stem(session_id, stem_name, input_path)
            output_paths[stem_name] = str(final_path)
            
            db = get_db()
            with db.session() as session:
                asset = Asset(
                    session_id=session_id,
                    filename=f"{stem_name}.wav",
                    file_path=str(final_path),
                    asset_type="stem",
                    stem_role=_stem_name_to_role(stem_name),
                )
                session.add(asset)
                session.commit()
        
        progress(100, "Quick mode complete")
        return output_paths
    
    # FULL MODE: Use Demucs
    from ..model_manager import get_separator
    
    # Get separator
    progress(5, "Loading Demucs model...")
    separator = get_separator()
    
    # Check for preview mode (process only first N seconds)
    config = job.config or {}
    preview_duration = config.get("preview_duration")
    
    # Create temp output directory
    temp_dir = storage.get_cache_path(job.id)
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    # Progress wrapper
    def separation_progress(stage: str, pct: float, msg: str):
        # Allow user to cancel a RUNNING job and stop Demucs promptly.
        db = get_db()
        with db.session() as session:
            from .models import Job, JobStatus
            current = session.query(Job).filter(Job.id == job.id).first()
            if current and current.status == JobStatus.CANCELLED:
                raise RuntimeError("Job cancelled")

        # Map Demucs progress (0-100) to our range (10-90)
        mapped_pct = 10 + (pct * 0.8)
        progress(mapped_pct, msg)
    
    # Run separation
    if preview_duration:
        progress(10, f"Starting preview separation ({preview_duration}s)...")
    else:
        progress(10, "Starting separation...")
    stem_paths = separator.separate_sync(
        input_path, 
        temp_dir, 
        progress_callback=separation_progress,
        duration_limit=preview_duration,
    )
    
    # Move stems to permanent storage
    progress(92, "Saving stems...")
    output_paths = {}
    
    for stem_name, temp_path in stem_paths.items():
        final_path = storage.save_stem(session_id, stem_name, temp_path)
        output_paths[stem_name] = str(final_path)
        
        # Create asset record
        db = get_db()
        with db.session() as session:
            asset = Asset(
                session_id=session_id,
                filename=f"{stem_name}.wav",
                file_path=str(final_path),
                asset_type="stem",
                stem_role=_stem_name_to_role(stem_name),
            )
            session.add(asset)
            session.commit()
    
    progress(95, "Queueing stem analysis...")
    
    # Queue stem analysis job to detect key/bpm for each stem
    from .queue import get_queue
    queue = get_queue()
    queue.submit(
        session_id=session_id,
        job_type=JobType.STEM_ANALYSIS,
        input_path=str(input_path),  # Not used, but required
    )
    
    progress(100, "Separation complete")
    return output_paths


@Worker(JobType.ANALYSIS)
def process_analysis(job, progress: Callable[[float, str], None]) -> Dict[str, Any]:
    """
    Analyze audio for BPM and key.
    
    Input: job.input_path = path to audio file
    Output: {"bpm": 120.5, "key": "Am", "duration": 180.5}
    """
    import librosa
    
    input_path = Path(job.input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    
    progress(10, "Loading audio...")
    # Avoid loading full files into memory for analysis.
    # A short excerpt is enough for stable tempo/key estimation and prevents stalls.
    analysis_duration_s = 60.0
    y, sr = librosa.load(input_path, sr=22050, mono=True, duration=analysis_duration_s)
    
    try:
        duration = float(librosa.get_duration(path=str(input_path)))
    except Exception:
        duration = librosa.get_duration(y=y, sr=sr)
    
    progress(30, "Detecting tempo...")
    bpm: Optional[float] = None
    try:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(tempo) if hasattr(tempo, '__float__') else float(tempo[0])
    except Exception:
        bpm = None
    
    progress(60, "Detecting key...")
    # Key detection using chroma features.
    # Disable Essentia here to avoid occasional long init/hangs in some environments.
    from ..engines.key_detector import KeyDetector
    key = "Unknown"
    try:
        detector = KeyDetector()
        key_result = detector.detect_key(y, sr, estimate_bpm=False, use_essentia=False)
        key = key_result.full_key if key_result else "Unknown"
    except Exception:
        key = "Unknown"
    
    progress(100, "Analysis complete")
    
    # Update session with analysis results
    db = get_db()
    with db.session() as session:
        from .models import Session
        sess = session.query(Session).filter(Session.id == job.session_id).first()
        if sess:
            sess.bpm = bpm
            sess.key = key
            sess.duration_seconds = duration
            session.commit()
    
    return {
        "bpm": bpm,
        "key": key,
        "duration": duration,
    }


@Worker(JobType.SLICING)
def process_slicing(job, progress: Callable[[float, str], None]) -> Dict[str, Any]:
    """
    Detect transients and create a slice bank.
    
    Input: job.input_path = path to stem file
    Config: job.config = {"role": "drums", "bpm": 120}
    Output: {"slice_bank_id": "...", "num_slices": 16}
    """
    from ..engines.slice_engine import SliceEngine, SliceRole
    from .models import SliceBankRecord
    
    input_path = Path(job.input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    
    config = job.config or {}
    role_str = config.get("role", "unknown")
    bpm = config.get("bpm")
    key = config.get("key")
    
    try:
        role = SliceRole(role_str)
    except ValueError:
        role = SliceRole.UNKNOWN
    
    progress(10, "Loading audio...")
    engine = SliceEngine()
    
    progress(20, "Detecting transients...")
    slice_bank = engine.create_slice_bank(
        input_path,
        role=role,
        bpm=bpm,
        key=key,
    )
    
    progress(80, "Saving slice bank...")
    
    # Save to database
    db = get_db()
    with db.session() as session:
        record = SliceBankRecord(
            id=slice_bank.id,
            session_id=job.session_id,
            source_filename=slice_bank.source_filename,
            stem_role=role,
            num_slices=len(slice_bank.slices),
            total_duration=slice_bank.total_duration,
            mean_energy=slice_bank.mean_energy,
            max_energy=slice_bank.max_energy,
            energy_variance=slice_bank.energy_variance,
            slice_data=[s.to_dict() for s in slice_bank.slices],
        )
        session.add(record)
        session.commit()
    
    progress(100, "Slicing complete")
    
    return {
        "slice_bank_id": slice_bank.id,
        "num_slices": len(slice_bank.slices),
        "total_duration": slice_bank.total_duration,
    }


def _stem_name_to_role(stem_name: str) -> StemRole:
    """Map stem name to role enum"""
    name_lower = stem_name.lower()
    if "drum" in name_lower:
        return StemRole.DRUMS
    elif "bass" in name_lower:
        return StemRole.BASS
    elif "vocal" in name_lower:
        return StemRole.VOCALS
    elif "other" in name_lower:
        return StemRole.OTHER
    else:
        return StemRole.UNKNOWN


def _sanitize_for_json(obj):
    """Convert numpy types to Python native types for JSON serialization."""
    import numpy as np
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    elif isinstance(obj, (np.floating, np.float32, np.float64)):
        return float(obj)
    elif isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


@Worker(JobType.MOMENTS)
def process_moments(job, progress: Callable[[float, str], None]) -> Dict[str, Any]:
    """
    Detect interesting moments (hits, phrases, textures) in audio.
    
    Input: job.input_path = path to audio file
    Config: job.config = {"bias": "balanced"}
    Output: {"moments_count": N, "by_type": {...}}
    """
    from ..services.moments import detect_moments
    
    input_path = Path(job.input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    
    config = job.config or {}
    bias = config.get("bias", "balanced")
    
    progress(10, "Analyzing audio structure...")
    moments = detect_moments(str(input_path), bias=bias)
    
    progress(80, "Classifying moments...")
    # Sanitize numpy types for JSON serialization
    moments = _sanitize_for_json(moments)
    
    by_type = {
        "hits": [m for m in moments if m["type"] == "hit"],
        "phrases": [m for m in moments if m["type"] == "phrase"],
        "textures": [m for m in moments if m["type"] == "texture"],
        "changes": [m for m in moments if m["type"] == "change"],
    }
    
    progress(100, "Moments detection complete")
    
    return {
        "moments_count": len(moments),
        "moments": moments,
        "by_type": by_type,
    }


@Worker(JobType.STEM_ANALYSIS)
def process_stem_analysis(job, progress: Callable[[float, str], None]) -> Dict[str, Any]:
    """
    Analyze all stems in a session for key/bpm.
    
    Input: job.session_id = session with stems to analyze
    Output: {"stems_analyzed": 4, "results": {...}}
    """
    import librosa
    from ..engines.key_detector import KeyDetector
    
    session_id = job.session_id
    db = get_db()
    
    progress(5, "Loading stems...")
    
    # Get all stem assets for this session
    with db.session() as session:
        from .models import Asset
        stems = session.query(Asset).filter(
            Asset.session_id == session_id,
            Asset.asset_type == "stem"
        ).all()
        stem_data = [(s.id, s.file_path, s.stem_role.value if s.stem_role else "unknown") for s in stems]
    
    if not stem_data:
        progress(100, "No stems to analyze")
        return {"stems_analyzed": 0, "results": {}}
    
    detector = KeyDetector()
    results = {}
    total = len(stem_data)
    
    for i, (asset_id, file_path, role) in enumerate(stem_data):
        stem_progress = 10 + (80 * i // total)
        progress(stem_progress, f"Analyzing {role} stem...")
        
        try:
            input_path = Path(file_path)
            if not input_path.exists():
                results[role] = {"error": "File not found"}
                continue
            
            # Load audio (limit to 60s for speed)
            y, sr = librosa.load(str(input_path), sr=22050, mono=True, duration=60.0)
            
            # Detect key (skip Essentia for speed)
            key_result = detector.detect_key(y, sr, estimate_bpm=True, use_essentia=False)
            
            # Update asset with analysis results
            with db.session() as session:
                asset = session.query(Asset).filter(Asset.id == asset_id).first()
                if asset:
                    asset.detected_key = key_result.full_key
                    asset.detected_bpm = key_result.bpm
                    asset.key_confidence = key_result.confidence
                    session.commit()
            
            results[role] = {
                "key": key_result.full_key,
                "bpm": round(key_result.bpm, 1) if key_result.bpm else None,
                "confidence": round(key_result.confidence, 3),
            }
            
        except Exception as e:
            results[role] = {"error": str(e)}
    
    progress(100, "Stem analysis complete")
    
    return {
        "stems_analyzed": len(stem_data),
        "results": results,
    }


@Worker(JobType.PEAKS)
def process_peaks(job, progress: Callable[[float, str], None]) -> Dict[str, Any]:
    """
    Generate waveform peaks for fast rendering.
    
    Input: job.input_path = path to audio file
    Output: {"peaks_path": "..."}
    """
    import subprocess
    
    input_path = Path(job.input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    
    output_path = input_path.with_suffix(".dat")
    
    if output_path.exists():
        progress(100, "Peaks already generated")
        return {"peaks_path": str(output_path)}
    
    progress(20, "Generating waveform peaks...")
    
    try:
        subprocess.run(
            ["audiowaveform", "-i", str(input_path), "-o", str(output_path), "-b", "8"],
            check=True,
            capture_output=True,
        )
    except FileNotFoundError:
        raise RuntimeError("audiowaveform not installed")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Peak generation failed: {e.stderr.decode()}")
    
    progress(100, "Peaks generation complete")
    
    return {"peaks_path": str(output_path)}
