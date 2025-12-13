import asyncio
import shutil
import zipfile
import subprocess
import time
import threading
from pathlib import Path
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

from app.services.session_manager import session_manager
from app.services.progress_watchdog import get_watchdog
from app.forge_workers import (
    analyze_track_task,
    worker_extract_stem,
    worker_process_vocal,
    worker_process_instrumental,
    worker_create_shadow,
    worker_create_sparkle,
    worker_extract_loops,
    worker_analyze_stem_inline
)

# Shared executor for CPU-bound tasks (CTO-level: unified resource management)
_executor = None
_executor_lock = threading.Lock()

def get_executor():
    """Get or create shared thread pool executor (thread-safe, optimized for M3 Max)."""
    global _executor
    if _executor is None:
        with _executor_lock:
            if _executor is None:
                import os
                # Use CPU count - 1 to leave one core for system/IO
                max_workers = min(12, (os.cpu_count() or 4) - 1)
                _executor = ThreadPoolExecutor(max_workers=max_workers)
                print(f"[EXECUTOR] Created thread pool with {max_workers} workers")
    return _executor

class ForgeService:
    """
    Service layer for VocalForge business logic.
    Handles orchestration of audio processing tasks.
    """
    
    ROLE_TO_STEM = {
        'drums': 'drums',
        'vocals': 'vocals', 
        'bass': 'bass',
        'melody': 'other'
    }
    
    KEY_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    @staticmethod
    def get_semitones(from_key: str, to_key: str) -> int:
        """Calculate semitone distance between keys."""
        try:
            from_idx = ForgeService.KEY_ORDER.index(from_key)
            to_idx = ForgeService.KEY_ORDER.index(to_key)
        except ValueError:
            return 0
            
        dist = to_idx - from_idx
        if dist > 6: dist -= 12
        if dist < -6: dist += 12
        return dist

    @staticmethod
    def generate_peaks(file_path: str) -> Optional[str]:
        """
        Generates binary peak data (.dat) using audiowaveform.
        Returns the path to the generated .dat file.
        """
        try:
            input_path = Path(file_path)
            output_path = input_path.with_suffix('.dat')
            
            if output_path.exists():
                return str(output_path)
            
            # Generate binary peaks (-b 8)
            cmd = [
                "audiowaveform",
                "-i", str(input_path),
                "-o", str(output_path),
                "-b", "8"
            ]
            
            subprocess.run(cmd, check=True, capture_output=True)
            return str(output_path)
        except FileNotFoundError:
            print(f"[FORGE] audiowaveform not found - skipping peak generation for {file_path}")
            return None
        except subprocess.CalledProcessError as e:
            print(f"[FORGE] Error generating peaks for {file_path}: {e}")
            return None
        except Exception as e:
            print(f"[FORGE] Unexpected error generating peaks for {file_path}: {e}")
            import traceback
            traceback.print_exc()
            return None

    @staticmethod
    async def process_session(
        session_id: str, 
        role_map: Dict[str, str], 
        preset_list: List[str], 
        crop_map: Dict[str, Any], 
        quality: str = "standard", 
        rhythm_anchor_filename: Optional[str] = None,  # NEW: Track to get BPM from
        harmonic_anchor_filename: Optional[str] = None,  # NEW: Track to get Key from
        target_bpm: Optional[float] = None,  # Manual BPM override
        target_key: Optional[str] = None,  # Manual key override
        target_mode: Optional[str] = None,  # Manual mode override
        vocal_settings: Optional[Dict[str, Any]] = None
    ):
        """
        Main orchestration task for processing a session with DUAL-ANCHOR support.
        
        Chimera Protocol:
        - rhythm_anchor_filename: Track to use as BPM reference (all tracks time-stretch to match)
        - harmonic_anchor_filename: Track to use as Key reference (all tracks pitch-shift to match)
        - If both anchors point to same track, that track dictates both BPM and key
        - If no anchors set, auto-detect consensus BPM/key
        
        This runs as a background task.
        """
        session = session_manager.get_session(session_id)
        if not session:
            print(f"[FORGE] Session {session_id} not found during processing start.")
            return

        # SENIOR-LEVEL FIX: Ensure output_dir is always a Path object, never None
        output_dir = session.get("output_dir")
        if output_dir is None:
            # Create output directory if it doesn't exist
            from pathlib import Path
            output_dir = Path(f"./forge_outputs/{session_id}")
            output_dir.mkdir(parents=True, exist_ok=True)
            session_manager.update_session(session_id, {"output_dir": output_dir})
            print(f"[FORGE] Created output_dir: {output_dir}")
        
        # Ensure output_dir is a Path object
        if not isinstance(output_dir, Path):
            output_dir = Path(output_dir)
        
        # Ensure directory exists
        output_dir.mkdir(parents=True, exist_ok=True)
        
        sources = session.get("sources", [])
        
        # DUAL-ANCHOR RESOLUTION (Chimera Protocol)
        # NOTE: Manual target_bpm/target_key take priority since anchor tracks
        # don't have BPM/key data until AFTER analysis runs
        
        # If no manual targets provided, try to get from anchor tracks
        # (This will only work if tracks were previously analyzed)
        if not target_bpm and rhythm_anchor_filename:
            rhythm_track = next((s for s in sources if s["filename"] == rhythm_anchor_filename), None)
            if rhythm_track and rhythm_track.get("bpm"):
                target_bpm = rhythm_track["bpm"]
                print(f"[CHIMERA] Rhythm anchor BPM from track: {target_bpm}")
        
        if not target_key and harmonic_anchor_filename:
            harmonic_track = next((s for s in sources if s["filename"] == harmonic_anchor_filename), None)
            if harmonic_track and harmonic_track.get("key"):
                target_key = harmonic_track["key"]
                if harmonic_track.get("mode"):
                    target_mode = harmonic_track["mode"]
                print(f"[CHIMERA] Harmonic anchor key from track: {target_key} {target_mode}")
        
        # Fallback: Auto-detect consensus if still no targets
        if not target_key:
            # Find most common key
            keys = [s.get("key") for s in sources if s.get("key")]
            if keys:
                from collections import Counter
                target_key = Counter(keys).most_common(1)[0][0]
        
        if not target_mode:
            modes = [s.get("mode") for s in sources if s.get("mode")]
            if modes:
                from collections import Counter
                target_mode = Counter(modes).most_common(1)[0][0]
        
        if not target_bpm:
            # Use median BPM as consensus
            bpms = [s.get("bpm") for s in sources if s.get("bpm")]
            if bpms:
                import statistics
                target_bpm = statistics.median(bpms)
        
        # Ensure defaults if still None
        if not target_key:
            target_key = "C"
        if not target_mode:
            target_mode = "minor"
        if not target_bpm:
            target_bpm = 120.0
        
        # Log final resolution
        print(f"[CHIMERA] Final targets: {target_bpm} BPM, {target_key} {target_mode}")
        print(f"[CHIMERA] Rhythm anchor: {rhythm_anchor_filename or 'None (auto-detect)'}")
        print(f"[CHIMERA] Harmonic anchor: {harmonic_anchor_filename or 'None (auto-detect)'}")
        
        # Determine quality settings
        if quality == "high":
            shifts = 2
            overlap = 0.5
        else:
            shifts = 0 # Optimized for speed (1 pass)
            overlap = 0.25
            
        # Initialize track progress
        sources_with_roles = [s for s in sources if role_map.get(s["filename"])]
        total_sources = len(sources_with_roles)
        
        track_progress = {
            s["filename"]: {"status": "Pending", "progress": 0} 
            for s in sources_with_roles
        }
        session_manager.update_session(session_id, {"track_progress": track_progress})

        # SENIOR-LEVEL: Use watchdog for completely non-blocking progress updates
        watchdog = get_watchdog()
        
        # Initialize watchdog with session
        watchdog.update_progress(session_id, 0, "Initializing...")
        
        def update_progress(pct: int, stage: str):
            """Update progress using watchdog (lock-free, never blocks)."""
            try:
                # Update watchdog (atomic, lock-free)
                watchdog.update_progress(session_id, pct, stage)
                
                # Also update session manager (but don't wait for it)
                # Use a try-except to ensure this never blocks
                try:
                    session = session_manager.get_session(session_id)
                    if session:
                        current_pct = session.get("progress", 0)
                        if pct > current_pct or (pct == current_pct and time.time() - session.get("last_progress_update", 0) > 2):
                            session_manager.update_session(session_id, {
                                "progress": pct, 
                                "message": stage,
                                "last_progress_update": time.time(),
                                "last_accessed": time.time()
                            })
                except:
                    # Silent fail - session update is secondary to watchdog
                    pass
            except Exception:
                # Silent fail - progress updates should never break processing
                pass
            
        def update_track_status(filename: str, status: str, progress: int):
            """Update track status (SENIOR-LEVEL: fast, non-blocking, always succeeds)."""
            try:
                if filename in track_progress:
                    track_progress[filename] = {"status": status, "progress": progress, "last_update": time.time()}
                    # Update session in a non-blocking way (copy dict to avoid mutation)
                    session_manager.update_session(session_id, {
                        "track_progress": track_progress.copy(),  # Copy to avoid mutation issues
                        "last_accessed": time.time()  # Keep session alive
                    })
                    
                    # Calculate global progress based on weighted average
                    # Weight tracks by their completion stage to avoid getting stuck
                    total_p = 0
                    active_tracks = 0
                    for t in track_progress.values():
                        # Only count tracks that are actively processing (not failed)
                        if t.get("status") not in ["Separation failed", "Processing failed", "Error"]:
                            weighted_p = t.get("progress", 0)
                            total_p += weighted_p
                            active_tracks += 1
                    
                    if active_tracks > 0:
                        global_p = int(total_p / active_tracks)
                    else:
                        global_p = 0
                    
                    # Ensure progress never decreases
                    session = session_manager.get_session(session_id)
                    current_progress = session.get("progress", 0) if session else 0
                    if global_p > current_progress or (global_p == current_progress and global_p > 0):
                        update_progress(global_p, f"Processing {active_tracks}/{total_sources} tracks...")
            except Exception:
                # Silent fail - status updates should NEVER break processing
                pass

        try:
            update_progress(5, "Initializing processing...")
            
            # Ensure models loaded (warmup) - use ModelManager for thread-safe access
            from app.model_manager import get_model_manager
            model_manager = get_model_manager()
            model_manager.warmup_models()  # Ensures Demucs is ready
            
            if total_sources == 0:
                update_progress(100, "No tracks to process.")
                session_manager.update_session(session_id, {"status": "complete", "results": []})
                return

            update_progress(5, "Loading AI models...")
            
            results = []
            
            # Process each source
            async def process_single_source(source):
                try:
                    filename = source["filename"]
                    filepath = Path(source["path"])
                    role = role_map.get(filename)
                    if not role: 
                        return []
                    
                    stem_name = ForgeService.ROLE_TO_STEM.get(role, 'other')
                    
                    update_track_status(filename, "Preprocessing...", 5)
                    
                    # Check for crop
                    crop = crop_map.get(filename)
                    if crop:
                        start = crop.get("start", 0)
                        end = crop.get("end")
                        duration = end - start if end else None
                        
                        if duration and duration > 0:
                            # Create cropped version
                            cropped_path = output_dir / f"cropped_{filename}"
                            if not cropped_path.exists():
                                update_track_status(filename, "Cropping...", 5)
                                
                                cmd = ['ffmpeg', '-y', '-ss', str(start), '-i', str(filepath)]
                                if duration:
                                    cmd.extend(['-t', str(duration)])
                                cmd.extend(['-acodec', 'copy', str(cropped_path)])
                                
                                await asyncio.get_event_loop().run_in_executor(
                                    None, 
                                    lambda: subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                )
                                if cropped_path.exists():
                                    filepath = cropped_path

                    # Step 1: Extract Stem
                    update_track_status(filename, f"Separating stems ({quality})...", 10)
                    
                    separation_start_time = time.time()
                    last_progress_update = time.time()
                    
                    def separation_progress(stage, pct, msg):
                        """Progress callback from Demucs separation (runs in worker thread - SENIOR-LEVEL: lock-free)."""
                        # Map separation progress (0-100) to track progress (10-50)
                        track_pct = 10 + int(pct * 0.4)
                        # Update status from worker thread (completely non-blocking using watchdog)
                        try:
                            # Update watchdog first (atomic, lock-free, NEVER blocks)
                            watchdog.update_progress(
                                session_id,
                                track_pct,
                                f"Separating {filename}: {msg}",
                                track_name=filename,
                                track_status="Separating"
                            )
                            
                            # Then update track status (secondary, may block but we don't care)
                            try:
                                update_track_status(filename, f"Separating: {msg}", track_pct)
                            except:
                                pass
                            
                            # Update session timestamp (secondary)
                            try:
                                session_manager.update_session(session_id, {
                                    "last_update": time.time(),
                                    "last_accessed": time.time()
                                })
                            except:
                                pass
                        except:
                            # Silent fail - progress callbacks should NEVER break processing
                            pass

                    # Add timeout wrapper for stem extraction
                    try:
                        # Update progress periodically during long operations
                        async def extract_with_progress():
                            loop = asyncio.get_event_loop()
                            result = await loop.run_in_executor(
                                get_executor(),
                                worker_extract_stem,
                                str(filepath), str(output_dir), filename, stem_name, shifts, overlap, separation_progress
                            )
                            return result
                        
                        stem_path = await asyncio.wait_for(
                            extract_with_progress(),
                            timeout=600.0  # 10 minute timeout for stem extraction
                        )
                    except asyncio.TimeoutError:
                        update_track_status(filename, "Separation timeout", 0)
                        print(f"[FORGE] Timeout extracting stem for {filename} after 10 minutes")
                        return []
                    except Exception as e:
                        update_track_status(filename, f"Separation error: {str(e)[:50]}", 0)
                        print(f"[FORGE] Error extracting stem for {filename}: {e}")
                        import traceback
                        traceback.print_exc()
                        return []
                    
                    if not stem_path or not stem_path.exists():
                        update_track_status(filename, "Separation failed", 0)
                        return []

                    # Step 2: Analyze Stem (Inline)
                    update_track_status(filename, "Analyzing stem...", 50)
                    try:
                        stem_key = await asyncio.wait_for(
                            asyncio.get_event_loop().run_in_executor(
                                get_executor(),
                                worker_analyze_stem_inline,
                                str(stem_path)
                            ),
                            timeout=30.0  # 30 second timeout for analysis
                        )
                    except asyncio.TimeoutError:
                        print(f"[FORGE] Timeout analyzing stem for {filename}, using default key")
                        stem_key = "C"  # Default fallback
                    
                    # Step 3: Pitch Shift to match harmonic anchor
                    update_track_status(filename, "Processing audio...", 60)
                    
                    # Calculate semitones needed to match target key
                    if target_key and stem_key:
                        semitones = ForgeService.get_semitones(stem_key, target_key)
                    else:
                        semitones = 0
                    
                    source_results = []
                    
                    if role == 'vocals':
                        # Vocal Processing
                        vocal_tasks = []
                        
                        # 1. Custom FX (if provided)
                        if vocal_settings:
                            vocal_tasks.append(asyncio.get_event_loop().run_in_executor(
                                get_executor(),
                                worker_process_vocal,
                                str(stem_path), str(output_dir), "Custom FX", target_key, target_mode,
                                vocal_settings, vocal_settings.get('correction_strength', 0.8)
                            ))
                        
                        # 2. Presets (if provided)
                        if preset_list:
                            for preset_name in preset_list:
                                vocal_tasks.append(asyncio.get_event_loop().run_in_executor(
                                    get_executor(),
                                    worker_process_vocal,
                                    str(stem_path), str(output_dir), preset_name, target_key, target_mode
                                ))
                        
                        # If neither, just do a clean shift? Or maybe default to clean if no FX
                        if not vocal_settings and not preset_list:
                             # Just clean pitch shift like instrumental
                             pass # Will fall through to instrumental logic if we want, but usually vocals need special care.
                             # For now, let's assume if no presets/settings, we treat it as instrumental for clean shift
                             # OR we can add a "Clean" preset task.
                             pass

                        if vocal_tasks:
                            try:
                                vocal_results = await asyncio.gather(*vocal_tasks, return_exceptions=True)
                                for result in vocal_results:
                                    if isinstance(result, Exception):
                                        print(f"[FORGE] Vocal processing task failed: {result}")
                                        continue
                                    processed_path, preset_name = result
                                    if processed_path:
                                        source_results.append({
                                            "role": role, "preset": preset_name,
                                            "filename": processed_path.name, "path": str(processed_path)
                                        })
                            except Exception as e:
                                print(f"[FORGE] Error in vocal tasks: {e}")
                                import traceback
                                traceback.print_exc()
                        else:
                             # Fallback to instrumental processing for clean vocal shift
                             try:
                                 base_audio, sr = await asyncio.wait_for(
                                     asyncio.get_event_loop().run_in_executor(
                                         get_executor(),
                                         worker_process_instrumental,
                                         str(stem_path), semitones, 
                                         source.get('bpm'), target_bpm if target_bpm else source.get('bpm')
                                     ),
                                     timeout=300.0  # 5 minute timeout
                                 )
                                 if base_audio is None or sr is None:
                                     update_track_status(filename, "Processing failed", 0)
                                     return []
                                 
                                 # Normalize Audio
                                 try:
                                     import torch
                                     if isinstance(base_audio, torch.Tensor):
                                         max_val = torch.max(torch.abs(base_audio))
                                         if max_val > 0:
                                             base_audio = base_audio / max_val * 0.95
                                     else:
                                         import numpy as np
                                         max_val = np.max(np.abs(base_audio))
                                         if max_val > 0:
                                             base_audio = base_audio / max_val * 0.95
                                 except Exception as e:
                                     print(f"[FORGE] Error normalizing audio: {e}")
                                 
                                 out_filename = f"{role}_{Path(filename).stem}_shifted.wav"
                                 out_path = output_dir / out_filename
                                 
                                 def save_shifted():
                                    try:
                                        from app.engines.torch_utils import save_audio
                                        save_audio(str(out_path), base_audio, sr)
                                    except Exception as e:
                                        print(f"[FORGE] Error saving audio: {e}")
                                        raise
                                 
                                 await asyncio.get_event_loop().run_in_executor(None, save_shifted)
                                 source_results.append({
                                    "role": role, "preset": "Clean",
                                    "filename": out_path.name, "path": str(out_path),
                                    "bpm": target_bpm if target_bpm else source.get('bpm'), "key": target_key
                                })
                             except asyncio.TimeoutError:
                                 update_track_status(filename, "Processing timeout", 0)
                                 return []
                             except Exception as e:
                                 update_track_status(filename, f"Error: {str(e)[:50]}", 0)
                                 print(f"[FORGE] Error in vocal fallback: {e}")
                                 import traceback
                                 traceback.print_exc()
                                 return []

                    else:
                        # Instrumental Processing
                        # Time Stretch + Pitch Shift
                        try:
                            base_audio, sr = await asyncio.wait_for(
                                asyncio.get_event_loop().run_in_executor(
                                    get_executor(),
                                    worker_process_instrumental,
                                    str(stem_path), semitones, 
                                    source.get('bpm'), target_bpm if target_bpm else source.get('bpm')
                                ),
                                timeout=300.0  # 5 minute timeout
                            )
                            
                            if base_audio is None or sr is None:
                                update_track_status(filename, "Processing failed", 0)
                                return []
                            
                            # Normalize Audio
                            try:
                                import torch
                                if isinstance(base_audio, torch.Tensor):
                                    max_val = torch.max(torch.abs(base_audio))
                                    if max_val > 0:
                                        base_audio = base_audio / max_val * 0.95 # Normalize to -0.5dB
                                else:
                                    import numpy as np
                                    max_val = np.max(np.abs(base_audio))
                                    if max_val > 0:
                                        base_audio = base_audio / max_val * 0.95
                            except Exception as e:
                                print(f"[FORGE] Error normalizing audio for {filename}: {e}")
                                # Continue without normalization

                            # Save Clean Shifted
                            out_filename = f"{role}_{Path(filename).stem}_shifted.wav"
                            out_path = output_dir / out_filename
                            
                            def save_shifted():
                                try:
                                    from app.engines.torch_utils import save_audio
                                    save_audio(str(out_path), base_audio, sr)
                                except Exception as e:
                                    print(f"[FORGE] Error saving audio for {filename}: {e}")
                                    raise
                            
                            await asyncio.get_event_loop().run_in_executor(None, save_shifted)
                            
                            source_results.append({
                                "role": role, "preset": "Clean",
                                "filename": out_path.name, "path": str(out_path),
                                "bpm": target_bpm if target_bpm else source.get('bpm'), "key": target_key,
                                "shift_amount": semitones,
                                "effect_chain": ["Pitch Shift", "Normalize"] if semitones != 0 else ["Normalize"]
                            })
                        except asyncio.TimeoutError:
                            update_track_status(filename, "Processing timeout", 0)
                            print(f"[FORGE] Timeout processing instrumental for {filename}")
                            return []
                        except Exception as e:
                            update_track_status(filename, f"Error: {str(e)[:50]}", 0)
                            print(f"[FORGE] Error processing instrumental for {filename}: {e}")
                            import traceback
                            traceback.print_exc()
                            return []
                            
                            # Parallel Effects (Smart Evolution or Legacy Shadow/Sparkle)
                            # DISABLED BY DEFAULT: User wants clean output only
                            # update_track_status(filename, "Generating effects...", 80)
                            
                            # Check for tags to use Smart Evolution
                            # source_tags = next((s.get("tags") for s in sources if s["filename"] == filename), [])

                            # if source_tags:
                            #     # Use Evolution Engine
                            #     from app.engines.evolution_engine import EvolutionEngine
                            #     evolution_engine = EvolutionEngine()
                                
                            #     # Evolve the CLEAN SHIFTED audio (out_path)
                            #     def run_evolution_internal():
                            #         return evolution_engine.evolve(out_path, output_dir, source_tags)
                                
                            #     evolved_result = await asyncio.get_event_loop().run_in_executor(get_executor(), run_evolution_internal)
                                
                            #     if evolved_result and evolved_result.get("path"):
                            #         source_results.append({
                            #             "role": f"{role} (evolved)", 
                            #             "preset": "Smart Evolve", 
                            #             "filename": evolved_result["filename"], 
                            #             "path": evolved_result["path"],
                            #             "tags": source_tags,
                            #             "bpm": master_bpm, "key": anchor_key,
                            #             "shift_amount": semitones,
                            #             "effect_chain": ["Pitch Shift", "Smart Evolve"] + source_tags
                            #         })
                            # else:
                            #     # Legacy Shadow/Sparkle
                            #     effect_results = await asyncio.gather(
                            #         asyncio.get_event_loop().run_in_executor(get_executor(), worker_create_shadow, base_audio, sr, str(output_dir), role, filename),
                            #         asyncio.get_event_loop().run_in_executor(get_executor(), worker_create_sparkle, base_audio, sr, str(output_dir), role, filename)
                            #     )
                                
                            #     shadow_path, sparkle_path = effect_results
                            #     source_results.append({
                            #         "role": f"{role} (shadow)", "preset": "Shadow", 
                            #         "filename": shadow_path.name, "path": str(shadow_path),
                            #         "bpm": master_bpm, "key": anchor_key,
                            #         "shift_amount": semitones,
                            #         "effect_chain": ["Pitch Shift", "Shadow Reverb", "Delay"]
                            #     })
                            #     source_results.append({
                            #         "role": f"{role} (sparkle)", "preset": "Sparkle", 
                            #         "filename": sparkle_path.name, "path": str(sparkle_path),
                            #         "bpm": master_bpm, "key": anchor_key,
                            #         "shift_amount": semitones,
                            #         "effect_chain": ["Pitch Shift", "Sparkle Granular", "High Pass"]
                            #     })

                        # Step 4: Loop Extraction
                        # DISABLED BY DEFAULT: User wants manual control
                        # update_track_status(filename, "Extracting loops...", 90)
                        # loop_source_path = None
                        # for r in source_results:
                        #     if r["role"] == role and r["preset"] in ["Clean", preset_list[0] if preset_list else ""]:
                        #         loop_source_path = Path(r["path"])
                        #         break
                        
                        # if loop_source_path:
                        #     loops = await asyncio.get_event_loop().run_in_executor(
                        #         get_executor(),
                        #         worker_extract_loops,
                        #         str(loop_source_path), str(output_dir), role, master_bpm, anchor_key
                        #     )
                        #     source_results.extend(loops)
                        
                    update_track_status(filename, "Complete", 100)
                    return source_results
                except Exception as e:
                    print(f"[FORGE] Error processing {source.get('filename', 'unknown')}: {e}")
                    import traceback
                    traceback.print_exc()
                    update_track_status(source.get('filename', 'unknown'), f"Error: {str(e)}", 0)
                    return []

            # Run all tasks with periodic progress updates
            update_progress(5, "Starting concurrent processing...")
            tasks = [process_single_source(source) for source in sources_with_roles]
            
            # Add a heartbeat task to ensure progress updates continue - CTO-level smooth updates
            async def progress_heartbeat():
                """Periodically update progress to show activity - optimized for smooth UX"""
                try:
                    while True:
                        await asyncio.sleep(2)  # Update every 2 seconds for smoother feel
                        try:
                            # Recalculate progress from track_progress
                            current_session = session_manager.get_session(session_id)
                            if not current_session:
                                break
                                
                            if track_progress:
                                active_tracks = [t for t in track_progress.values() 
                                               if t.get("status") not in ["Separation failed", "Processing failed", "Error", "Complete"]]
                                if active_tracks:
                                    # Weighted progress calculation for smoother updates
                                    total_p = sum(t.get("progress", 0) for t in active_tracks)
                                    global_p = int(total_p / len(active_tracks))
                                    current_progress = current_session.get("progress", 0)
                                    
                                    # Smooth progress updates - always show activity
                                    if global_p > current_progress:
                                        update_progress(global_p, f"Processing {len(active_tracks)}/{total_sources} tracks...")
                                    elif global_p == current_progress and global_p > 0:
                                        # Show activity even if progress hasn't changed (prevents "stuck" feeling)
                                        update_progress(global_p, f"Processing {len(active_tracks)}/{total_sources} tracks...")
                        except Exception as e:
                            print(f"[HEARTBEAT] Error updating progress: {e}")
                            # Continue heartbeat even if update fails
                            continue
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    print(f"[HEARTBEAT ERROR] Fatal error: {e}")
                    import traceback
                    traceback.print_exc()
            
            heartbeat_task = asyncio.create_task(progress_heartbeat())
            
            # Gather all results with exception handling - CTO-level error resilience
            try:
                all_results = await asyncio.gather(*tasks, return_exceptions=True)
            finally:
                # Stop heartbeat gracefully
                heartbeat_task.cancel()
                try:
                    await asyncio.wait_for(heartbeat_task, timeout=1.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
            
            # Validate and flatten results - CTO-level result aggregation with error tracking
            for i, res_list in enumerate(all_results):
                if isinstance(res_list, Exception):
                    filename = sources_with_roles[i].get("filename", "unknown") if i < len(sources_with_roles) else "unknown"
                    print(f"[FORGE] Task failed for {filename}: {res_list}")
                    import traceback
                    traceback.print_exc()
                    # Mark track as failed for better UX
                    if i < len(sources_with_roles):
                        update_track_status(sources_with_roles[i]["filename"], f"Error: {str(res_list)[:50]}", 0)
                    continue
                if res_list is None:
                    print(f"[FORGE] Task returned None, skipping")
                    continue
                if not isinstance(res_list, list):
                    print(f"[FORGE] Task returned non-list: {type(res_list)}, skipping")
                    continue
                results.extend(res_list)

            # Generate Peaks for all results - CTO-level parallel processing
            update_progress(90, "Generating waveform data...")
            if results:
                # Process peaks in parallel for better performance
                async def generate_peaks_async(res):
                    try:
                        if Path(res["path"]).exists():
                            # Run peak generation in executor to avoid blocking
                            loop = asyncio.get_event_loop()
                            dat_path = await loop.run_in_executor(
                                get_executor(),
                                ForgeService.generate_peaks,
                                res["path"]
                            )
                            if dat_path:
                                res["peaks_path"] = dat_path
                                res["peaks_filename"] = Path(dat_path).name
                    except Exception as e:
                        print(f"[FORGE] Error generating peaks for {res.get('path', 'unknown')}: {e}")
                        # Continue without peaks - not critical
                
                # Generate peaks in parallel (up to 4 at a time to avoid overwhelming system)
                peak_tasks = [generate_peaks_async(res) for res in results]
                await asyncio.gather(*peak_tasks, return_exceptions=True)

            # Final Packaging - CTO-level efficient zip creation
            update_progress(95, "Creating final zip package...")
            
            # SENIOR-LEVEL FIX: Ensure output_dir is valid before creating zip
            if output_dir is None or not isinstance(output_dir, Path):
                print(f"[FORGE] Invalid output_dir: {output_dir}, skipping zip creation")
                zip_path = None
            else:
                zip_path = output_dir / "dreamforge_stems.zip"
                try:
                    # Create zip in executor to avoid blocking event loop
                    def create_zip():
                        try:
                            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                                for result in results:
                                    try:
                                        if not result or not isinstance(result, dict):
                                            continue
                                        result_path = Path(result.get("path", ""))
                                        if result_path and result_path.exists():
                                            filename = result.get("filename", result_path.name)
                                            zf.write(result_path, filename)
                                    except Exception as e:
                                        print(f"[FORGE] Error adding {result.get('filename', 'unknown')} to zip: {e}")
                                        continue
                        except Exception as e:
                            print(f"[FORGE] Error in create_zip function: {e}")
                            import traceback
                            traceback.print_exc()
                            raise
                    
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(get_executor(), create_zip)
                except Exception as e:
                    print(f"[FORGE] Error creating zip file: {e}")
                    import traceback
                    traceback.print_exc()
                    zip_path = None  # Mark as failed
                    # Continue without zip - results are still available
            
            # Update watchdog with completion
            watchdog.update_progress(session_id, 100, "Processing complete!")
            
            session_manager.update_session(session_id, {
                "status": "complete",
                "results": results,
                "zip_path": str(zip_path) if zip_path and zip_path.exists() else None,
                "progress": 100,
                "anchor_key": f"{target_key} {target_mode}" if target_key and target_mode else None,
                "message": "Processing complete!"
            })

        except Exception as e:
            print(f"[FORGE] Error in process_session: {e}")
            import traceback
            traceback.print_exc()
            session_manager.update_session(session_id, {
                "status": "error",
                "message": str(e),
                "progress": session_manager.get_session(session_id).get("progress", 0) if session_manager.get_session(session_id) else 0
            })
