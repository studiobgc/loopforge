"""
Job Queue

Background job processing with persistence and recovery.
Jobs survive server restarts and can be monitored in real-time.
"""

import asyncio
import traceback
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, Callable
from functools import wraps
import threading

from sqlalchemy import text

from .database import get_db
from .models import Job, JobStatus, JobType, Session, Asset, StemRole
from .events import get_event_bus, Event, EventType, emit_sync
from .storage import get_storage

# Progress debounce settings
PROGRESS_MIN_INTERVAL = 0.5  # seconds
PROGRESS_MIN_DELTA = 2.0     # percent


# Type for job processor functions
JobProcessor = Callable[[Job, Callable[[float, str], None]], Dict[str, Any]]


class JobQueue:
    """
    Persistent job queue with background workers.
    
    Features:
    - Jobs persist to SQLite
    - Automatic recovery on restart
    - Progress callbacks to EventBus
    - Configurable worker pool
    """
    
    _instance: Optional['JobQueue'] = None
    
    def __init__(self, max_workers: int = 2):
        self.max_workers = max_workers
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._processors: Dict[JobType, JobProcessor] = {}
        self._running = False
        self._poll_task: Optional[asyncio.Task] = None
        self._active_jobs: Dict[str, Job] = {}
        # Progress debounce tracking: job_id -> (last_progress, last_time)
        self._progress_state: Dict[str, tuple[float, float]] = {}
    
    @classmethod
    def get_instance(cls, max_workers: int = 2) -> 'JobQueue':
        if cls._instance is None:
            cls._instance = cls(max_workers)
        return cls._instance
    
    # =========================================================================
    # PROCESSOR REGISTRATION
    # =========================================================================
    
    def register_processor(self, job_type: JobType, processor: JobProcessor):
        """
        Register a processor function for a job type.
        
        The processor signature should be:
            def processor(job: Job, progress_callback: Callable[[float, str], None]) -> Dict[str, Any]:
                # Do work...
                progress_callback(50.0, "Halfway done")
                # Return output paths
                return {"drums": "/path/to/drums.wav", ...}
        """
        self._processors[job_type] = processor
    
    def processor(self, job_type: JobType):
        """Decorator to register a processor"""
        def decorator(func: JobProcessor):
            self.register_processor(job_type, func)
            return func
        return decorator
    
    # =========================================================================
    # JOB SUBMISSION
    # =========================================================================
    
    def submit(
        self,
        session_id: str,
        job_type: JobType,
        input_path: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Job:
        """
        Submit a new job to the queue.
        
        Returns immediately with the Job object.
        Processing happens in the background.
        """
        db = get_db()
        
        with db.session() as session:
            job = Job(
                session_id=session_id,
                job_type=job_type,
                status=JobStatus.PENDING,
                input_path=input_path,
                config=config or {},
            )
            session.add(job)
            session.commit()
            session.refresh(job)
            
            # Capture data before session closes
            job_id = job.id
            job_dict = job.to_dict()
        
        # Emit event outside the session context
        emit_sync(Event(
            type=EventType.JOB_CREATED,
            session_id=session_id,
            data=job_dict
        ))
        
        # Return a simple object with the ID
        class JobRef:
            pass
        ref = JobRef()
        ref.id = job_id
        return ref
    
    # =========================================================================
    # QUEUE PROCESSING
    # =========================================================================
    
    async def start(self):
        """Start the queue processor"""
        if self._running:
            return
        
        self._running = True
        
        # Recover incomplete jobs
        self._recover_jobs()
        
        # Start polling loop
        self._poll_task = asyncio.create_task(self._poll_loop())
        print(f"[Queue] Started with {self.max_workers} workers")
    
    async def stop(self):
        """Stop the queue processor gracefully"""
        self._running = False
        
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        
        self._executor.shutdown(wait=True)
        print("[Queue] Stopped")
    
    def _recover_jobs(self):
        """Mark incomplete jobs as pending on startup"""
        db = get_db()
        
        with db.session() as session:
            # Find jobs that were running when server stopped
            stalled_jobs = session.query(Job).filter(
                Job.status == JobStatus.RUNNING
            ).all()
            
            for job in stalled_jobs:
                if job.retry_count < job.max_retries:
                    job.status = JobStatus.PENDING
                    job.retry_count += 1
                    print(f"[Queue] Recovered job {job.id[:8]} (attempt {job.retry_count})")
                else:
                    job.status = JobStatus.FAILED
                    job.error_message = "Max retries exceeded after server restart"
            
            session.commit()
    
    async def _poll_loop(self):
        """Poll for pending jobs and dispatch to workers"""
        while self._running:
            try:
                # Check for available worker slots
                active_count = len(self._active_jobs)
                
                if active_count < self.max_workers:
                    # Fetch pending jobs
                    jobs = self._get_pending_jobs(self.max_workers - active_count)
                    
                    for job in jobs:
                        if job.id not in self._active_jobs:
                            self._active_jobs[job.id] = job
                            # Dispatch to thread pool
                            loop = asyncio.get_event_loop()
                            loop.run_in_executor(
                                self._executor,
                                self._process_job,
                                job.id
                            )
                
                # Sleep before next poll
                await asyncio.sleep(0.5)
                
            except Exception as e:
                print(f"[Queue] Poll error: {e}")
                await asyncio.sleep(1)
    
    def _get_pending_jobs(self, limit: int) -> list[Job]:
        """Get pending jobs from database with atomic status update"""
        db = get_db()
        
        with db.session() as session:
            # Atomic update: claim jobs in a single query to prevent race conditions
            # This uses RETURNING to get the updated rows
            result = session.execute(
                text("""
                    UPDATE jobs 
                    SET status = 'RUNNING', started_at = :now
                    WHERE id IN (
                        SELECT id FROM jobs 
                        WHERE status = 'PENDING'
                        ORDER BY created_at
                        LIMIT :limit
                    )
                    RETURNING id, session_id, job_type, input_path, config, created_at, started_at
                """),
                {"now": datetime.utcnow(), "limit": limit}
            )
            
            rows = result.fetchall()
            session.commit()
            
            # Create detached job objects
            jobs = []
            for row in rows:
                # Use enum name lookup (JobType['SEPARATION']) not value lookup (JobType('separation'))
                job_type_str = row[2]
                job_type = JobType[job_type_str] if job_type_str in JobType.__members__ else JobType(job_type_str.lower())
                
                job = Job(
                    id=row[0],
                    session_id=row[1],
                    job_type=job_type,
                    status=JobStatus.RUNNING,
                    input_path=row[3],
                    config=row[4] or {},
                    created_at=row[5],
                    started_at=row[6],
                )
                jobs.append(job)
            
            return jobs
    
    def _detach_job(self, job: Job) -> Job:
        """Create a detached copy of a job for thread-safe access"""
        return Job(
            id=job.id,
            session_id=job.session_id,
            job_type=job.job_type,
            status=job.status,
            progress=job.progress,
            stage=job.stage,
            input_path=job.input_path,
            output_paths=job.output_paths or {},
            config=job.config or {},
            created_at=job.created_at,
            started_at=job.started_at,
        )
    
    def _process_job(self, job_id: str):
        """
        Process a job in a background thread.
        
        This runs in the ThreadPoolExecutor.
        """
        db = get_db()
        
        try:
            # Reload job from database
            with db.session() as session:
                job = session.query(Job).filter(Job.id == job_id).first()
                if not job:
                    print(f"[Queue] Job {job_id[:8]} not found")
                    return
                
                session_id = job.session_id
                job_type = job.job_type
                input_path = job.input_path
                config = dict(job.config) if job.config else {}
            
            # Get processor
            processor = self._processors.get(job_type)
            if not processor:
                raise ValueError(f"No processor registered for {job_type}")
            
            # Create progress callback
            def progress_callback(progress: float, stage: str):
                self._update_progress(job_id, session_id, progress, stage)
            
            # Run processor
            print(f"[Queue] Processing {job_type.value} job {job_id[:8]}")
            
            # Create a minimal job-like object for the processor
            class JobContext:
                pass
            
            ctx = JobContext()
            ctx.id = job_id
            ctx.session_id = session_id
            ctx.input_path = input_path
            ctx.config = config
            
            output_paths = processor(ctx, progress_callback)
            
            # Mark completed
            with db.session() as session:
                job = session.query(Job).filter(Job.id == job_id).first()
                if job:
                    # If user cancelled while the worker was running, do not overwrite.
                    if job.status == JobStatus.CANCELLED:
                        print(f"[Queue] Job {job_id[:8]} cancelled during execution; skipping completion")
                        return
                    job.mark_completed(output_paths)
                    session.commit()
            
            # Emit completion event (include job_type for frontend filtering)
            emit_sync(Event(
                type=EventType.JOB_COMPLETED,
                session_id=session_id,
                data={
                    "job_id": job_id,
                    "job_type": job_type.value,
                    "output_paths": output_paths,
                }
            ))
            
            print(f"[Queue] Completed job {job_id[:8]}")
            
        except Exception as e:
            error_msg = str(e)
            error_tb = traceback.format_exc()
            print(f"[Queue] Job {job_id[:8]} failed: {error_msg}")

            failed_job_type = None
            if 'job_type' in locals():
                try:
                    failed_job_type = job_type.value if job_type else None
                except Exception:
                    failed_job_type = None
            
            # Mark failed
            with db.session() as session:
                job = session.query(Job).filter(Job.id == job_id).first()
                if job:
                    # If user cancelled while the worker was running, don't overwrite.
                    if job.status == JobStatus.CANCELLED:
                        print(f"[Queue] Job {job_id[:8]} cancelled during execution; skipping failure")
                        return
                    job.mark_failed(error_msg, error_tb)
                    session_id = job.session_id
                    session.commit()
            
            # Emit failure event
            emit_sync(Event(
                type=EventType.JOB_FAILED,
                session_id=session_id,
                data={
                    "job_id": job_id,
                    "job_type": failed_job_type,
                    "error": error_msg,
                }
            ))
        
        finally:
            # Remove from active jobs
            self._active_jobs.pop(job_id, None)
    
    def _update_progress(self, job_id: str, session_id: str, progress: float, stage: str):
        """Update job progress with debouncing to avoid excessive DB writes and events"""
        now = time.time()
        
        # Check debounce conditions
        last_state = self._progress_state.get(job_id)
        if last_state:
            last_progress, last_time = last_state
            time_delta = now - last_time
            progress_delta = abs(progress - last_progress)
            
            # Skip if not enough time/progress change (unless it's 100%)
            if progress < 100 and time_delta < PROGRESS_MIN_INTERVAL and progress_delta < PROGRESS_MIN_DELTA:
                return
        
        # Update tracking state
        self._progress_state[job_id] = (progress, now)
        
        # Update database
        db = get_db()
        with db.session() as session:
            job = session.query(Job).filter(Job.id == job_id).first()
            if job:
                # Do not emit progress for cancelled jobs.
                if job.status == JobStatus.CANCELLED:
                    return
                job.progress = progress
                job.stage = stage
                session.commit()
        
        # Emit event
        emit_sync(Event(
            type=EventType.JOB_PROGRESS,
            session_id=session_id,
            data={
                "job_id": job_id,
                "progress": progress,
                "stage": stage,
            }
        ))
        
        # Cleanup tracking when job completes
        if progress >= 100:
            self._progress_state.pop(job_id, None)
    
    # =========================================================================
    # QUERIES
    # =========================================================================
    
    def get_job(self, job_id: str) -> Optional[Job]:
        """Get a job by ID"""
        db = get_db()
        
        with db.session() as session:
            return session.query(Job).filter(Job.id == job_id).first()
    
    def get_session_jobs(self, session_id: str) -> list[Job]:
        """Get all jobs for a session"""
        db = get_db()
        
        with db.session() as session:
            return session.query(Job).filter(
                Job.session_id == session_id
            ).order_by(Job.created_at).all()


# Convenience worker decorator
class Worker:
    """
    Decorator for registering job processors.
    
    Usage:
        @Worker(JobType.SEPARATION)
        def process_separation(job, progress):
            # Do work
            return {"drums": "/path/to/drums.wav"}
    """
    
    _pending_registrations: list[tuple[JobType, JobProcessor]] = []
    
    def __init__(self, job_type: JobType):
        self.job_type = job_type
    
    def __call__(self, func: JobProcessor) -> JobProcessor:
        Worker._pending_registrations.append((self.job_type, func))
        return func
    
    @classmethod
    def register_all(cls, queue: JobQueue):
        """Register all decorated processors with a queue"""
        for job_type, processor in cls._pending_registrations:
            queue.register_processor(job_type, processor)
        cls._pending_registrations.clear()


# Singleton access
_queue: Optional[JobQueue] = None


def get_queue() -> JobQueue:
    """Get the job queue singleton"""
    global _queue
    if _queue is None:
        _queue = JobQueue.get_instance()
    return _queue
