"""
Test suite for GrooveEngine
"""

import numpy as np
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.engines.groove_engine import GrooveEngine, GrooveTemplate


def generate_test_audio_with_groove(sr=44100, bpm=120, swing_ms=30, duration=4.0):
    """Generate test audio with intentional groove."""
    t = np.linspace(0, duration, int(sr * duration))
    audio = np.zeros_like(t)
    
    beat_duration = 60.0 / bpm
    eighth_note = beat_duration / 2
    
    hits = []
    for i in range(int(duration / eighth_note)):
        hit_time = i * eighth_note
        
        # Add swing: every other hit is late
        if i % 2 == 1:
            hit_time += swing_ms / 1000.0
        
        hits.append(hit_time)
        
        # Create transient
        hit_sample = int(hit_time * sr)
        if hit_sample < len(audio):
            decay = np.exp(-np.arange(2000) / 500)
            end_idx = min(hit_sample + 2000, len(audio))
            audio[hit_sample:end_idx] += decay[:end_idx - hit_sample] * 0.5
    
    return audio, hits


def test_groove_extraction():
    """Test groove extraction on synthetic audio."""
    print("🧪 TEST 1: Groove Extraction")
    print("=" * 60)
    
    sr = 44100
    bpm = 120
    swing_ms = 30
    
    audio, expected_hits = generate_test_audio_with_groove(
        sr=sr, bpm=bpm, swing_ms=swing_ms
    )
    
    engine = GrooveEngine(sr=sr)
    groove = engine.extract_groove(audio, bpm=bpm, subdivision="16th")
    
    print(f"✅ Extracted groove template:")
    print(f"   - BPM: {groove.bpm}")
    print(f"   - Onsets detected: {len(groove.onsets)}")
    print(f"   - Groove type: {groove.groove_type}")
    print(f"   - Swing amount: {groove.swing_amount * 1000:.2f}ms")
    print(f"   - Tightness: {groove.tightness:.2f}")
    
    # Verify swing detection
    assert groove.swing_amount * 1000 > 10, "Should detect swing"
    assert groove.groove_type in ["laid_back", "straight", "rushed"]
    
    print("\n✅ Test passed!\n")
    return groove


def test_groove_application():
    """Test applying groove to quantized audio."""
    print("🧪 TEST 2: Groove Application")
    print("=" * 60)
    
    sr = 44100
    bpm = 120
    
    # Create swung source
    swung_audio, _ = generate_test_audio_with_groove(
        sr=sr, bpm=bpm, swing_ms=30
    )
    
    # Create straight target
    straight_audio, _ = generate_test_audio_with_groove(
        sr=sr, bpm=bpm, swing_ms=0
    )
    
    engine = GrooveEngine(sr=sr)
    
    # Extract groove from swung
    groove = engine.extract_groove(swung_audio, bpm=bpm)
    print(f"   Source groove swing: {groove.swing_amount * 1000:.2f}ms")
    
    # Apply to straight
    grooved_audio = engine.apply_groove(
        straight_audio,
        target_bpm=bpm,
        groove_template=groove,
        strength=1.0
    )
    
    assert len(grooved_audio) == len(straight_audio), "Length should match"
    assert not np.array_equal(grooved_audio, straight_audio), "Should be different"
    
    print(f"✅ Applied groove successfully")
    print(f"   - Input length: {len(straight_audio)} samples")
    print(f"   - Output length: {len(grooved_audio)} samples")
    print(f"   - Audio modified: Yes")
    
    print("\n✅ Test passed!\n")
    return grooved_audio


def test_groove_compatibility():
    """Test groove compatibility analysis."""
    print("🧪 TEST 3: Groove Compatibility")
    print("=" * 60)
    
    sr = 44100
    engine = GrooveEngine(sr=sr)
    
    # Create two grooves
    loose_swing, _ = generate_test_audio_with_groove(
        sr=sr, bpm=120, swing_ms=40
    )
    tight_straight, _ = generate_test_audio_with_groove(
        sr=sr, bpm=120, swing_ms=5
    )
    
    groove_a = engine.extract_groove(loose_swing, bpm=120)
    groove_b = engine.extract_groove(tight_straight, bpm=120)
    
    compat = engine.analyze_compatibility(groove_a, groove_b)
    
    print(f"✅ Compatibility Analysis:")
    print(f"   - Overall compatibility: {compat['compatibility']:.2%}")
    print(f"   - Swing similarity: {compat['swing_similarity']:.2%}")
    print(f"   - Tightness similarity: {compat['tightness_similarity']:.2%}")
    print(f"   - Swing difference: {compat['swing_diff_ms']:.2f}ms")
    print(f"   - Recommendation: {compat['recommendation']}")
    
    assert 'compatibility' in compat
    assert 0 <= compat['compatibility'] <= 1
    
    print("\n✅ Test passed!\n")


def test_groove_visualization():
    """Test groove visualization data generation."""
    print("🧪 TEST 4: Groove Visualization")
    print("=" * 60)
    
    sr = 44100
    audio, _ = generate_test_audio_with_groove(sr=sr, bpm=120, swing_ms=30)
    
    engine = GrooveEngine(sr=sr)
    groove = engine.extract_groove(audio, bpm=120)
    
    viz_data = engine.visualize_groove(groove)
    
    print(f"✅ Visualization data generated:")
    print(f"   - BPM: {viz_data['bpm']}")
    print(f"   - Type: {viz_data['type']}")
    print(f"   - Swing: {viz_data['swing_amount_ms']:.2f}ms")
    print(f"   - Tightness: {viz_data['tightness']:.2f}")
    print(f"   - Onset count: {viz_data['onset_count']}")
    print(f"   - Histogram bins: {len(viz_data['histogram']['bins'])}")
    
    assert 'histogram' in viz_data
    assert 'offsets_ms' in viz_data
    
    print("\n✅ Test passed!\n")


def run_all_tests():
    """Run complete test suite."""
    print("\n" + "=" * 60)
    print("🎵 GROOVE ENGINE TEST SUITE")
    print("=" * 60 + "\n")
    
    try:
        groove = test_groove_extraction()
        test_groove_application()
        test_groove_compatibility()
        test_groove_visualization()
        
        print("=" * 60)
        print("✅ ALL TESTS PASSED!")
        print("=" * 60)
        print("\n🎉 GrooveEngine is production-ready!\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}\n")
        raise
    except Exception as e:
        print(f"\n❌ ERROR: {e}\n")
        import traceback
        traceback.print_exc()
        raise


if __name__ == "__main__":
    run_all_tests()
