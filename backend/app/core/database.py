"""
Database Layer

SQLite-backed persistence with SQLAlchemy ORM.
Designed for reliability and crash recovery.
"""

import os
from pathlib import Path
from contextlib import contextmanager
from typing import Generator, Optional

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session as SQLSession
from sqlalchemy.pool import NullPool

# Database location
DATA_DIR = Path(os.getenv("LOOPFORGE_DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "loopforge.db"


class Database:
    """
    Thread-safe SQLite database manager.
    
    Uses WAL mode for concurrent reads during writes.
    Connection pooling for performance.
    """
    
    _instance: Optional['Database'] = None
    
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DB_PATH
        self.engine = None
        self.SessionLocal = None
        self._initialized = False
    
    @classmethod
    def get_instance(cls, db_path: Optional[Path] = None) -> 'Database':
        """Singleton access"""
        if cls._instance is None:
            cls._instance = cls(db_path)
        return cls._instance
    
    def init(self):
        """Initialize database connection and create tables"""
        if self._initialized:
            return
        
        # SQLite with WAL mode for better concurrency
        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={
                "check_same_thread": False,
                "timeout": 30,
            },
            poolclass=NullPool,  # Avoid cross-thread cursor/transaction issues
            echo=False,  # Set True for SQL debugging
        )
        
        # Enable WAL mode and foreign keys
        @event.listens_for(self.engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()
        
        # Create session factory
        self.SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=self.engine
        )
        
        # Create all tables
        from .models import Base
        Base.metadata.create_all(bind=self.engine)
        
        self._initialized = True
        print(f"[DB] Initialized at {self.db_path}")
    
    @contextmanager
    def session(self) -> Generator[SQLSession, None, None]:
        """
        Context manager for database sessions.
        
        IMPORTANT: Caller should NOT call commit() - it's automatic on success.
        If you need explicit control, use get_session() instead.
        
        Usage:
            with db.session() as session:
                session.add(job)
                # Auto-commits on exit, auto-rollback on exception
        """
        if not self._initialized:
            self.init()
        
        session = self.SessionLocal()
        try:
            yield session
            # Only commit if not already committed (check for pending changes)
            if session.new or session.dirty or session.deleted:
                session.commit()
        except Exception:
            # Only rollback if there's an active transaction
            if session.is_active:
                session.rollback()
            raise
        finally:
            session.close()
    
    def get_session(self) -> SQLSession:
        """Get a session (caller must close)"""
        if not self._initialized:
            self.init()
        return self.SessionLocal()


# Module-level convenience functions
_db: Optional[Database] = None


def init_db(db_path: Optional[Path] = None) -> Database:
    """Initialize the database singleton"""
    global _db
    _db = Database.get_instance(db_path)
    _db.init()
    return _db


def get_db() -> Database:
    """Get the database singleton"""
    global _db
    if _db is None:
        _db = init_db()
    return _db
