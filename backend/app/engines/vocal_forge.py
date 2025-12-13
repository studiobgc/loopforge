"""
VocalForge - Professional Vocal Processing Orchestrator

The main engine that combines:
- Batch key detection
- Pitch detection & auto-tune
- Experimental artifact effects
- Multi-track processing

Workflow:
1. Upload batch of samples
2. Analyze all tracks (key, pitch, tempo)
3. Select reference key/melody
4. Auto-tune + apply effects
5. Download processed files
"""

import numpy as np
import subprocess
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import librosa

from .key_detector import KeyDetector, KeyResult
from .pitch_engine import PitchEngine, PitchContour
from .artifact_engine import ArtifactEngine, ArtifactPreset
from .tagging_engine import TaggingEngine


def _save_audio_ffmpeg(path: Path, audio: np.ndarray, sr: int):
    """Save audio using ffmpeg pipe (no soundfile dependency)."""
    # Ensure mono or get channels
    if audio.ndim == 1:
        channels = 1
        audio_data = audio.astype(np.float32)
    else:
        channels = audio.shape[0] if audio.shape[0] < audio.shape[1] else audio.shape[1]
        if audio.shape[0] > audio.shape[1]:
            audio_data = audio.T.astype(np.float32)
        else:
            audio_data = audio.astype(np.float32)
    
    # Reshape for ffmpeg [samples, channels]
    if audio_data.ndim == 1:
        audio_data = audio_data.reshape(-1, 1)
    elif audio_data.shape[0] == channels:
        audio_data = audio_data.T
    
    cmd = [
        'ffmpeg', '-y',
        '-f', 'f32le',
        '-ar', str(sr),
        '-ac', str(channels),
        '-i', '-',
        '-acodec', 'pcm_f32le',
        str(path)
    ]
    
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    process.communicate(input=audio_data.tobytes())


@dataclass
class TrackAnalysis:
    """Complete analysis of a single audio track."""
    filename: str
    filepath: Path
    duration_seconds: float
    sample_rate: int
    
    # Key detection
    key: str
    mode: str
    key_confidence: float
    bpm: Optional[float]
    
    # Status
    status: str = 'analyzed'
    error: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {
            'filename': self.filename,
            'duration': round(self.duration_seconds, 2),
            'sample_rate': self.sample_rate,
            'key': self.key,
            'mode': self.mode,
            'full_key': f"{self.key} {self.mode}",
            'key_confidence': round(self.key_confidence, 3),
            'bpm': round(self.bpm, 1) if self.bpm else None,
            'status': self.status,
            'error': self.error,
            'tags': self.tags
        }


@dataclass
class ProcessingConfig:
    """Configuration for vocal processing."""
    # Target key (None = keep original)
    target_key: Optional[str] = None
    target_mode: Optional[str] = None
    
    # Auto-tune settings
    correction_strength: float = 1.0  # 0-1
    preserve_vibrato: bool = True
    
    # Artifact preset (None = no effects)
    artifact_preset: Optional[str] = None
    
    # Custom artifact parameters (override preset)
    custom_artifacts: dict = field(default_factory=dict)
    
    # Output format
    output_format: str = 'wav'
    output_sr: int = 44100
    
    def to_dict(self) -> dict:
        return {
            'target_key': self.target_key,
            'target_mode': self.target_mode,
            'correction_strength': self.correction_strength,
            'preserve_vibrato': self.preserve_vibrato,
            'artifact_preset': self.artifact_preset,
            'custom_artifacts': self.custom_artifacts,
            'output_format': self.output_format,
            'output_sr': self.output_sr
        }


@dataclass
class ProcessingResult:
    """Result of processing a single track."""
    filename: str
    input_path: Path
    output_path: Optional[Path]
    original_key: str
    target_key: str
    processing_time_seconds: float
    status: str
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            'filename': self.filename,
            'output_path': str(self.output_path) if self.output_path else None,
            'original_key': self.original_key,
            'target_key': self.target_key,
            'processing_time_seconds': round(self.processing_time_seconds, 2),
            'status': self.status,
            'error': self.error
        }


class VocalForge:
    """
    Main orchestrator for professional vocal processing.
    
    Combines key detection, pitch correction, and artifact
    generation into a cohesive workflow.
    
    Example:
        forge = VocalForge()
        
        # Analyze batch of files
        analyses = forge.analyze_batch([path1, path2, ...])
        
        # Process with target key
        config = ProcessingConfig(
            target_key='C',
            target_mode='minor',
            correction_strength=0.8,
            artifact_preset='bladee_classic'
        )
        
        results = forge.process_batch(filepaths, output_dir, config)
    """
    
    def __init__(
        self,
        max_workers: int = 4,
        default_sr: int = 44100
    ):
        """
        Initialize VocalForge.
        
        Args:
            max_workers: Max parallel processing threads
            default_sr: Default sample rate for processing
        """
        self.max_workers = max_workers
        self.default_sr = default_sr
        
        # Initialize engines
        self.key_detector = KeyDetector()
        self.pitch_engine = PitchEngine()
        self.artifact_engine = ArtifactEngine(sr=default_sr)
        self.tagging_engine = TaggingEngine()
    
    # =========================================================================
    # ANALYSIS
    # =========================================================================
    
    def analyze_track(self, filepath: Path) -> TrackAnalysis:
        """
        Analyze a single audio track.
        
        Args:
            filepath: Path to audio file
            
        Returns:
            TrackAnalysis with key, tempo, and metadata
        """
        try:
            # Load audio
            audio, sr = librosa.load(str(filepath), sr=None, mono=True)
            duration = len(audio) / sr
            
            # Detect key
            key_result = self.key_detector.detect_key(audio, sr, estimate_bpm=True)
            
            # Detect tags
            tags = []
            if self.tagging_engine:
                tag_results = self.tagging_engine.predict_tags(str(filepath), top_k=3)
                tags = [r['tag'] for r in tag_results]
            
            return TrackAnalysis(
                filename=filepath.name,
                filepath=filepath,
                duration_seconds=duration,
                sample_rate=sr,
                key=key_result.key,
                mode=key_result.mode,
                key_confidence=key_result.confidence,
                bpm=key_result.bpm,
                status='analyzed',
                tags=tags
            )
            
        except Exception as e:
            return TrackAnalysis(
                filename=filepath.name,
                filepath=filepath,
                duration_seconds=0,
                sample_rate=0,
                key='unknown',
                mode='unknown',
                key_confidence=0,
                bpm=None,
                status='error',
                error=str(e)
            )
    
    def analyze_batch(
        self,
        filepaths: list[Path],
        progress_callback: Optional[Callable[[int, int, str], None]] = None
    ) -> list[TrackAnalysis]:
        """
        Analyze multiple tracks in parallel.
        
        Args:
            filepaths: List of audio file paths
            progress_callback: Optional callback(current, total, filename)
            
        Returns:
            List of TrackAnalysis results
        """
        results = []
        total = len(filepaths)
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(self.analyze_track, fp): fp 
                for fp in filepaths
            }
            
            completed = 0
            for future in as_completed(futures):
                filepath = futures[future]
                completed += 1
                
                if progress_callback:
                    progress_callback(completed, total, filepath.name)
                
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    results.append(TrackAnalysis(
                        filename=filepath.name,
                        filepath=filepath,
                        duration_seconds=0,
                        sample_rate=0,
                        key='unknown',
                        mode='unknown',
                        key_confidence=0,
                        bpm=None,
                        status='error',
                        error=str(e)
                    ))
        
        return results
    
    # =========================================================================
    # PROCESSING
    # =========================================================================
    
    def process_track(
        self,
        filepath: Path,
        output_dir: Path,
        config: ProcessingConfig,
        original_analysis: Optional[TrackAnalysis] = None
    ) -> ProcessingResult:
        """
        Process a single track with pitch correction and effects.
        
        Args:
            filepath: Input audio path
            output_dir: Output directory
            config: Processing configuration
            original_analysis: Pre-computed analysis (optional)
            
        Returns:
            ProcessingResult with output path and status
        """
        import time
        start_time = time.perf_counter()
        
        try:
            # Load audio using GPU-accelerated loader
            from app.engines.torch_utils import load_audio, save_audio
            import torch
            
            # Load to GPU tensor
            audio_tensor = load_audio(str(filepath), sr=config.output_sr)
            
            # Convert to numpy for current engine compatibility
            # (Future: Update engines to support tensors directly)
            audio = audio_tensor.cpu().numpy()
            if audio.ndim == 2:
                audio = audio.mean(axis=0) # Convert to mono for processing
            
            # Get or compute analysis
            if original_analysis:
                original_key = f"{original_analysis.key} {original_analysis.mode}"
            else:
                analysis = self.analyze_track(filepath)
                original_key = f"{analysis.key} {analysis.mode}"
            
            # Determine target key
            if config.target_key and config.target_mode:
                target_key = f"{config.target_key} {config.target_mode}"
                target_scale = KeyDetector.get_scale_pitches(
                    config.target_key, 
                    config.target_mode
                )
            else:
                # Keep original key
                target_key = original_key
                if original_analysis:
                    target_scale = KeyDetector.get_scale_pitches(
                        original_analysis.key,
                        original_analysis.mode
                    )
                else:
                    target_scale = list(range(12))  # All notes
            
            # Apply pitch correction
            if config.correction_strength > 0:
                audio = self.pitch_engine.correct_pitch(
                    audio,
                    config.output_sr,
                    target_scale=target_scale,
                    correction_strength=config.correction_strength,
                    preserve_vibrato=config.preserve_vibrato
                )
            
            # Apply artifact effects
            if config.artifact_preset:
                audio = self.artifact_engine.apply_preset(
                    audio,
                    config.artifact_preset,
                    config.output_sr
                )
            elif config.custom_artifacts:
                # Build custom preset
                preset = ArtifactPreset(
                    name='custom',
                    bitcrush_rate=config.custom_artifacts.get('bitcrush_rate', 44100),
                    bitcrush_depth=config.custom_artifacts.get('bitcrush_depth', 24),
                    stutter_intensity=config.custom_artifacts.get('stutter_intensity', 0),
                    stutter_pattern=config.custom_artifacts.get('stutter_pattern', 'random'),
                    phase_smear=config.custom_artifacts.get('phase_smear', 0),
                    formant_shift=config.custom_artifacts.get('formant_shift', 0),
                    compression_ratio=config.custom_artifacts.get('compression_ratio', 1),
                    saturation=config.custom_artifacts.get('saturation', 0),
                    pitch_wobble=config.custom_artifacts.get('pitch_wobble', 0),
                    wobble_speed=config.custom_artifacts.get('wobble_speed', 4),
                    layer_corruption=config.custom_artifacts.get('layer_corruption', 0),
                )
                audio = self.artifact_engine.apply_full_chain(audio, config.output_sr, preset)
            
            # Normalize output
            peak = np.max(np.abs(audio))
            if peak > 0:
                audio = audio / peak * 0.95
            
            # Save output
            output_dir.mkdir(parents=True, exist_ok=True)
            stem = filepath.stem
            output_filename = f"{stem}_processed.{config.output_format}"
            output_path = output_dir / output_filename
            
            # Convert back to tensor for saving
            out_tensor = torch.from_numpy(audio).float()
            if out_tensor.ndim == 1:
                out_tensor = out_tensor.unsqueeze(0)
                
            save_audio(str(output_path), out_tensor, config.output_sr)
            
            processing_time = time.perf_counter() - start_time
            
            return ProcessingResult(
                filename=filepath.name,
                input_path=filepath,
                output_path=output_path,
                original_key=original_key,
                target_key=target_key,
                processing_time_seconds=processing_time,
                status='success'
            )
            
        except Exception as e:
            processing_time = time.perf_counter() - start_time
            return ProcessingResult(
                filename=filepath.name,
                input_path=filepath,
                output_path=None,
                original_key='unknown',
                target_key='unknown',
                processing_time_seconds=processing_time,
                status='error',
                error=str(e)
            )
    
    def process_batch(
        self,
        filepaths: list[Path],
        output_dir: Path,
        config: ProcessingConfig,
        analyses: Optional[list[TrackAnalysis]] = None,
        progress_callback: Optional[Callable[[int, int, str, str], None]] = None
    ) -> list[ProcessingResult]:
        """
        Process multiple tracks in parallel.
        
        Args:
            filepaths: List of input file paths
            output_dir: Output directory
            config: Processing configuration
            analyses: Pre-computed analyses (optional)
            progress_callback: Optional callback(current, total, filename, status)
            
        Returns:
            List of ProcessingResult
        """
        results = []
        total = len(filepaths)
        
        # Build analysis lookup
        analysis_map = {}
        if analyses:
            for analysis in analyses:
                analysis_map[str(analysis.filepath)] = analysis
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {}
            
            for fp in filepaths:
                analysis = analysis_map.get(str(fp))
                future = executor.submit(
                    self.process_track,
                    fp,
                    output_dir,
                    config,
                    analysis
                )
                futures[future] = fp
            
            completed = 0
            for future in as_completed(futures):
                filepath = futures[future]
                completed += 1
                
                try:
                    result = future.result()
                    results.append(result)
                    
                    if progress_callback:
                        progress_callback(
                            completed, 
                            total, 
                            filepath.name,
                            result.status
                        )
                        
                except Exception as e:
                    results.append(ProcessingResult(
                        filename=filepath.name,
                        input_path=filepath,
                        output_path=None,
                        original_key='unknown',
                        target_key='unknown',
                        processing_time_seconds=0,
                        status='error',
                        error=str(e)
                    ))
                    
                    if progress_callback:
                        progress_callback(completed, total, filepath.name, 'error')
        
        return results
    
    # =========================================================================
    # UTILITIES
    # =========================================================================
    
    def get_available_presets(self) -> list[dict]:
        """Get list of available artifact presets with their parameters."""
        presets = []
        for name in ArtifactEngine.get_preset_names():
            presets.append(ArtifactEngine.get_preset_info(name))
        return presets
    
    def suggest_target_key(
        self,
        analyses: list[TrackAnalysis],
        strategy: str = 'most_common'
    ) -> tuple[str, str]:
        """
        Suggest a target key based on batch analysis.
        
        Args:
            analyses: List of TrackAnalysis
            strategy: 'most_common' or 'highest_confidence'
            
        Returns:
            (key, mode) tuple
        """
        if not analyses:
            return ('C', 'major')
        
        # Filter successful analyses
        valid = [a for a in analyses if a.status == 'analyzed']
        if not valid:
            return ('C', 'major')
        
        if strategy == 'most_common':
            # Count key occurrences
            key_counts = {}
            for a in valid:
                full_key = f"{a.key}_{a.mode}"
                key_counts[full_key] = key_counts.get(full_key, 0) + 1
            
            # Get most common
            most_common = max(key_counts, key=key_counts.get)
            key, mode = most_common.split('_')
            return (key, mode)
            
        else:  # highest_confidence
            best = max(valid, key=lambda x: x.key_confidence)
            return (best.key, best.mode)
    
    def export_analysis_report(
        self,
        analyses: list[TrackAnalysis],
        output_path: Path
    ) -> None:
        """Export batch analysis results to JSON."""
        report = {
            'total_tracks': len(analyses),
            'successful': sum(1 for a in analyses if a.status == 'analyzed'),
            'errors': sum(1 for a in analyses if a.status == 'error'),
            'tracks': [a.to_dict() for a in analyses]
        }
        
        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2)
