"""
VocalForge API Routes

Endpoints for:
- Batch key detection
- Vocal processing with auto-tune + effects
- Artifact preset management
"""

import asyncio
import uuid
import json
import time
from pathlib import Path
from typing import Optional, List
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .engines import VocalForge, KeyDetector, ArtifactEngine, SpectralEngine
from .engines.vocal_forge import ProcessingConfig, TrackAnalysis
from .services.session_manager import session_manager
from .services.forge_service import ForgeService, get_executor

# Router
router = APIRouter(prefix="/api/forge", tags=["VocalForge"])

# Storage
FORGE_UPLOAD_DIR = Path("./forge_uploads")
FORGE_OUTPUT_DIR = Path("./forge_outputs")
FORGE_UPLOAD_DIR.mkdir(exist_ok=True)
FORGE_OUTPUT_DIR.mkdir(exist_ok=True)

# Singleton VocalForge instance
_forge: Optional[VocalForge] = None


def get_forge() -> VocalForge:
    """Get or create VocalForge instance."""
    global _forge
    if _forge is None:
        print("[FORGE] Initializing VocalForge engine...")
        _forge = VocalForge(max_workers=4)
        print("[FORGE] Ready!")
    return _forge


# =============================================================================
# MODELS
# =============================================================================

class AnalyzeRequest(BaseModel):
    session_id: str


class ProcessRequest(BaseModel):
    session_id: str
    target_key: Optional[str] = None
    target_mode: Optional[str] = None
    correction_strength: float = 1.0
    preserve_vibrato: bool = True
    artifact_preset: Optional[str] = None
    custom_artifacts: Optional[dict] = None


class KeyShiftRequest(BaseModel):
    session_id: str
    filename: str
    target_key: str
    target_mode: str


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/session")
async def create_session():
    """Create a new VocalForge session for batch upload."""
    session_id = str(uuid.uuid4())
    session_dir = FORGE_UPLOAD_DIR / session_id
    output_dir = FORGE_OUTPUT_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    session = session_manager.create_session(session_id)
    session["upload_dir"] = session_dir
    session["output_dir"] = output_dir
    
    return {"session_id": session_id, "status": "created"}


@router.post("/upload/{session_id}")
async def upload_to_session(session_id: str, file: UploadFile = File(...)):
    """Upload a file to an existing session."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    # Validate file type
    if not file.filename:
        raise HTTPException(400, "No filename")
    
    ext = Path(file.filename).suffix.lower()
    if ext not in [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aiff"]:
        raise HTTPException(400, f"Unsupported format: {ext}")
    
    # Save file
    session_dir = session["upload_dir"]
    filepath = session_dir / file.filename
    
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    
    if "files" not in session:
        session["files"] = []
        
    session["files"].append({
        "filename": file.filename,
        "path": str(filepath),
        "size": len(content)
    })
    
    return {
        "filename": file.filename,
        "session_id": session_id,
        "total_files": len(session["files"])
    }


@router.post("/analyze")
async def analyze_session(request: AnalyzeRequest):
    """Analyze all files in a session (key detection + BPM)."""
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    if not session.get("files"):
        raise HTTPException(400, "No files uploaded")
    
    session_manager.update_session(request.session_id, {"status": "analyzing"})
    
    # Get file paths
    filepaths = [Path(f["path"]) for f in session["files"]]
    
    # Run analysis in thread pool
    loop = asyncio.get_event_loop()
    forge = get_forge()
    
    def run_analysis():
        return forge.analyze_batch(filepaths)
    
    analyses = await loop.run_in_executor(get_executor(), run_analysis)
    
    # Store analyses
    session_manager.update_session(request.session_id, {
        "analyses": [a.to_dict() for a in analyses],
        "status": "analyzed"
    })
    
    # Suggest target key
    suggested_key, suggested_mode = forge.suggest_target_key(analyses)
    
    return {
        "session_id": request.session_id,
        "status": "analyzed",
        "tracks": session["analyses"],
        "suggested_key": suggested_key,
        "suggested_mode": suggested_mode,
        "total_tracks": len(analyses)
    }


@router.post("/process")
async def process_session(request: ProcessRequest):
    """Process all files in a session with specified settings."""
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    if not session.get("files"):
        raise HTTPException(400, "No files uploaded")
    
    session_manager.update_session(request.session_id, {"status": "processing"})
    
    # Build config
    config = ProcessingConfig(
        target_key=request.target_key,
        target_mode=request.target_mode,
        correction_strength=request.correction_strength,
        preserve_vibrato=request.preserve_vibrato,
        artifact_preset=request.artifact_preset,
        custom_artifacts=request.custom_artifacts or {}
    )
    
    # Get file paths
    filepaths = [Path(f["path"]) for f in session["files"]]
    output_dir = session["output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Run processing in thread pool
    loop = asyncio.get_event_loop()
    forge = get_forge()
    
    def run_processing():
        return forge.process_batch(filepaths, output_dir, config)
    
    results = await loop.run_in_executor(get_executor(), run_processing)
    
    # Store results
    session_manager.update_session(request.session_id, {
        "results": [r.to_dict() for r in results],
        "status": "complete"
    })
    
    return {
        "session_id": request.session_id,
        "status": "complete",
        "results": session["results"],
        "output_dir": str(output_dir)
    }


@router.get("/session/{session_id}")
async def get_session_status(session_id: str):
    """Get current session status and data."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    return {
        "session_id": session_id,
        "status": session["status"],
        "files": session.get("files", []),
        "analyses": session.get("analyses", []),
        "results": session.get("results", [])
    }


@router.get("/download/{session_id}/{filename}")
async def download_processed_file(session_id: str, filename: str):
    """Download a single processed file."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    output_dir = session["output_dir"]
    
    # Find the file
    filepath = output_dir / filename
    if not filepath.exists():
        # Try with _processed suffix
        stem = Path(filename).stem.replace("_processed", "")
        filepath = output_dir / f"{stem}_processed.wav"
    
    if not filepath.exists():
        raise HTTPException(404, f"File not found: {filename}")
    
    return FileResponse(
        filepath,
        media_type="audio/wav",
        filename=filepath.name
    )


@router.get("/stream/{session_id}/{filename}")
async def stream_processed_file(session_id: str, filename: str):
    """Stream a processed file (inline playback)."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    output_dir = session["output_dir"]
    
    # Find the file
    filepath = output_dir / filename
    if not filepath.exists():
        # Try with _processed suffix
        stem = Path(filename).stem.replace("_processed", "")
        filepath = output_dir / f"{stem}_processed.wav"
    
    if not filepath.exists():
        raise HTTPException(404, f"File not found: {filename}")
    
    return FileResponse(
        filepath,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline"}
    )



class LoopExportConfig(BaseModel):
    filename: str
    crop_start: float
    crop_end: float

class ExportRequest(BaseModel):
    session_id: str
    loops: List[LoopExportConfig]

@router.post("/export")
async def export_loops(request: ExportRequest):
    """Export selected loops with precise cropping."""
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
        
    output_dir = session["output_dir"]
    export_dir = output_dir / "export"
    if export_dir.exists():
        import shutil
        shutil.rmtree(export_dir)
    export_dir.mkdir()
    
    import subprocess
    
    for loop in request.loops:
        # Find source file
        src_path = output_dir / loop.filename
        if not src_path.exists():
            # Try finding it in evolved folder
            src_path = output_dir / "evolved" / loop.filename
        
        if not src_path.exists():
            continue
            
        # Define output path
        # Clean filename
        clean_name = Path(loop.filename).stem
        out_name = f"{clean_name}_loop.wav"
        out_path = export_dir / out_name
        
        # Calculate duration
        duration = loop.crop_end - loop.crop_start
        if duration <= 0:
            continue
            
        # Cut with ffmpeg (re-encode for sample accuracy)
        cmd = [
            'ffmpeg', '-y',
            '-ss', str(loop.crop_start),
            '-t', str(duration),
            '-i', str(src_path),
            str(out_path)
        ]
        
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
    # Zip it
    import zipfile
    zip_path = output_dir / "loop_pack.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in export_dir.glob("*.wav"):
            zf.write(f, f.name)
            
    return FileResponse(zip_path, filename="loop_pack.zip")


@router.get("/download/{session_id}")
async def download_all_processed(session_id: str):
    """Download all processed files as ZIP."""
    import zipfile
    
    if session_id not in forge_sessions:
        raise HTTPException(404, "Session not found")
    
    session = forge_sessions[session_id]
    output_dir = session["output_dir"]
    
    if not output_dir.exists():
        raise HTTPException(400, "No processed files")
    
    # Create ZIP
    zip_path = output_dir / "processed_vocals.zip"
    
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for wav_file in output_dir.glob("*.wav"):
            zf.write(wav_file, wav_file.name)
    
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename="processed_vocals.zip"
    )


# =============================================================================
# PRESETS & INFO
# =============================================================================

@router.get("/presets")
async def get_presets():
    """Get available artifact presets."""
    forge = get_forge()
    presets = forge.get_available_presets()
    return {"presets": presets}


@router.get("/keys")
async def get_keys():
    """Get list of musical keys for UI dropdown."""
    keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    modes = ['major', 'minor']
    
    return {
        "keys": keys,
        "modes": modes,
        "all_keys": [f"{k} {m}" for k in keys for m in modes]
    }


class VocalStackRequest(BaseModel):
    session_id: str
    target_key: Optional[str] = None
    target_mode: Optional[str] = None
    correction_strength: float = 0.8
    enabled_presets: List[str] = []


class StemSourceInput(BaseModel):
    filename: str
    role: str  # 'drums', 'vocals', 'bass', 'melody'
    key: Optional[str] = None
    mode: Optional[str] = None


class ForgeCompleteRequest(BaseModel):
    """Complete workflow: extract stems, pitch-shift, process vocals, bundle."""
    sources: List[StemSourceInput]
    anchor_key: str
    anchor_mode: str = "minor"
    enabled_presets: List[str] = []
    correction_strength: float = 0.8


@router.post("/forge-complete")
async def forge_complete_workflow(files: List[UploadFile] = File(...)):
    """
    Complete DreamForge workflow:
    1. Upload multiple files with assigned roles
    2. Extract the specified stem from each using Demucs
    3. Analyze keys
    4. Return analysis for user to set anchor
    
    This is step 1 - upload and analyze.
    
    Accepts multipart/form-data with 'files' field containing one or more audio files.
    """
    import shutil
    import traceback
    
    session_id = str(uuid.uuid4())
    session = session_manager.create_session(session_id)
    session_dir = FORGE_UPLOAD_DIR / session_id
    output_dir = FORGE_OUTPUT_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    session["upload_dir"] = session_dir
    session["output_dir"] = output_dir
    session["status"] = "uploading"
    
    sources = []
    loop = asyncio.get_event_loop()
    
    try:
        # Step 1: Save all files first (fast I/O) - ORIGINAL WORKING CODE
        async def save_file(file):
            filepath = session_dir / file.filename
            def save():
                try:
                    with open(filepath, "wb") as buffer:
                        shutil.copyfileobj(file.file, buffer)
                    return filepath
                except Exception as e:
                    print(f"[UPLOAD ERROR] Failed to save {file.filename}: {e}")
                    traceback.print_exc()
                    raise
            
            return await loop.run_in_executor(None, save)
        
        # Save all files in parallel (original working approach)
        saved_paths = await asyncio.gather(*[save_file(f) for f in files], return_exceptions=True)
        
        # Check for save errors
        for i, result in enumerate(saved_paths):
            if isinstance(result, Exception):
                raise HTTPException(500, f"Failed to save {files[i].filename}: {str(result)}")
        
        session["status"] = "analyzing"
        
        # Step 2: Analyze files in parallel (CPU-bound)
        async def analyze_file(filepath):
            try:
                return await loop.run_in_executor(get_executor(), analyze_track_task, str(filepath))
            except Exception as e:
                print(f"[ANALYSIS ERROR] Failed to analyze {filepath}: {e}")
                traceback.print_exc()
                # Return default analysis instead of failing completely
                from app.engines.vocal_forge import TrackAnalysis
                return TrackAnalysis(
                    filename=Path(filepath).name,
                    filepath=Path(filepath),
                    duration_seconds=0,
                    sample_rate=44100,
                    key="C",
                    mode="minor",
                    key_confidence=0.5,
                    bpm=120.0
                )
        
        # Analyze all files in parallel
        analyses = await asyncio.gather(*[analyze_file(path) for path in saved_paths])
        
        # Construct sources list
        for file, analysis in zip(files, analyses):
            if analysis:  # Only add if analysis succeeded
                filepath = session_dir / file.filename
                sources.append({
                    "filename": file.filename,
                    "path": str(filepath),
                    "key": analysis.key if hasattr(analysis, 'key') else "C",
                    "mode": analysis.mode if hasattr(analysis, 'mode') else "minor",
                    "full_key": f"{analysis.key if hasattr(analysis, 'key') else 'C'} {analysis.mode if hasattr(analysis, 'mode') else 'minor'}",
                    "bpm": analysis.bpm if hasattr(analysis, 'bpm') else 120.0,
                    "tags": analysis.tags if hasattr(analysis, 'tags') else [],
                    "role": None
                })
        
        session_manager.update_session(session_id, {
            "sources": sources,
            "status": "analyzed"
        })
        
        return {
            "session_id": session_id,
            "sources": sources,
            "status": "analyzed"
        }
        
    except Exception as e:
        print(f"[FORGE-COMPLETE ERROR] {e}")
        traceback.print_exc()
        session_manager.update_session(session_id, {
            "status": "error",
            "error": str(e)
        })
        raise HTTPException(500, f"Upload failed: {str(e)}")


class EvolveRequest(BaseModel):
    filename: str
    session_id: str
    tags: List[str] = []

@router.post("/evolve")
async def evolve_track(request: EvolveRequest):
    """Evolve a track using Smart Evolution Engine."""
    from app.engines.evolution_engine import EvolutionEngine
    
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
        
    # Find file
    filepath = None
    if "sources" in session:
        for s in session["sources"]:
            if s["filename"] == request.filename:
                filepath = Path(s["path"])
                break
                
    if not filepath or not filepath.exists():
        raise HTTPException(404, "File not found")
    
    output_dir = session["output_dir"] / "evolved"
    output_dir.mkdir(exist_ok=True)
    
    loop = asyncio.get_event_loop()
    
    def run_evolution():
        engine = EvolutionEngine()
        return engine.evolve(filepath, output_dir, request.tags)
        
    result = await loop.run_in_executor(get_executor(), run_evolution)
    return result


@router.post("/forge-complete/{session_id}/process")
async def forge_complete_process(
    session_id: str,
    background_tasks: BackgroundTasks,
    roles: str = "",  # JSON string of {filename: role}
    enabled_presets: str = "",  # comma-separated preset names
    crops: str = "", # JSON string of {filename: {start: float, end: float}}
    quality: str = "standard", # standard, high (ensemble)
    rhythm_anchor_filename: Optional[str] = None,  # NEW: Track for BPM reference
    harmonic_anchor_filename: Optional[str] = None,  # NEW: Track for Key reference
    target_bpm: Optional[float] = None,  # Manual BPM override
    target_key: Optional[str] = None,  # Manual key override
    target_mode: Optional[str] = None,  # Manual mode override
    vocal_settings: str = "" # JSON string of custom vocal settings
):
    """
    Start the processing job in the background with DUAL-ANCHOR support.
    
    Chimera Protocol:
    - rhythm_anchor_filename: Source track for BPM (all loops time-stretched to match)
    - harmonic_anchor_filename: Source track for Key (all loops pitch-shifted to match)
    - Can be the same track or different tracks
    
    Returns immediately so the frontend doesn't timeout.
    """
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    session_manager.update_session(session_id, {
        "status": "processing",
        "progress": 0,
        "message": "starting job..."
    })
    
    # Parse params once (with error handling)
    import json as json_lib
    try:
        role_map = json_lib.loads(roles) if roles else {}
    except json_lib.JSONDecodeError:
        role_map = {}
    
    try:
        crop_map = json_lib.loads(crops) if crops else {}
    except json_lib.JSONDecodeError:
        crop_map = {}
    
    try:
        vocal_config = json_lib.loads(vocal_settings) if vocal_settings else None
    except json_lib.JSONDecodeError:
        vocal_config = None
    
    preset_list = [p.strip() for p in enabled_presets.split(',') if p.strip()] if enabled_presets else []
    
    # Add to background tasks with new signature
    background_tasks.add_task(
        ForgeService.process_session,
        session_id,
        role_map,
        preset_list,
        crop_map,
        quality,
        rhythm_anchor_filename,
        harmonic_anchor_filename,
        target_bpm,
        target_key,
        target_mode,
        vocal_config
    )
    
    return {
        "session_id": session_id,
        "status": "started",
        "message": "Job started in background"
    }


@router.get("/forge-complete/{session_id}/status")
async def get_forge_status(session_id: str):
    """
    Poll this endpoint to check job progress.
    
    SENIOR-LEVEL FIX: Uses completely independent watchdog system.
    This endpoint NEVER blocks, even if main event loop is completely stuck.
    """
    from app.services.progress_watchdog import get_watchdog
    
    # Strategy 1: Get progress from watchdog (lock-free, atomic, never blocks)
    watchdog = get_watchdog()
    watchdog_data = watchdog.get_progress(session_id)
    
    # Strategy 2: Try to get session data (with timeout)
    session_data = None
    try:
        # Use asyncio.wait_for with very short timeout
        session_data = await asyncio.wait_for(
            asyncio.to_thread(lambda: session_manager.get_session(session_id)),
            timeout=0.05  # Even faster - 50ms
        )
    except (asyncio.TimeoutError, Exception):
        # If session manager is blocked, use watchdog data only
        pass
    
    # Combine data: watchdog (always available) + session (if available)
    if watchdog_data:
        # Use watchdog as primary source (it's always available)
        progress = watchdog_data.get("progress", 0)
        message = watchdog_data.get("message", "")
        
        # Merge with session data if available
        if session_data:
            return {
                "status": session_data.get("status", "processing"),
                "progress": progress,  # Use watchdog progress (more reliable)
                "message": message,  # Use watchdog message
                "results": session_data.get("results", []),
                "anchor_key": session_data.get("anchor_key", ""),
                "track_progress": session_data.get("track_progress", {}),
                "timestamp": watchdog_data.get("timestamp", time.time())
            }
        else:
            # Session manager blocked, but we have watchdog data
            return {
                "status": "processing",
                "progress": progress,
                "message": message,
                "results": [],
                "anchor_key": "",
                "track_progress": {},
                "timestamp": watchdog_data.get("timestamp", time.time()),
                "note": "Using watchdog data (session manager may be busy)"
            }
    elif session_data:
        # No watchdog data, but session is available
        return {
            "status": session_data.get("status", "unknown"),
            "progress": session_data.get("progress", 0),
            "message": session_data.get("message", ""),
            "results": session_data.get("results", []),
            "anchor_key": session_data.get("anchor_key", ""),
            "track_progress": session_data.get("track_progress", {})
        }
    else:
        # Neither available - session not found
        raise HTTPException(404, "Session not found")


# =============================================================================
# WORKER FUNCTIONS IMPORT
# =============================================================================
from app.forge_workers import (
    analyze_track_task,
    worker_extract_stem,
    worker_process_vocal,
    worker_create_shadow,
    worker_create_sparkle,
    worker_extract_loops,
    worker_analyze_stem_inline
)




@router.get("/download-complete/{session_id}")
async def download_complete_stems(session_id: str):
    """Download the complete stem pack."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    zip_path = session.get("zip_path")
    
    if not zip_path or not Path(zip_path).exists():
        raise HTTPException(400, "No processed stems available")
    
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename="dreamforge_stems.zip"
    )


@router.post("/process/stack")
async def process_vocal_stack(request: VocalStackRequest):
    """
    Process vocals with multiple presets at once.
    Creates a "vocal stack" - multiple variations of the same vocal.
    """
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    if not session.get("files"):
        raise HTTPException(400, "No files uploaded")
    
    session_manager.update_session(request.session_id, {"status": "processing_stack"})
    
    # Get all preset names if none specified
    forge = get_forge()
    all_presets = [p['name'] for p in forge.get_available_presets()]
    presets_to_use = request.enabled_presets if request.enabled_presets else all_presets
    
    # Get file paths
    filepaths = [Path(f["path"]) for f in session["files"]]
    output_dir = session["output_dir"]
    output_dir.mkdir(parents=True, exist_ok=True)
    
    results = []
    
    loop = asyncio.get_event_loop()
    
    for preset_name in presets_to_use:
        # Build config for this preset
        config = ProcessingConfig(
            target_key=request.target_key,
            target_mode=request.target_mode,
            correction_strength=request.correction_strength,
            artifact_preset=preset_name.lower().replace(' ', '_'),
            custom_artifacts={}
        )
        
        def run_processing(cfg=config, paths=filepaths, out=output_dir, preset=preset_name):
            # Create preset-specific output dir
            preset_dir = out / preset.lower().replace(' ', '_')
            preset_dir.mkdir(exist_ok=True)
            return forge.process_batch(paths, preset_dir, cfg)
        
        preset_results = await loop.run_in_executor(get_executor(), run_processing)
        
        for r in preset_results:
            results.append({
                "preset": preset_name,
                **r.to_dict()
            })
    
    session_manager.update_session(request.session_id, {
        "results": results,
        "status": "complete"
    })
    
    return {
        "session_id": request.session_id,
        "status": "complete",
        "presets_processed": presets_to_use,
        "total_outputs": len(results),
        "results": results
    }


@router.get("/analyze-detailed/{session_id}/{filename}")
async def get_detailed_analysis(session_id: str, filename: str, role: str = 'other'):
    """
    Get detailed analysis for visualization (waveform, VAD, candidates).
    """
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
        
    # Find file path
    filepath = None
    if "sources" in session:
        for s in session["sources"]:
            if s["filename"] == filename:
                filepath = Path(s["path"])
                break
    elif "files" in session:
        for f in session["files"]:
            if f["filename"] == filename:
                filepath = Path(f["path"])
                break
                
    if not filepath or not filepath.exists():
        raise HTTPException(404, "File not found")
        
    # Run analysis
    from .engines.loop_factory import LoopFactory
    
    loop = asyncio.get_event_loop()
    def run_analysis():
        factory = LoopFactory()
        return factory.analyze_for_visualization(filepath, role)
        
    data = await loop.run_in_executor(get_executor(), run_analysis)
    return data


@router.get("/peaks/{session_id}/{filename}")
async def get_peaks(session_id: str, filename: str):
    """Serve binary peak data (.dat) for a processed file."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
        
    output_dir = session["output_dir"]
    peaks_path = output_dir / filename
    
    # Security check: ensure path is within output_dir
    try:
        peaks_path.resolve().relative_to(output_dir.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
        
    if not peaks_path.exists():
        raise HTTPException(404, "Peaks not found")
        
    return FileResponse(peaks_path)


@router.get("/suggest-pitch")
async def suggest_pitch_shifts(
    anchor_key: str,
    anchor_mode: str,
    source_keys: str  # comma-separated list like "A minor,F major,C minor"
):
    """
    Get pitch shift suggestions to match all sources to anchor key.
    
    Returns semitone adjustments for each source to match the anchor.
    """
    KEY_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    
    def get_semitones(from_key: str, to_key: str) -> int:
        from_idx = KEY_ORDER.index(from_key) if from_key in KEY_ORDER else -1
        to_idx = KEY_ORDER.index(to_key) if to_key in KEY_ORDER else -1
        if from_idx == -1 or to_idx == -1:
            return 0
        dist = to_idx - from_idx
        if dist > 6:
            dist -= 12
        if dist < -6:
            dist += 12
        return dist
    
    suggestions = []
    
    for source in source_keys.split(','):
        source = source.strip()
        if not source:
            continue
        parts = source.split(' ')
        if len(parts) >= 2:
            src_key = parts[0]
            src_mode = parts[1]
        else:
            src_key = parts[0]
            src_mode = 'major'
        
        semitones = get_semitones(src_key, anchor_key)
        
        suggestions.append({
            "source_key": f"{src_key} {src_mode}",
            "anchor_key": f"{anchor_key} {anchor_mode}",
            "semitones": semitones,
            "direction": "up" if semitones > 0 else "down" if semitones < 0 else "none",
            "description": f"Pitch {'up' if semitones > 0 else 'down'} {abs(semitones)} semitone{'s' if abs(semitones) != 1 else ''}" if semitones != 0 else "Already in key"
        })
    
    return {
        "anchor": f"{anchor_key} {anchor_mode}",
        "suggestions": suggestions
    }


# =============================================================================
# SINGLE FILE PROCESSING (Quick mode)
# =============================================================================

@router.post("/quick/analyze")
async def quick_analyze(file: UploadFile = File(...)):
    """Quickly analyze a single file without creating a session."""
    # Save temporarily
    temp_dir = FORGE_UPLOAD_DIR / "temp"
    temp_dir.mkdir(exist_ok=True)
    
    temp_path = temp_dir / file.filename
    content = await file.read()
    with open(temp_path, "wb") as f:
        f.write(content)
    
    # Analyze
    loop = asyncio.get_event_loop()
    forge = get_forge()
    
    def run():
        return forge.analyze_track(temp_path)
    
    analysis = await loop.run_in_executor(forge_executor, run)
    
    # Cleanup
    temp_path.unlink(missing_ok=True)
    
    return analysis.to_dict()


@router.post("/quick/process")
async def quick_process(
    file: UploadFile = File(...),
    target_key: Optional[str] = None,
    target_mode: Optional[str] = None,
    correction_strength: float = 1.0,
    artifact_preset: Optional[str] = None
):
    """Quickly process a single file and return it."""
    # Save temporarily
    temp_dir = FORGE_UPLOAD_DIR / "temp"
    temp_dir.mkdir(exist_ok=True)
    output_dir = FORGE_OUTPUT_DIR / "temp"
    output_dir.mkdir(exist_ok=True)
    
    temp_path = temp_dir / file.filename
    content = await file.read()
    with open(temp_path, "wb") as f:
        f.write(content)
    
    # Build config
    config = ProcessingConfig(
        target_key=target_key,
        target_mode=target_mode,
        correction_strength=correction_strength,
        artifact_preset=artifact_preset
    )
    
    # Process
    loop = asyncio.get_event_loop()
    forge = get_forge()
    
    def run():
        return forge.process_track(temp_path, output_dir, config)
    
    result = await loop.run_in_executor(forge_executor, run)
    
    if result.status == "error":
        raise HTTPException(500, result.error)
    
    # Return processed file
    return FileResponse(
        result.output_path,
        media_type="audio/wav",
        filename=result.output_path.name
    )


# =============================================================================
# WEBSOCKET FOR REAL-TIME PROGRESS
# =============================================================================

forge_ws_connections: dict[str, WebSocket] = {}


@router.websocket("/ws/{session_id}")
async def forge_websocket(websocket: WebSocket, session_id: str):
    """WebSocket for real-time processing progress."""
    await websocket.accept()
    forge_ws_connections[session_id] = websocket
    
    try:
        while True:
            # Keep connection alive
            await asyncio.sleep(10)
            await websocket.send_json({"ping": True})
            
    except WebSocketDisconnect:
        pass
    finally:
        forge_ws_connections.pop(session_id, None)


async def send_forge_update(session_id: str, update: dict):
    """Send update to WebSocket client."""
    ws = forge_ws_connections.get(session_id)
    if ws:
        try:
            await ws.send_json(update)
        except:
            pass


# =============================================================================
# SPECTRAL PROCESSING (Advanced)
# =============================================================================

_spectral: Optional[SpectralEngine] = None

def get_spectral() -> SpectralEngine:
    """Get or create SpectralEngine instance."""
    global _spectral
    if _spectral is None:
        _spectral = SpectralEngine()
    return _spectral


class SpectralRequest(BaseModel):
    effect: str  # 'freeze', 'paulstretch', 'blur', 'texture'
    freeze_point: float = 0.5
    duration: float = 10.0
    stretch_factor: float = 8.0
    blur_amount: float = 0.5
    texture_type: str = 'shimmer'
    mix: float = 0.5


@router.post("/spectral/process")
async def spectral_process(
    file: UploadFile = File(...),
    effect: str = 'freeze',
    freeze_point: float = 0.5,
    duration: float = 10.0,
    stretch_factor: float = 8.0,
    blur_amount: float = 0.5,
    texture_type: str = 'shimmer',
    mix: float = 0.5
):
    """
    Apply advanced spectral effects.
    
    Effects:
    - freeze: Time-frozen texture at a specific point
    - paulstretch: Extreme time-stretching (ambient)
    - blur: Spectral smearing/softening
    - texture: Apply shimmer/metallic/cloud convolution
    """
    import librosa
    import subprocess
    
    # Save temp file
    temp_dir = FORGE_UPLOAD_DIR / "temp"
    temp_dir.mkdir(exist_ok=True)
    output_dir = FORGE_OUTPUT_DIR / "temp"
    output_dir.mkdir(exist_ok=True)
    
    temp_path = temp_dir / file.filename
    content = await file.read()
    with open(temp_path, "wb") as f:
        f.write(content)
    
    loop = asyncio.get_event_loop()
    spectral = get_spectral()
    
    def process():
        # Load audio
        audio, sr = librosa.load(str(temp_path), sr=44100, mono=True)
        
        if effect == 'freeze':
            result = spectral.spectral_freeze(
                audio, 
                freeze_point=freeze_point,
                duration=duration
            )
        elif effect == 'paulstretch':
            result = spectral.paulstretch(
                audio,
                stretch_factor=stretch_factor
            )
        elif effect == 'blur':
            result = spectral.spectral_blur(
                audio,
                blur_amount=blur_amount
            )
        elif effect == 'texture':
            result = spectral.apply_texture(
                audio,
                texture_type=texture_type,
                mix=mix
            )
        else:
            result = audio
        
        # Save output
        output_path = output_dir / f"{temp_path.stem}_{effect}.wav"
        
        # Use ffmpeg to save
        cmd = [
            'ffmpeg', '-y',
            '-f', 'f32le',
            '-ar', '44100',
            '-ac', '1',
            '-i', '-',
            '-acodec', 'pcm_f32le',
            str(output_path)
        ]
        
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        proc.communicate(input=result.astype('float32').tobytes())
        
        return output_path
    
    output_path = await loop.run_in_executor(forge_executor, process)
    
    # Cleanup temp input
    temp_path.unlink(missing_ok=True)
    
    return FileResponse(
        output_path,
        media_type="audio/wav",
        filename=output_path.name
    )


@router.get("/spectral/effects")
async def get_spectral_effects():
    """Get available spectral effects and their parameters."""
    return {
        "effects": [
            {
                "id": "freeze",
                "name": "Spectral Freeze",
                "description": "Freeze audio at a moment, creating infinite sustain",
                "params": [
                    {"name": "freeze_point", "type": "float", "min": 0, "max": 1, "default": 0.5},
                    {"name": "duration", "type": "float", "min": 1, "max": 60, "default": 10}
                ]
            },
            {
                "id": "paulstretch",
                "name": "Paulstretch",
                "description": "Extreme time-stretching for ambient textures",
                "params": [
                    {"name": "stretch_factor", "type": "float", "min": 2, "max": 50, "default": 8}
                ]
            },
            {
                "id": "blur",
                "name": "Spectral Blur",
                "description": "Smear frequencies for soft, diffuse textures",
                "params": [
                    {"name": "blur_amount", "type": "float", "min": 0, "max": 1, "default": 0.5}
                ]
            },
            {
                "id": "texture",
                "name": "Texture Convolution",
                "description": "Apply shimmer, metallic, or cloud textures",
                "params": [
                    {"name": "texture_type", "type": "select", "options": ["shimmer", "metallic", "cloud", "reverse"], "default": "shimmer"},
                    {"name": "mix", "type": "float", "min": 0, "max": 1, "default": 0.5}
                ]
            }
        ]
    }

@router.post("/forge-complete/{session_id}/mutate")
async def mutate_loop(session_id: str, filename: str, texture: str):
    """
    Apply a generative DSP texture to a specific loop.
    """
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    output_dir = session["output_dir"]
    
    # Find the file path in results
    target_path = None
    for res in session["results"]:
        if res["filename"] == filename:
            target_path = Path(res["path"])
            break
            
    if not target_path or not target_path.exists():
        raise HTTPException(404, "File not found")
        
    from .engines.loop_factory import LoopFactory
    loop_factory = LoopFactory()
    
    def run_mutate():
        return loop_factory.mutate(target_path, output_dir, texture)
        
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(forge_executor, run_mutate)
    
    # Add to session results so it can be downloaded later
    session["results"].append({
        "role": "mutation",
        "type": "loop",
        "filename": result["filename"],
        "path": result["path"],
        "texture": texture,
        "parent": filename,
        # Inherit BPM/Bars from parent if possible, or re-analyze
        "bpm": next((r.get("bpm") for r in session["results"] if r["filename"] == filename), 0),
        "bars": next((r.get("bars") for r in session["results"] if r["filename"] == filename), 4)
    })
    
    return result


# =============================================================================
# GROOVE TRANSFER ENGINE
# =============================================================================

class GrooveExtractRequest(BaseModel):
    """Request to extract groove template from a track."""
    session_id: str
    filename: str
    bpm: float
    subdivision: str = "16th"  # '8th', '16th', '32nd', 'triplet'


class GrooveApplyRequest(BaseModel):
    """Request to apply groove to a target track."""
    session_id: str
    source_filename: str  # File to extract groove from
    target_filename: str  # File to apply groove to
    source_bpm: float
    target_bpm: float
    strength: float = 1.0  # 0-1, how much groove to apply
    subdivision: str = "16th"


class GrooveCompatibilityRequest(BaseModel):
    """Request to analyze groove compatibility between two tracks."""
    session_id: str
    filename_a: str
    filename_b: str
    bpm_a: float
    bpm_b: float


@router.post("/groove/extract")
async def extract_groove(request: GrooveExtractRequest):
    """
    Extract groove template from a track.
    
    Returns groove characteristics and template data for visualization.
    """
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    # Find file
    filepath = None
    if "results" in session:
        for r in session["results"]:
            if r["filename"] == request.filename:
                filepath = Path(r["path"])
                break
    
    if not filepath or not filepath.exists():
        raise HTTPException(404, f"File not found: {request.filename}")
    
    # Extract groove
    from app.engines.groove_engine import GrooveEngine
    from app.engines.torch_utils import load_audio
    
    loop = asyncio.get_event_loop()
    
    def run_extraction():
        engine = GrooveEngine()
        audio_tensor = load_audio(str(filepath))
        audio = audio_tensor.cpu().numpy()
        if audio.ndim > 1:
            audio = audio[0]  # Take first channel
        
        groove = engine.extract_groove(
            audio, 
            bpm=request.bpm,
            subdivision=request.subdivision
        )
        
        # Generate visualization data
        viz_data = engine.visualize_groove(groove)
        
        return {
            "groove_id": str(uuid.uuid4()),
            "filename": request.filename,
            "bpm": groove.bpm,
            "type": groove.groove_type,
            "swing_ms": groove.swing_amount * 1000,
            "tightness": groove.tightness,
            "onset_count": len(groove.onsets),
            "visualization": viz_data
        }
    
    result = await loop.run_in_executor(get_executor(), run_extraction)
    
    # Store groove template in session for later use
    if "groove_templates" not in session:
        session["groove_templates"] = {}
    session["groove_templates"][request.filename] = result
    
    return result


@router.post("/groove/apply")
async def apply_groove(request: GrooveApplyRequest):
    """
    Apply groove from one track to another.
    
    Creates a new file with the groove applied.
    """
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    # Find source and target files
    source_path = None
    target_path = None
    
    for r in session.get("results", []):
        if r["filename"] == request.source_filename:
            source_path = Path(r["path"])
        if r["filename"] == request.target_filename:
            target_path = Path(r["path"])
    
    if not source_path or not source_path.exists():
        raise HTTPException(404, f"Source file not found: {request.source_filename}")
    if not target_path or not target_path.exists():
        raise HTTPException(404, f"Target file not found: {request.target_filename}")
    
    output_dir = session["output_dir"]
    
    # Apply groove
    from app.engines.groove_engine import GrooveEngine
    from app.engines.torch_utils import load_audio, save_audio
    
    loop = asyncio.get_event_loop()
    
    def run_application():
        engine = GrooveEngine()
        
        # Load source and extract groove
        source_audio = load_audio(str(source_path)).cpu().numpy()
        if source_audio.ndim > 1:
            source_audio = source_audio[0]
        
        groove_template = engine.extract_groove(
            source_audio,
            bpm=request.source_bpm,
            subdivision=request.subdivision
        )
        
        # Load target
        target_audio = load_audio(str(target_path)).cpu().numpy()
        if target_audio.ndim > 1:
            target_audio = target_audio[0]
        
        # Apply groove
        grooved_audio = engine.apply_groove(
            target_audio,
            target_bpm=request.target_bpm,
            groove_template=groove_template,
            strength=request.strength
        )
        
        # Save result
        output_filename = f"{Path(request.target_filename).stem}_grooved.wav"
        output_path = output_dir / output_filename
        
        save_audio(str(output_path), grooved_audio, 44100)
        
        return {
            "filename": output_filename,
            "path": str(output_path),
            "source_groove": request.source_filename,
            "strength": request.strength,
            "swing_applied_ms": groove_template.swing_amount * 1000 * request.strength
        }
    
    result = await loop.run_in_executor(get_executor(), run_application)
    
    # Add to session results
    if "results" not in session:
        session["results"] = []
    session["results"].append({
        "role": "grooved",
        "filename": result["filename"],
        "path": result["path"],
        "source_groove": result["source_groove"],
        "preset": f"Groove Transfer ({int(result['strength'] * 100)}%)",
        "bpm": request.target_bpm,
        "effect_chain": [f"Groove Transfer from {request.source_filename}"]
    })
    
    return result


@router.post("/groove/compatibility")
async def analyze_groove_compatibility(request: GrooveCompatibilityRequest):
    """
    Analyze how compatible two grooves are.
    
    Returns similarity scores and recommendations.
    """
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    # Find files
    file_a_path = None
    file_b_path = None
    
    for r in session.get("results", []):
        if r["filename"] == request.filename_a:
            file_a_path = Path(r["path"])
        if r["filename"] == request.filename_b:
            file_b_path = Path(r["path"])
    
    if not file_a_path or not file_a_path.exists():
        raise HTTPException(404, f"File A not found: {request.filename_a}")
    if not file_b_path or not file_b_path.exists():
        raise HTTPException(404, f"File B not found: {request.filename_b}")
    
    # Analyze compatibility
    from app.engines.groove_engine import GrooveEngine
    from app.engines.torch_utils import load_audio
    
    loop = asyncio.get_event_loop()
    
    def run_analysis():
        engine = GrooveEngine()
        
        # Extract grooves
        audio_a = load_audio(str(file_a_path)).cpu().numpy()
        if audio_a.ndim > 1:
            audio_a = audio_a[0]
        
        audio_b = load_audio(str(file_b_path)).cpu().numpy()
        if audio_b.ndim > 1:
            audio_b = audio_b[0]
        
        groove_a = engine.extract_groove(audio_a, bpm=request.bpm_a)
        groove_b = engine.extract_groove(audio_b, bpm=request.bpm_b)
        
        # Analyze compatibility
        compat = engine.analyze_compatibility(groove_a, groove_b)
        
        return {
            "filename_a": request.filename_a,
            "filename_b": request.filename_b,
            "groove_a": {
                "type": groove_a.groove_type,
                "swing_ms": groove_a.swing_amount * 1000,
                "tightness": groove_a.tightness
            },
            "groove_b": {
                "type": groove_b.groove_type,
                "swing_ms": groove_b.swing_amount * 1000,
                "tightness": groove_b.tightness
            },
            "compatibility": compat
        }
    
    result = await loop.run_in_executor(get_executor(), run_analysis)
    return result


# =============================================================================
# PHRASE DETECTION ENGINE
# =============================================================================

class PhraseDetectRequest(BaseModel):
    """Request to detect musical phrases in a track."""
    session_id: str
    filename: str
    bpm: Optional[float] = None


@router.post("/phrases/detect")
async def detect_phrases(request: PhraseDetectRequest):
    """
    Detect musical phrase boundaries in vocals or melody.
    
    Returns detected phrases with start/end times, types, and confidence scores.
    """
    session = session_manager.get_session(request.session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    # Find file
    filepath = None
    if "results" in session:
        for r in session["results"]:
            if r["filename"] == request.filename:
                filepath = Path(r["path"])
                break
    
    if not filepath or not filepath.exists():
        raise HTTPException(404, f"File not found: {request.filename}")
    
    # Detect phrases
    from app.engines.phrase_detection import PhraseDetectionEngine
    
    loop = asyncio.get_event_loop()
    
    def run_detection():
        engine = PhraseDetectionEngine(
            silence_threshold_db=-40.0,
            min_phrase_duration=1.0,
            max_phrase_duration=10.0,
            min_gap_duration=0.2
        )
        
        phrases = engine.detect_from_file(filepath, bpm=request.bpm)
        
        best_phrases = engine.get_best_loop_phrases(phrases, top_n=10)
        
        return {
            "filename": request.filename,
            "total_phrases": len(phrases),
            "phrases": [
                {
                    "start_time": p.start_time,
                    "end_time": p.end_time,
                    "duration": p.duration,
                    "phrase_type": p.phrase_type,
                    "confidence": p.confidence,
                    "pitch_range": p.pitch_range,
                    "energy": p.energy
                }
                for p in best_phrases
            ]
        }
    
    result = await loop.run_in_executor(get_executor(), run_detection)
    return result
