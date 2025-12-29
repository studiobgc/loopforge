"""
Tests for job worker processors.
"""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from pathlib import Path


class TestSeparationWorker:
    """Tests for the separation worker."""
    
    @patch("app.core.workers.get_storage")
    @patch("app.core.workers.get_db")
    def test_quick_mode_separation(self, mock_get_db, mock_get_storage, sample_audio_path, temp_dir):
        """Quick mode should copy file as all stems without running Demucs."""
        import os
        os.environ["LOOPFORGE_QUICK_MODE"] = "1"
        
        from app.core.workers import process_separation
        
        # Setup mocks
        mock_storage = MagicMock()
        mock_storage.save_stem.side_effect = lambda sid, name, path: temp_dir / f"{name}.wav"
        mock_get_storage.return_value = mock_storage
        
        mock_session = MagicMock()
        mock_db = MagicMock()
        mock_db.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_db.session.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_db.return_value = mock_db
        
        # Create job context
        job = MagicMock()
        job.input_path = str(sample_audio_path)
        job.session_id = "test-session"
        job.config = {}
        
        progress_calls = []
        def progress_callback(pct, msg):
            progress_calls.append((pct, msg))
        
        # Run processor
        result = process_separation(job, progress_callback)
        
        # Verify all stems were created
        assert "drums" in result
        assert "bass" in result
        assert "vocals" in result
        assert "other" in result
        
        # Verify progress reached 100
        assert progress_calls[-1][0] == 100
    
    def test_missing_input_file(self, temp_dir):
        """Should raise FileNotFoundError for missing input."""
        from app.core.workers import process_separation
        
        job = MagicMock()
        job.input_path = str(temp_dir / "nonexistent.wav")
        job.session_id = "test-session"
        
        with pytest.raises(FileNotFoundError):
            process_separation(job, lambda p, m: None)


class TestAnalysisWorker:
    """Tests for the analysis worker."""
    
    @patch("app.core.workers.get_db")
    def test_analysis_extracts_metadata(self, mock_get_db, sample_audio_path):
        """Analysis should extract BPM, key, and duration."""
        from app.core.workers import process_analysis
        
        mock_session = MagicMock()
        mock_db = MagicMock()
        mock_db.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_db.session.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_db.return_value = mock_db
        
        job = MagicMock()
        job.input_path = str(sample_audio_path)
        job.session_id = "test-session"
        
        progress_calls = []
        result = process_analysis(job, lambda p, m: progress_calls.append((p, m)))
        
        # Should return analysis results
        assert "bpm" in result
        assert "key" in result
        assert "duration" in result
        assert result["duration"] > 0
        
        # Progress should complete
        assert progress_calls[-1][0] == 100


class TestMomentsWorker:
    """Tests for the moments detection worker."""
    
    @patch("app.services.moments.detect_moments")
    def test_moments_detection(self, mock_detect, sample_audio_path):
        """Moments worker should classify detected moments by type."""
        from app.core.workers import process_moments
        
        # Mock detected moments
        mock_detect.return_value = [
            {"type": "hit", "start": 0.0, "end": 0.1, "energy": 0.9, "confidence": 0.8},
            {"type": "phrase", "start": 1.0, "end": 3.0, "energy": 0.7, "confidence": 0.75},
            {"type": "texture", "start": 5.0, "end": 8.0, "energy": 0.5, "confidence": 0.6},
        ]
        
        job = MagicMock()
        job.input_path = str(sample_audio_path)
        job.config = {"bias": "balanced"}
        
        result = process_moments(job, lambda p, m: None)
        
        assert result["moments_count"] == 3
        assert len(result["by_type"]["hits"]) == 1
        assert len(result["by_type"]["phrases"]) == 1
        assert len(result["by_type"]["textures"]) == 1


class TestStemNameToRole:
    """Tests for stem name to role mapping."""
    
    def test_drum_mapping(self):
        """Drum-related names should map to DRUMS role."""
        from app.core.workers import _stem_name_to_role
        from app.core.models import StemRole
        
        assert _stem_name_to_role("drums") == StemRole.DRUMS
        assert _stem_name_to_role("DRUMS") == StemRole.DRUMS
        assert _stem_name_to_role("drum_loop") == StemRole.DRUMS
    
    def test_bass_mapping(self):
        """Bass-related names should map to BASS role."""
        from app.core.workers import _stem_name_to_role
        from app.core.models import StemRole
        
        assert _stem_name_to_role("bass") == StemRole.BASS
        assert _stem_name_to_role("BASS") == StemRole.BASS
    
    def test_vocal_mapping(self):
        """Vocal-related names should map to VOCALS role."""
        from app.core.workers import _stem_name_to_role
        from app.core.models import StemRole
        
        assert _stem_name_to_role("vocals") == StemRole.VOCALS
        assert _stem_name_to_role("vocal") == StemRole.VOCALS
    
    def test_other_mapping(self):
        """Other stem name should map to OTHER role."""
        from app.core.workers import _stem_name_to_role
        from app.core.models import StemRole
        
        assert _stem_name_to_role("other") == StemRole.OTHER
    
    def test_unknown_mapping(self):
        """Unknown names should map to UNKNOWN role."""
        from app.core.workers import _stem_name_to_role
        from app.core.models import StemRole
        
        assert _stem_name_to_role("melody") == StemRole.UNKNOWN
        assert _stem_name_to_role("synth") == StemRole.UNKNOWN


class TestSanitizeForJson:
    """Tests for numpy type sanitization."""
    
    def test_sanitize_numpy_float(self):
        """Numpy floats should convert to Python floats."""
        import numpy as np
        from app.core.workers import _sanitize_for_json
        
        result = _sanitize_for_json(np.float32(3.14))
        assert isinstance(result, float)
        assert abs(result - 3.14) < 0.01
    
    def test_sanitize_numpy_int(self):
        """Numpy ints should convert to Python ints."""
        import numpy as np
        from app.core.workers import _sanitize_for_json
        
        result = _sanitize_for_json(np.int64(42))
        assert isinstance(result, int)
        assert result == 42
    
    def test_sanitize_nested_dict(self):
        """Nested structures should be recursively sanitized."""
        import numpy as np
        from app.core.workers import _sanitize_for_json
        
        data = {
            "values": [np.float32(1.0), np.float32(2.0)],
            "nested": {"count": np.int64(5)},
        }
        
        result = _sanitize_for_json(data)
        
        assert isinstance(result["values"][0], float)
        assert isinstance(result["nested"]["count"], int)
