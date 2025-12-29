"""
Tests for API models and data structures.

Note: Integration tests with TestClient are skipped due to httpx/starlette
version compatibility. These tests focus on model validation and serialization.
"""

import pytest
from datetime import datetime


class TestJobModel:
    """Tests for Job model."""
    
    def test_job_status_enum(self):
        """JobStatus enum should have expected values."""
        from app.core.models import JobStatus
        
        assert JobStatus.PENDING.value == "pending"
        assert JobStatus.RUNNING.value == "running"
        assert JobStatus.COMPLETED.value == "completed"
        assert JobStatus.FAILED.value == "failed"
        assert JobStatus.CANCELLED.value == "cancelled"
    
    def test_job_type_enum(self):
        """JobType enum should have expected values."""
        from app.core.models import JobType
        
        assert JobType.SEPARATION.value == "separation"
        assert JobType.ANALYSIS.value == "analysis"
        assert JobType.SLICING.value == "slicing"
        assert JobType.MOMENTS.value == "moments"
        assert JobType.PEAKS.value == "peaks"
    
    def test_job_to_dict(self):
        """Job.to_dict() should serialize all fields."""
        from app.core.models import Job, JobStatus, JobType
        
        job = Job(
            session_id="session-123",
            job_type=JobType.SEPARATION,
            status=JobStatus.PENDING,
        )
        
        data = job.to_dict()
        
        assert data["session_id"] == "session-123"
        assert data["job_type"] == "separation"
        assert data["status"] == "pending"
        assert "id" in data
        assert "created_at" in data


class TestSessionModel:
    """Tests for Session model."""
    
    def test_session_creation(self):
        """Session should be created with defaults."""
        from app.core.models import Session
        
        session = Session(source_filename="test.wav")
        
        assert session.source_filename == "test.wav"
        assert session.bpm is None
        assert session.key is None
        # ID is auto-generated on commit, not on creation
    
    def test_session_to_dict(self):
        """Session.to_dict() should serialize all fields."""
        from app.core.models import Session
        
        session = Session(
            source_filename="test.wav",
            bpm=120.0,
            key="Am",
        )
        
        data = session.to_dict()
        
        assert data["source_filename"] == "test.wav"
        assert data["bpm"] == 120.0
        assert data["key"] == "Am"


class TestAssetModel:
    """Tests for Asset model."""
    
    def test_stem_role_enum(self):
        """StemRole enum should have expected values."""
        from app.core.models import StemRole
        
        assert StemRole.DRUMS.value == "drums"
        assert StemRole.BASS.value == "bass"
        assert StemRole.VOCALS.value == "vocals"
        assert StemRole.OTHER.value == "other"
        assert StemRole.UNKNOWN.value == "unknown"
    
    def test_asset_creation(self):
        """Asset should be created with required fields."""
        from app.core.models import Asset, StemRole
        
        asset = Asset(
            session_id="session-123",
            filename="drums.wav",
            file_path="/path/to/drums.wav",
            asset_type="stem",
            stem_role=StemRole.DRUMS,
        )
        
        assert asset.filename == "drums.wav"
        assert asset.stem_role == StemRole.DRUMS


class TestSliceBankModel:
    """Tests for SliceBankRecord model."""
    
    def test_slice_bank_creation(self):
        """SliceBankRecord should store slice data."""
        from app.core.models import SliceBankRecord, StemRole
        
        bank = SliceBankRecord(
            session_id="session-123",
            source_filename="drums.wav",
            stem_role=StemRole.DRUMS,
            num_slices=16,
            total_duration=4.0,
            mean_energy=0.5,
            max_energy=1.0,
            energy_variance=0.1,
            slice_data=[],
        )
        
        assert bank.num_slices == 16
        assert bank.stem_role == StemRole.DRUMS


class TestEventTypes:
    """Tests for event type definitions."""
    
    def test_event_type_enum(self):
        """EventType enum should have expected values."""
        from app.core.events import EventType
        
        # Values use dot notation: job.created, job.progress, etc.
        assert "job" in EventType.JOB_CREATED.value
        assert "job" in EventType.JOB_PROGRESS.value
        assert "job" in EventType.JOB_COMPLETED.value
        assert "job" in EventType.JOB_FAILED.value
    
    def test_event_creation(self):
        """Event should be created with required fields."""
        from app.core.events import Event, EventType
        
        event = Event(
            type=EventType.JOB_PROGRESS,
            session_id="session-123",
            data={"progress": 50, "stage": "Processing"},
        )
        
        assert event.type == EventType.JOB_PROGRESS
        assert event.session_id == "session-123"
        assert event.data["progress"] == 50
