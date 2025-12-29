#!/usr/bin/env python3
"""
Song Analysis Script for LoopForge
Analyzes key, melody characteristics, and emotional affect of songs.
"""

import sys
import os

# Force unbuffered output for real-time progress
sys.stdout.reconfigure(line_buffering=True)
print("[STARTUP] LoopForge Song Analyzer initializing...", flush=True)

# Add app to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("[STARTUP] Loading libraries (this may take a moment)...", flush=True)
from pathlib import Path
import librosa
import numpy as np
print("[STARTUP] Loading KeyDetector engine...", flush=True)
from app.engines.key_detector import KeyDetector
print("[STARTUP] All modules loaded!", flush=True)


def analyze_melody(audio: np.ndarray, sr: int) -> dict:
    """Extract melody characteristics using librosa."""
    # Extract pitch contour using piptrack
    pitches, magnitudes = librosa.piptrack(y=audio, sr=sr, fmin=80, fmax=2000)
    
    # Get dominant pitches per frame
    pitch_values = []
    for t in range(pitches.shape[1]):
        index = magnitudes[:, t].argmax()
        pitch = pitches[index, t]
        if pitch > 0:
            pitch_values.append(pitch)
    
    if pitch_values:
        pitch_values = np.array(pitch_values)
        avg_pitch = np.mean(pitch_values)
        pitch_range = np.max(pitch_values) - np.min(pitch_values)
        pitch_std = np.std(pitch_values)
        
        # Convert to MIDI note for reference
        avg_midi = librosa.hz_to_midi(avg_pitch)
        avg_note = librosa.midi_to_note(int(avg_midi))
    else:
        avg_pitch = 0
        pitch_range = 0
        pitch_std = 0
        avg_note = "N/A"
    
    return {
        "avg_pitch_hz": round(avg_pitch, 2),
        "avg_note": avg_note,
        "pitch_range_hz": round(pitch_range, 2),
        "pitch_variability": round(pitch_std, 2),
        "melodic_movement": "wide" if pitch_range > 500 else "moderate" if pitch_range > 200 else "narrow"
    }


def analyze_affect(audio: np.ndarray, sr: int, key_result) -> dict:
    """Analyze emotional affect based on audio features."""
    
    # Spectral features
    spectral_centroid = librosa.feature.spectral_centroid(y=audio, sr=sr)[0]
    spectral_rolloff = librosa.feature.spectral_rolloff(y=audio, sr=sr)[0]
    spectral_contrast = librosa.feature.spectral_contrast(y=audio, sr=sr)
    
    # RMS energy
    rms = librosa.feature.rms(y=audio)[0]
    
    # Zero crossing rate (related to noisiness/brightness)
    zcr = librosa.feature.zero_crossing_rate(audio)[0]
    
    # Calculate metrics
    avg_centroid = np.mean(spectral_centroid)
    avg_rms = np.mean(rms)
    avg_zcr = np.mean(zcr)
    energy_variance = np.var(rms)
    
    # Tempo and rhythm features
    tempo, beats = librosa.beat.beat_track(y=audio, sr=sr)
    tempo_val = float(tempo) if np.isscalar(tempo) else float(tempo[0])
    
    # Mode affects emotional quality
    mode = key_result.mode
    
    # Derive affect descriptors
    affect_descriptors = []
    
    # Mode-based
    if mode == "minor":
        affect_descriptors.append("melancholic")
        affect_descriptors.append("introspective")
    else:
        affect_descriptors.append("uplifting")
    
    # Tempo-based
    if tempo_val < 80:
        affect_descriptors.append("contemplative")
        affect_descriptors.append("slow")
    elif tempo_val < 110:
        affect_descriptors.append("moderate pace")
    elif tempo_val < 140:
        affect_descriptors.append("driving")
    else:
        affect_descriptors.append("energetic")
        affect_descriptors.append("fast")
    
    # Spectral brightness
    if avg_centroid > 3000:
        affect_descriptors.append("bright")
    elif avg_centroid < 1500:
        affect_descriptors.append("dark")
        affect_descriptors.append("warm")
    else:
        affect_descriptors.append("balanced")
    
    # Energy dynamics
    if energy_variance > 0.01:
        affect_descriptors.append("dynamic")
    else:
        affect_descriptors.append("steady")
    
    return {
        "spectral_brightness": round(avg_centroid, 2),
        "energy_level": round(avg_rms * 100, 2),
        "tempo_bpm": round(tempo_val, 1),
        "dynamics": "high" if energy_variance > 0.01 else "moderate" if energy_variance > 0.001 else "subtle",
        "affect_descriptors": affect_descriptors,
        "overall_mood": f"{mode} mode, {'slow' if tempo_val < 90 else 'moderate' if tempo_val < 120 else 'uptempo'}, {'bright' if avg_centroid > 2500 else 'warm'} character"
    }


def analyze_song(filepath: str):
    """Full analysis of a song."""
    print(f"\n{'='*60}", flush=True)
    print(f"ANALYZING: {Path(filepath).name}", flush=True)
    print(f"{'='*60}", flush=True)
    
    # Load audio
    print("\n[PROGRESS] Step 1/4: Loading audio file...", flush=True)
    audio, sr = librosa.load(filepath, sr=None, mono=True, duration=60)  # First 60s
    print(f"[PROGRESS] Audio loaded: {len(audio)/sr:.1f}s @ {sr}Hz", flush=True)
    
    # Key Detection
    print("\n[PROGRESS] Step 2/4: Detecting musical key...", flush=True)
    print("--- KEY DETECTION ---", flush=True)
    detector = KeyDetector()
    key_result = detector.detect_key(audio, sr, estimate_bpm=True)
    
    print(f"KEY: {key_result.key} {key_result.mode}")
    print(f"Confidence: {key_result.confidence:.1%}")
    print(f"Alternate: {key_result.alternate_key} {key_result.alternate_mode} ({key_result.alternate_confidence:.1%})")
    if key_result.bpm:
        print(f"BPM: {key_result.bpm:.1f}")
    
    # Melody Analysis
    print("\n[PROGRESS] Step 3/4: Analyzing melody...", flush=True)
    print("--- MELODY CHARACTERISTICS ---", flush=True)
    melody = analyze_melody(audio, sr)
    print(f"Average Pitch: {melody['avg_pitch_hz']}Hz ({melody['avg_note']})", flush=True)
    print(f"Pitch Range: {melody['pitch_range_hz']}Hz ({melody['melodic_movement']} movement)", flush=True)
    print(f"Melodic Variability: {melody['pitch_variability']}", flush=True)
    
    # Affect Analysis
    print("\n[PROGRESS] Step 4/4: Analyzing emotional affect...", flush=True)
    print("--- EMOTIONAL AFFECT ---", flush=True)
    affect = analyze_affect(audio, sr, key_result)
    print(f"Tempo: {affect['tempo_bpm']} BPM")
    print(f"Spectral Brightness: {affect['spectral_brightness']}")
    print(f"Energy Level: {affect['energy_level']}")
    print(f"Dynamics: {affect['dynamics']}")
    print(f"Descriptors: {', '.join(affect['affect_descriptors'])}")
    print(f"\nOVERALL MOOD: {affect['overall_mood']}")
    
    return {
        "filename": Path(filepath).name,
        "key": key_result.to_dict(),
        "melody": melody,
        "affect": affect
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python analyze_songs.py <audio_file1> [audio_file2] ...")
        print("\nAnalyzes songs for:")
        print("  - Musical key and mode (major/minor)")
        print("  - Melody characteristics (pitch range, movement)")
        print("  - Emotional affect (mood, energy, brightness)")
        sys.exit(1)
    
    results = []
    for filepath in sys.argv[1:]:
        if os.path.exists(filepath):
            try:
                result = analyze_song(filepath)
                results.append(result)
            except Exception as e:
                print(f"Error analyzing {filepath}: {e}")
        else:
            print(f"File not found: {filepath}")
    
    print("\n" + "="*60)
    print("ANALYSIS COMPLETE")
    print("="*60)
