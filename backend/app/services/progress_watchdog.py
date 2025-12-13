"""
SENIOR-LEVEL PROGRESS WATCHDOG
Completely independent progress tracking system that never blocks.
Uses a separate thread and lock-free data structures.
"""
import threading
import time
import queue
from typing import Dict, Any, Optional
from collections import deque
import json

class ProgressWatchdog:
    """
    Lock-free progress tracking system.
    Uses atomic operations and separate thread to ensure status endpoint
    always responds, even when main event loop is blocked.
    """
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if hasattr(self, '_initialized') and self._initialized:
            return
        self._initialized = True
        # Use deque for thread-safe append operations
        self._progress_data: Dict[str, Dict[str, Any]] = {}
        # Use a simple dict with atomic operations (Python dict operations are atomic for single items)
        self._last_update: Dict[str, float] = {}
        self._watchdog_thread = None
        self._running = False
        self._start_watchdog()
    
    def _start_watchdog(self):
        """Start background thread for progress monitoring."""
        if self._watchdog_thread is None or not self._watchdog_thread.is_alive():
            self._running = True
            self._watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
            self._watchdog_thread.start()
    
    def _watchdog_loop(self):
        """Background thread that monitors progress and keeps sessions alive."""
        while self._running:
            try:
                current_time = time.time()
                # Clean up stale sessions (older than 1 hour)
                stale_sessions = [
                    sid for sid, last_time in self._last_update.items()
                    if current_time - last_time > 3600
                ]
                for sid in stale_sessions:
                    self._progress_data.pop(sid, None)
                    self._last_update.pop(sid, None)
                
                time.sleep(5)  # Check every 5 seconds
            except Exception:
                # Silent fail - watchdog should never crash
                time.sleep(5)
    
    def update_progress(self, session_id: str, progress: int, message: str, **kwargs):
        """
        Update progress atomically (lock-free for single dict operations).
        This can be called from any thread without blocking.
        """
        try:
            # Atomic dict update (single operation)
            self._progress_data[session_id] = {
                "progress": progress,
                "message": message,
                "timestamp": time.time(),
                **kwargs
            }
            self._last_update[session_id] = time.time()
        except Exception:
            # Silent fail - progress updates should never break processing
            pass
    
    def get_progress(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Get progress atomically (lock-free read).
        This is called by the status endpoint and must never block.
        """
        try:
            # Atomic dict read (single operation)
            data = self._progress_data.get(session_id)
            if data:
                # Return a copy to prevent external mutation
                return data.copy()
            return None
        except Exception:
            return None
    
    def cleanup(self):
        """Stop watchdog thread."""
        self._running = False
        if self._watchdog_thread:
            self._watchdog_thread.join(timeout=1.0)


# Global instance
_watchdog: Optional[ProgressWatchdog] = None
_watchdog_lock = threading.Lock()

def get_watchdog() -> ProgressWatchdog:
    """Get global watchdog instance."""
    global _watchdog
    if _watchdog is None:
        with _watchdog_lock:
            if _watchdog is None:
                _watchdog = ProgressWatchdog()
    return _watchdog







