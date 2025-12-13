from typing import Dict, Any, Optional
import time
import threading

class SessionManager:
    """
    Thread-safe session manager for VocalForge.
    
    CTO-Level Improvements:
    - Thread-safe operations with locks
    - Session expiration (24 hours)
    - Automatic cleanup of old sessions
    - Memory-efficient storage
    
    In a production environment, this should be backed by Redis or a database.
    For now, we use a thread-safe in-memory dictionary.
    """
    _instance = None
    _lock = threading.Lock()
    _sessions: Dict[str, Dict[str, Any]] = {}
    _session_expiry = 24 * 60 * 60  # 24 hours in seconds

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(SessionManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if hasattr(self, '_initialized') and self._initialized:
            return
        self._initialized = True
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._internal_lock = threading.RLock()  # Reentrant lock for nested calls

    def create_session(self, session_id: str) -> Dict[str, Any]:
        """Initialize a new session (thread-safe)."""
        with self._internal_lock:
            self._sessions[session_id] = {
                "id": session_id,
                "status": "created",
                "created_at": time.time(),
                "last_accessed": time.time(),
                "sources": [],
                "progress": 0,
                "message": "Session initialized",
                "results": [],
                "zip_path": None,
                "output_dir": None
            }
            return self._sessions[session_id].copy()  # Return copy to prevent external mutation

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a session by ID (thread-safe, updates last_accessed)."""
        with self._internal_lock:
            session = self._sessions.get(session_id)
            if session:
                session["last_accessed"] = time.time()
                return session.copy()  # Return copy to prevent external mutation
            return None

    def update_session(self, session_id: str, updates: Dict[str, Any]):
        """Update session fields (thread-safe)."""
        with self._internal_lock:
            if session_id in self._sessions:
                self._sessions[session_id].update(updates)
                self._sessions[session_id]["last_accessed"] = time.time()

    def delete_session(self, session_id: str):
        """Remove a session (thread-safe)."""
        with self._internal_lock:
            if session_id in self._sessions:
                del self._sessions[session_id]

    def cleanup_expired_sessions(self, max_age_seconds: Optional[float] = None):
        """Remove sessions older than max_age_seconds (default: 24 hours)."""
        if max_age_seconds is None:
            max_age_seconds = self._session_expiry
        
        current_time = time.time()
        with self._internal_lock:
            expired = [
                sid for sid, session in self._sessions.items()
                if current_time - session.get("last_accessed", session.get("created_at", 0)) > max_age_seconds
            ]
            for sid in expired:
                del self._sessions[sid]
            if expired:
                print(f"[SESSION_MANAGER] Cleaned up {len(expired)} expired sessions")
            return len(expired)
    
    def get_session_count(self) -> int:
        """Get total number of active sessions."""
        with self._internal_lock:
            return len(self._sessions)

# Global instance
session_manager = SessionManager()
