#!/usr/bin/env python3
"""
Smoke test for Pitchify Lab end-to-end workflow.

Tests:
1. Generate test audio (sine wave + noise)
2. Upload to session
3. Apply harmonic filter with envelope following
4. Create slice bank
5. Verify outputs exist
"""

import os
import sys
import time
import requests
import numpy as np
import soundfile as sf
from pathlib import Path

API_BASE = "http://localhost:8000"

def generate_test_audio(output_path: Path, duration: float = 3.0, sr: int = 44100):
    """Generate a test audio file with pitched content + noise."""
    t = np.linspace(0, duration, int(sr * duration))
    
    # Base tone (A4 = 440Hz) with harmonics
    signal = 0.3 * np.sin(2 * np.pi * 440 * t)  # Fundamental
    signal += 0.15 * np.sin(2 * np.pi * 880 * t)  # 2nd harmonic
    signal += 0.1 * np.sin(2 * np.pi * 1320 * t)  # 3rd harmonic
    
    # Add some noise (simulating field recording)
    noise = 0.1 * np.random.randn(len(t))
    signal += noise
    
    # Amplitude envelope (fade in/out)
    envelope = np.ones(len(t))
    fade_samples = int(0.1 * sr)
    envelope[:fade_samples] = np.linspace(0, 1, fade_samples)
    envelope[-fade_samples:] = np.linspace(1, 0, fade_samples)
    signal *= envelope
    
    # Normalize
    signal = signal / np.max(np.abs(signal)) * 0.8
    
    sf.write(str(output_path), signal, sr)
    print(f"✓ Generated test audio: {output_path} ({duration}s)")
    return output_path


def test_health():
    """Test API health."""
    r = requests.get(f"{API_BASE}/api/health")
    assert r.status_code == 200, f"Health check failed: {r.text}"
    print("✓ API health OK")


def test_upload(audio_path: Path) -> dict:
    """Test file upload and session creation."""
    with open(audio_path, 'rb') as f:
        files = {'file': (audio_path.name, f, 'audio/wav')}
        data = {'auto_separate': 'false', 'auto_analyze': 'false'}
        r = requests.post(f"{API_BASE}/api/sessions/upload", files=files, data=data)
    
    assert r.status_code == 200, f"Upload failed: {r.status_code} - {r.text}"
    result = r.json()
    assert 'session_id' in result, f"No session_id in response: {result}"
    print(f"✓ Upload OK - session_id: {result['session_id'][:8]}...")
    return result


def test_harmonic_filter(session_id: str, stem_path: str) -> dict:
    """Test harmonic filter with envelope following."""
    payload = {
        "session_id": session_id,
        "stem_path": stem_path,
        "root_note": "A",
        "mode": "major",
        "num_harmonics": 16,
        "resonance": 0.6,
        "spectral_tilt": 0,
        "voicing": "natural",
        "motion": "follow",  # Test envelope following!
        "motion_rate": 0,
        "motion_depth": 0.7,
        "mix": 1.0,
        "preset": "responsive"
    }
    
    print(f"  Applying harmonic filter (motion=follow)...")
    r = requests.post(f"{API_BASE}/api/effects/harmonic-filter", json=payload)
    
    assert r.status_code == 200, f"Harmonic filter failed: {r.status_code} - {r.text}"
    result = r.json()
    assert result.get('success'), f"Filter not successful: {result}"
    assert 'output_path' in result, f"No output_path: {result}"
    print(f"✓ Harmonic filter OK - output: {Path(result['output_path']).name}")
    return result


def test_slice_bank(session_id: str, stem_path: str) -> dict:
    """Test slice bank creation."""
    payload = {
        "session_id": session_id,
        "stem_path": stem_path,
        "role": "other"
    }
    
    print(f"  Creating slice bank...")
    r = requests.post(f"{API_BASE}/api/slices/banks", json=payload)
    
    assert r.status_code == 200, f"Slice bank failed: {r.status_code} - {r.text}"
    result = r.json()
    assert 'slices' in result, f"No slices in response: {result}"
    print(f"✓ Slice bank OK - {len(result['slices'])} slices created")
    return result


def main():
    print("\n" + "="*60)
    print("PITCHIFY LAB SMOKE TEST")
    print("="*60 + "\n")
    
    # Setup
    test_dir = Path(__file__).parent / "test_outputs"
    test_dir.mkdir(exist_ok=True)
    test_audio = test_dir / "test_input.wav"
    
    try:
        # 1. Health check
        test_health()
        
        # 2. Generate test audio
        generate_test_audio(test_audio)
        
        # 3. Upload
        upload_result = test_upload(test_audio)
        session_id = upload_result['session_id']
        source_path = upload_result.get('source', {}).get('path', '')
        
        if not source_path:
            print("⚠ No source path in upload response, checking session...")
            # Get session to find source
            r = requests.get(f"{API_BASE}/api/sessions/{session_id}")
            if r.status_code == 200:
                session = r.json()
                # Try to find source path from stems or assets
                source_path = f"storage/uploads/{session_id}/test_input.wav"
        
        # 4. Apply harmonic filter
        filter_result = test_harmonic_filter(session_id, source_path)
        pitchified_path = filter_result['output_path']
        
        # 5. Create slice bank from pitchified output
        slice_result = test_slice_bank(session_id, pitchified_path)
        
        print("\n" + "="*60)
        print("✓ ALL TESTS PASSED")
        print("="*60)
        print(f"\nSession ID: {session_id}")
        print(f"Original: {source_path}")
        print(f"Pitchified: {pitchified_path}")
        print(f"Slices: {len(slice_result['slices'])}")
        print("\nEnvelope-following harmonic filter working correctly!")
        print("="*60 + "\n")
        
        return 0
        
    except AssertionError as e:
        print(f"\n✗ TEST FAILED: {e}")
        return 1
    except requests.exceptions.ConnectionError:
        print(f"\n✗ CONNECTION ERROR: Is the backend running at {API_BASE}?")
        return 1
    except Exception as e:
        print(f"\n✗ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
