"""
Tests for the job queue system.
"""

import pytest
from unittest.mock import MagicMock, patch, call
from datetime import datetime

from app.core.models import JobType, JobStatus


class TestJobQueue:
    """Tests for JobQueue class."""
    
    def test_singleton_pattern(self):
        """JobQueue should follow singleton pattern."""
        from app.core.queue import JobQueue
        
        # Reset singleton for testing
        JobQueue._instance = None
        
        q1 = JobQueue.get_instance(max_workers=2)
        q2 = JobQueue.get_instance(max_workers=4)  # Should return same instance
        
        assert q1 is q2
        assert q1.max_workers == 2  # First call's config wins
        
        # Cleanup
        JobQueue._instance = None
    
    def test_register_processor(self):
        """Processors should be registered by job type."""
        from app.core.queue import JobQueue
        
        JobQueue._instance = None
        queue = JobQueue(max_workers=1)
        
        def dummy_processor(job, progress):
            return {"result": "ok"}
        
        queue.register_processor(JobType.ANALYSIS, dummy_processor)
        
        assert JobType.ANALYSIS in queue._processors
        assert queue._processors[JobType.ANALYSIS] is dummy_processor
        
        JobQueue._instance = None
    
    def test_processor_decorator(self):
        """@queue.processor decorator should register processors."""
        from app.core.queue import JobQueue
        
        JobQueue._instance = None
        queue = JobQueue(max_workers=1)
        
        @queue.processor(JobType.SLICING)
        def slice_processor(job, progress):
            return {"slices": 16}
        
        assert JobType.SLICING in queue._processors
        
        JobQueue._instance = None
    
    @patch("app.core.queue.get_db")
    @patch("app.core.queue.emit_sync")
    def test_submit_job(self, mock_emit, mock_get_db):
        """Submitting a job should persist it and emit event."""
        from app.core.queue import JobQueue
        from app.core.models import Job
        
        JobQueue._instance = None
        queue = JobQueue(max_workers=1)
        
        # Setup mock DB
        mock_session = MagicMock()
        mock_db = MagicMock()
        mock_db.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_db.session.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_db.return_value = mock_db
        
        # Mock job creation
        mock_job = MagicMock()
        mock_job.id = "test-job-id"
        mock_job.to_dict.return_value = {"id": "test-job-id", "status": "pending"}
        mock_session.add = MagicMock()
        mock_session.commit = MagicMock()
        mock_session.refresh = MagicMock(side_effect=lambda j: setattr(j, 'id', 'test-job-id'))
        
        # Submit job
        job_ref = queue.submit(
            session_id="session-123",
            job_type=JobType.SEPARATION,
            input_path="/path/to/audio.wav",
        )
        
        assert job_ref.id == "test-job-id"
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()
        mock_emit.assert_called_once()
        
        JobQueue._instance = None


class TestWorkerDecorator:
    """Tests for @Worker decorator."""
    
    def test_worker_registration(self):
        """@Worker decorator should queue registrations."""
        from app.core.queue import Worker, JobQueue
        
        # Clear pending registrations
        Worker._pending_registrations = []
        
        @Worker(JobType.PEAKS)
        def peaks_processor(job, progress):
            return {"peaks_path": "/path/to/peaks.dat"}
        
        assert len(Worker._pending_registrations) == 1
        assert Worker._pending_registrations[0][0] == JobType.PEAKS
        
        # Test register_all
        JobQueue._instance = None
        queue = JobQueue(max_workers=1)
        Worker.register_all(queue)
        
        assert JobType.PEAKS in queue._processors
        assert len(Worker._pending_registrations) == 0
        
        JobQueue._instance = None


class TestProgressDebouncing:
    """Tests for progress update debouncing."""
    
    @patch("app.core.queue.get_db")
    @patch("app.core.queue.emit_sync")
    @patch("app.core.queue.time")
    def test_progress_debounce(self, mock_time, mock_emit, mock_get_db):
        """Progress updates should be debounced."""
        from app.core.queue import JobQueue, PROGRESS_MIN_INTERVAL, PROGRESS_MIN_DELTA
        
        JobQueue._instance = None
        queue = JobQueue(max_workers=1)
        
        # Setup mocks
        mock_session = MagicMock()
        mock_job = MagicMock()
        mock_job.status = JobStatus.RUNNING
        mock_session.query.return_value.filter.return_value.first.return_value = mock_job
        
        mock_db = MagicMock()
        mock_db.session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_db.session.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_db.return_value = mock_db
        
        # First update at t=0
        mock_time.time.return_value = 0.0
        queue._update_progress("job-1", "session-1", 10.0, "Starting")
        
        # Second update shortly after (should be debounced)
        mock_time.time.return_value = 0.1  # < PROGRESS_MIN_INTERVAL
        queue._update_progress("job-1", "session-1", 11.0, "Still starting")  # < PROGRESS_MIN_DELTA
        
        # Only first update should have emitted
        assert mock_emit.call_count == 1
        
        # Third update with significant progress change
        mock_time.time.return_value = 0.2
        queue._update_progress("job-1", "session-1", 50.0, "Halfway")  # > PROGRESS_MIN_DELTA
        
        assert mock_emit.call_count == 2
        
        JobQueue._instance = None
