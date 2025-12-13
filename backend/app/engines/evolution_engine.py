import torch
import torchaudio
from pathlib import Path
from typing import List, Dict, Optional
import random

from pedalboard import (
    Pedalboard, 
    Chorus, 
    Reverb, 
    Distortion, 
    Compressor, 
    HighpassFilter, 
    LowpassFilter,
    Phaser,
    Delay,
    Gain,
    Limiter,
    Bitcrush,
    PitchShift
)

class EvolutionEngine:
    """
    Smart Evolution Engine.
    Applies tag-aware DSP chains to evolve audio samples.
    """
    
    def __init__(self):
        print("[EVOLUTION] Initializing Evolution Engine...")
        
    def _get_recipe(self, tags: List[str]) -> Pedalboard:
        """
        Determine the best DSP chain based on tags.
        """
        board = Pedalboard()
        
        # Normalize tags
        tags = [t.lower() for t in tags]
        
        # 1. DRUMS / PERCUSSION
        if any(t in tags for t in ['drums', 'percussion', 'kick', 'snare', 'hats']):
            print("[EVOLUTION] Applying 'Punchy Drums' recipe")
            board.append(HighpassFilter(cutoff_frequency_hz=30)) # Cleanup rumble
            board.append(Compressor(threshold_db=-12, ratio=4, attack_ms=10, release_ms=100)) # Punch
            board.append(Distortion(drive_db=3)) # Saturation
            board.append(Limiter(threshold_db=-1.0))
            
        # 2. BASS
        elif any(t in tags for t in ['bass', '808', 'sub']):
            print("[EVOLUTION] Applying 'Thick Bass' recipe")
            board.append(Distortion(drive_db=6)) # Warmth
            board.append(Chorus(rate_hz=0.5, depth=0.2, mix=0.3)) # Width
            board.append(Compressor(threshold_db=-10, ratio=3)) # Glue
            board.append(LowpassFilter(cutoff_frequency_hz=5000)) # Focus
            
        # 3. VOCALS
        elif any(t in tags for t in ['vocals', 'voice', 'acapella', 'speech']):
            print("[EVOLUTION] Applying 'Ethereal Vocals' recipe")
            board.append(HighpassFilter(cutoff_frequency_hz=100)) # Cleanup mud
            board.append(Compressor(threshold_db=-15, ratio=2.5)) # Even out
            board.append(Delay(delay_seconds=0.25, feedback=0.4, mix=0.3)) # Echo
            board.append(Reverb(room_size=0.7, damping=0.5, wet_level=0.4)) # Space
            
        # 4. ATMOSPHERE / TEXTURE
        elif any(t in tags for t in ['ambient', 'texture', 'pad', 'drone', 'atmospheric']):
            print("[EVOLUTION] Applying 'Deep Space' recipe")
            board.append(Phaser(rate_hz=0.2, depth=0.6, mix=0.5)) # Movement
            board.append(Reverb(room_size=0.9, damping=0.2, wet_level=0.6)) # Huge space
            board.append(Gain(gain_db=2))

        # 5. LO-FI / GLITCH
        elif any(t in tags for t in ['lo-fi', 'lofi', 'glitch', '8-bit', 'crushed']):
            print("[EVOLUTION] Applying 'Bitcrush' recipe")
            board.append(Bitcrush(bit_depth=8))
            board.append(Gain(gain_db=6))
            board.append(Compressor(threshold_db=-10, ratio=4))

        # 6. VAPORWAVE / SLOWED
        elif any(t in tags for t in ['vaporwave', 'slowed', 'chopped', 'screw']):
            print("[EVOLUTION] Applying 'Vapor' recipe")
            board.append(PitchShift(semitones=-2))
            board.append(LowpassFilter(cutoff_frequency_hz=1500))
            board.append(Reverb(room_size=0.8, wet_level=0.4))
            
        # 7. DEFAULT (Generic Polish)
        else:
            print("[EVOLUTION] Applying 'General Polish' recipe")
            board.append(Compressor(threshold_db=-10, ratio=2))
            board.append(Reverb(room_size=0.3, wet_level=0.2))
            board.append(Limiter(threshold_db=-1.0))
            
        return board

    def evolve(self, input_path: Path, output_dir: Path, tags: List[str] = []) -> Dict:
        """
        Process the audio file with a tag-aware chain.
        """
        try:
            # Load Audio
            # Pedalboard reads/writes files directly or numpy arrays.
            # Let's use pedalboard's file reading for simplicity with its effects
            from pedalboard.io import AudioFile
            
            output_filename = f"evolved_{input_path.stem}.wav"
            output_path = output_dir / output_filename
            
            # Get Recipe
            board = self._get_recipe(tags)
            
            # Process
            with AudioFile(str(input_path)) as f:
                audio = f.read(f.frames)
                samplerate = f.samplerate
                
            # Run effects
            processed = board(audio, samplerate)
            
            # Save
            with AudioFile(str(output_path), 'w', samplerate, processed.shape[0]) as f:
                f.write(processed)
                
            return {
                "type": "evolution",
                "role": "evolved",
                "filename": output_filename,
                "path": str(output_path),
                "tags_used": tags,
                "recipe": str(board)
            }
            
        except Exception as e:
            print(f"[EVOLUTION] Error: {e}")
            raise e
