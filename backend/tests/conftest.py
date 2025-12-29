"""
Pytest configuration and fixtures for LoopForge tests.
"""

import os
import tempfile
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Set test environment
os.environ["LOOPFORGE_TEST_MODE"] = "1"
os.environ["LOOPFORGE_QUICK_MODE"] = "1"


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def mock_db():
    """Mock database for testing without SQLite."""
    with patch("app.core.database.get_db") as mock:
        db = MagicMock()
        mock.return_value = db
        yield db


@pytest.fixture
def sample_audio_path(temp_dir):
    """Create a minimal WAV file for testing."""
    import wave
    import struct
    
    audio_path = temp_dir / "test_audio.wav"
    
    # Create a simple 1-second mono WAV file
    sample_rate = 44100
    duration = 1.0
    frequency = 440.0
    
    with wave.open(str(audio_path), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        
        num_samples = int(sample_rate * duration)
        for i in range(num_samples):
            t = i / sample_rate
            sample = int(32767 * 0.5 * (2.0 * (t * frequency % 1.0) - 1.0))
            wav.writeframes(struct.pack("<h", sample))
    
    return audio_path


@pytest.fixture
def mock_event_bus():
    """Mock event bus for testing event emission."""
    with patch("app.core.events.get_event_bus") as mock:
        bus = MagicMock()
        mock.return_value = bus
        yield bus


@pytest.fixture
def mock_storage(temp_dir):
    """Mock storage for testing file operations."""
    with patch("app.core.storage.get_storage") as mock:
        storage = MagicMock()
        storage.get_cache_path.return_value = temp_dir / "cache"
        storage.save_stem.side_effect = lambda sid, name, path: temp_dir / f"{name}.wav"
        mock.return_value = storage
        yield storage
