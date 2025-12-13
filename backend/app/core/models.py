"""
Database Models

SQLAlchemy ORM models for Loop Forge.
All state that needs to survive restarts lives here.
"""

import uuid
from datetime import datetime
from enum import Enum as PyEnum
from typing import Optional, Dict, Any, List

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, Text, 
    ForeignKey, Enum, JSON, Index
)
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()


# =============================================================================
# ENUMS
# =============================================================================

class JobStatus(str, PyEnum):
    """Job lifecycle states"""
    PENDING = "pending"       # In queue, not started
    RUNNING = "running"       # Currently processing
    COMPLETED = "completed"   # Successfully finished
    FAILED = "failed"         # Error occurred
    CANCELLED = "cancelled"   # User cancelled


class JobType(str, PyEnum):
    """Types of processing jobs"""
    SEPARATION = "separation"       # Demucs stem separation
    ANALYSIS = "analysis"           # BPM/Key detection (source file)
    STEM_ANALYSIS = "stem_analysis" # Per-stem key/bpm detection
    SLICING = "slicing"             # Transient detection
    SEQUENCING = "sequencing"       # Trigger sequence generation
    EXPORT = "export"               # Render to audio
    MOMENTS = "moments"             # Detect interesting regions (hits/phrases/textures)
    PEAKS = "peaks"                 # Generate waveform peaks for fast rendering


class StemRole(str, PyEnum):
    """Stem classification"""
    DRUMS = "drums"
    BASS = "bass"
    VOCALS = "vocals"
    OTHER = "other"
    UNKNOWN = "unknown"


# =============================================================================
# CORE MODELS
# =============================================================================

class Session(Base):
    """
    A user session containing one or more uploaded files.
    
    Sessions are the top-level container. Everything belongs to a session.
    """
    __tablename__ = "sessions"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    expires_at = Column(DateTime, nullable=True)  # For cleanup
    
    # Session metadata
    name = Column(String(255), nullable=True)
    source_filename = Column(String(255), nullable=True)
    
    # Analysis results (cached)
    bpm = Column(Float, nullable=True)
    key = Column(String(20), nullable=True)
    duration_seconds = Column(Float, nullable=True)
    sample_rate = Column(Integer, default=44100)
    
    # Relationships
    jobs = relationship("Job", back_populates="session", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="session", cascade="all, delete-orphan")
    slice_banks = relationship("SliceBankRecord", back_populates="session", cascade="all, delete-orphan")
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "name": self.name,
            "source_filename": self.source_filename,
            "bpm": self.bpm,
            "key": self.key,
            "duration_seconds": self.duration_seconds,
        }


class Job(Base):
    """
    A processing job (separation, analysis, slicing, etc.)
    
    Jobs are the unit of work. They track progress and can be resumed.
    """
    __tablename__ = "jobs"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    
    # Job type and status
    job_type = Column(Enum(JobType), nullable=False)
    status = Column(Enum(JobStatus), default=JobStatus.PENDING, nullable=False)
    
    # Progress tracking
    progress = Column(Float, default=0.0)  # 0-100
    stage = Column(String(100), nullable=True)  # Current step description
    
    # Timing
    created_at = Column(DateTime, default=func.now(), nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Input/Output
    input_path = Column(String(500), nullable=True)
    output_paths = Column(JSON, default=dict)  # {"drums": "/path/to/drums.wav", ...}
    
    # Configuration
    config = Column(JSON, default=dict)  # Job-specific parameters
    
    # Error tracking
    error_message = Column(Text, nullable=True)
    error_traceback = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    
    # Relationships
    session = relationship("Session", back_populates="jobs")
    
    # Indexes for common queries
    __table_args__ = (
        Index('idx_job_status', 'status'),
        Index('idx_job_session', 'session_id'),
        Index('idx_job_created', 'created_at'),
        Index('idx_job_queue', 'status', 'created_at'),  # Compound index for queue polling
    )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "job_type": self.job_type.value if self.job_type else None,
            "status": self.status.value if self.status else None,
            "progress": self.progress,
            "stage": self.stage,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "output_paths": self.output_paths,
            "error_message": self.error_message,
        }
    
    def mark_running(self):
        self.status = JobStatus.RUNNING
        self.started_at = datetime.utcnow()
    
    def mark_completed(self, output_paths: Optional[Dict] = None):
        self.status = JobStatus.COMPLETED
        self.completed_at = datetime.utcnow()
        self.progress = 100.0
        if output_paths:
            self.output_paths = output_paths
    
    def mark_failed(self, error: str, traceback: Optional[str] = None):
        self.status = JobStatus.FAILED
        self.completed_at = datetime.utcnow()
        self.error_message = error
        self.error_traceback = traceback


class Asset(Base):
    """
    A file asset (uploaded source, separated stem, exported audio).
    
    Content-addressable storage: files are stored by SHA256 hash.
    """
    __tablename__ = "assets"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    
    # File identity
    filename = Column(String(255), nullable=False)
    content_hash = Column(String(64), nullable=True)  # SHA256
    file_path = Column(String(500), nullable=False)  # Absolute path
    
    # File metadata
    file_size = Column(Integer, nullable=True)  # Bytes
    mime_type = Column(String(100), nullable=True)
    
    # Audio metadata
    duration_seconds = Column(Float, nullable=True)
    sample_rate = Column(Integer, nullable=True)
    channels = Column(Integer, nullable=True)
    
    # Per-stem analysis (key/bpm detection)
    detected_key = Column(String(20), nullable=True)      # e.g., "C major", "A minor"
    detected_bpm = Column(Float, nullable=True)
    key_confidence = Column(Float, nullable=True)         # 0.0 - 1.0
    
    # Classification
    asset_type = Column(String(50), nullable=False)  # "source", "stem", "slice", "export"
    stem_role = Column(Enum(StemRole), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    session = relationship("Session", back_populates="assets")
    
    __table_args__ = (
        Index('idx_asset_session', 'session_id'),
        Index('idx_asset_hash', 'content_hash'),
        Index('idx_asset_type', 'asset_type'),
    )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "filename": self.filename,
            "file_path": self.file_path,
            "asset_type": self.asset_type,
            "stem_role": self.stem_role.value if self.stem_role else None,
            "duration_seconds": self.duration_seconds,
            "sample_rate": self.sample_rate,
            "detected_key": self.detected_key,
            "detected_bpm": self.detected_bpm,
            "key_confidence": self.key_confidence,
        }


class SliceBankRecord(Base):
    """
    Metadata for a slice bank (the actual slices are in JSON).
    
    This allows quick lookup of slice banks without loading full data.
    """
    __tablename__ = "slice_banks"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    asset_id = Column(String(36), ForeignKey("assets.id"), nullable=True)
    
    # Source info
    source_filename = Column(String(255), nullable=False)
    stem_role = Column(Enum(StemRole), nullable=True)
    
    # Slice data
    num_slices = Column(Integer, default=0)
    total_duration = Column(Float, default=0.0)
    
    # Analysis results (aggregated)
    mean_energy = Column(Float, nullable=True)
    max_energy = Column(Float, nullable=True)
    energy_variance = Column(Float, nullable=True)
    
    # The actual slice data (stored as JSON)
    slice_data = Column(JSON, default=list)  # List of slice dicts
    
    # Timestamps
    created_at = Column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    session = relationship("Session", back_populates="slice_banks")
    
    __table_args__ = (
        Index('idx_slicebank_session', 'session_id'),
    )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "source_filename": self.source_filename,
            "stem_role": self.stem_role.value if self.stem_role else None,
            "num_slices": self.num_slices,
            "total_duration": self.total_duration,
            "mean_energy": self.mean_energy,
            "max_energy": self.max_energy,
        }


class TriggerSequence(Base):
    """
    A generated trigger sequence (for persistence/recall).
    """
    __tablename__ = "trigger_sequences"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    slice_bank_id = Column(String(36), ForeignKey("slice_banks.id"), nullable=False)
    
    # Sequence metadata
    name = Column(String(255), nullable=True)
    duration_beats = Column(Float, default=16.0)
    bpm = Column(Float, default=120.0)
    
    # Mode & config
    mode = Column(String(50), nullable=False)  # sequential, euclidean, chaos, etc.
    config = Column(JSON, default=dict)  # Mode-specific parameters
    
    # Rules
    rules = Column(JSON, default=list)  # List of rule dicts
    
    # The actual events
    events = Column(JSON, default=list)  # List of TriggerEvent dicts
    num_events = Column(Integer, default=0)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now(), nullable=False)
    
    __table_args__ = (
        Index('idx_sequence_session', 'session_id'),
        Index('idx_sequence_bank', 'slice_bank_id'),
    )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "slice_bank_id": self.slice_bank_id,
            "name": self.name,
            "duration_beats": self.duration_beats,
            "bpm": self.bpm,
            "mode": self.mode,
            "num_events": self.num_events,
        }
