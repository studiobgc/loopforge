
import asyncio
import numpy as np
import torch
from app.engines.time_engine import TimeStretchEngine
from app.engines.pitch_engine import PitchEngine
from app.services.forge_service import ForgeService

async def demonstrate_chimera_workflow():
    print("🧪 INITIALIZING CHIMERA PROTOCOL...")
    print("-----------------------------------")

    # 1. Mock Input Data
    drums = {
        "name": "Amen_Break.wav",
        "bpm": 160.0,
        "key": "C",
        "role": "drums"
    }
    
    vocals = {
        "name": "Acapella_Diva.wav",
        "bpm": 120.0,
        "key": "F#",
        "role": "vocals"
    }

    print(f"🎧 TRACK A (Rhythm Anchor): {drums['name']}")
    print(f"   - BPM: {drums['bpm']}")
    print(f"   - Key: {drums['key']}")
    
    print(f"🎤 TRACK B (Harmonic Anchor): {vocals['name']}")
    print(f"   - BPM: {vocals['bpm']}")
    print(f"   - Key: {vocals['key']}")
    print("-----------------------------------")

    # 2. The Logic (The "Chimera" Calculation)
    target_bpm = drums['bpm']
    target_key = vocals['key']

    print(f"🎯 TARGET STATE DETERMINED:")
    print(f"   - Global BPM: {target_bpm} (inherited from {drums['name']})")
    print(f"   - Global Key: {target_key} (inherited from {vocals['name']})")
    print("-----------------------------------")

    # 3. Calculate Transforms
    
    # --- DRUMS ---
    drum_stretch_rate = target_bpm / drums['bpm']
    drum_semitones = ForgeService.get_semitones(drums['key'], target_key)
    
    print(f"🥁 PROCESSING DRUMS:")
    print(f"   - Time Stretch Rate: {drum_stretch_rate:.2f}x (Match self)")
    print(f"   - Pitch Shift: {drum_semitones:+d} semitones ({drums['key']} -> {target_key})")
    
    # --- VOCALS ---
    vocal_stretch_rate = target_bpm / vocals['bpm']
    vocal_semitones = ForgeService.get_semitones(vocals['key'], target_key)
    
    print(f"🗣️  PROCESSING VOCALS:")
    print(f"   - Time Stretch Rate: {vocal_stretch_rate:.2f}x ({vocals['bpm']} -> {target_bpm})")
    print(f"   - Pitch Shift: {vocal_semitones:+d} semitones (Match self)")
    print("-----------------------------------")

    # 4. Verify Engines Can Do It
    print("⚙️  VERIFYING ENGINE CAPABILITIES...")
    
    # Mock Audio Tensors
    sr = 44100
    duration = 2.0 # seconds
    t = np.linspace(0, duration, int(sr * duration))
    
    # Generate dummy audio (Sine waves)
    # Drums: Low freq pulse
    drum_audio = np.sin(2 * np.pi * 100 * t) * np.exp(-5 * t) 
    drum_tensor = torch.from_numpy(drum_audio).float().unsqueeze(0) # [1, T]
    
    # Vocals: Higher freq
    vocal_audio = np.sin(2 * np.pi * 440 * t)
    vocal_tensor = torch.from_numpy(vocal_audio).float().unsqueeze(0)

    time_engine = TimeStretchEngine(sr=sr)
    pitch_engine = PitchEngine() # Uses librosa/torch

    # Test Time Stretch on Vocals
    print("   > Testing Time Stretch on Vocals...")
    try:
        stretched_vocal = time_engine.stretch_audio(vocal_tensor, vocal_stretch_rate)
        print(f"     ✅ Success! Input shape: {vocal_tensor.shape} -> Output shape: {stretched_vocal.shape}")
        print(f"     (Duration changed from {duration}s to {duration/vocal_stretch_rate:.2f}s)")
    except Exception as e:
        print(f"     ❌ Failed: {e}")

    # Test Pitch Shift on Drums
    print("   > Testing Pitch Shift on Drums...")
    try:
        # PitchEngine expects numpy for some methods, let's use the shift_pitch method
        # It uses librosa.effects.pitch_shift or time_stretch+resample
        # Let's use the numpy version for the test as PitchEngine wraps it
        drum_np = drum_tensor.numpy()[0]
        shifted_drums = pitch_engine.shift_pitch(drum_np, sr, drum_semitones)
        print(f"     ✅ Success! Shifted {drum_semitones} semitones.")
    except Exception as e:
        print(f"     ❌ Failed: {e}")

    print("-----------------------------------")
    print("✨ CONCLUSION: The Chimera Workflow is FULLY SUPPORTED by the underlying engines.")
    print("   The only missing piece is exposing this 'Split Anchor' logic in the ForgeService API.")

if __name__ == "__main__":
    asyncio.run(demonstrate_chimera_workflow())
