"""
Event Bus

Pub/sub system for real-time updates via WebSocket.
Decouples job processing from UI notification.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Set, Optional, Callable, Any, Awaitable
from enum import Enum
import json


class EventType(str, Enum):
    """Event categories"""
    # Job lifecycle
    JOB_CREATED = "job.created"
    JOB_STARTED = "job.started"
    JOB_PROGRESS = "job.progress"
    JOB_COMPLETED = "job.completed"
    JOB_FAILED = "job.failed"
    
    # Session events
    SESSION_CREATED = "session.created"
    SESSION_UPDATED = "session.updated"
    
    # Slice events
    SLICE_BANK_CREATED = "slice_bank.created"
    SEQUENCE_GENERATED = "sequence.generated"
    
    # Playback events (for real-time sequencer)
    TRIGGER = "trigger"
    BEAT = "beat"
    TRANSPORT = "transport"


@dataclass
class Event:
    """
    An event to be broadcast to subscribers.
    """
    type: EventType
    session_id: str
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "session_id": self.session_id,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
        }
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict())


# Type alias for async event handlers
EventHandler = Callable[[Event], Awaitable[None]]


class EventBus:
    """
    Async event bus for real-time notifications.
    
    Usage:
        bus = EventBus()
        
        # Subscribe to events for a session
        async def handler(event: Event):
            await websocket.send_json(event.to_dict())
        
        bus.subscribe("session-123", handler)
        
        # Publish events
        await bus.publish(Event(
            type=EventType.JOB_PROGRESS,
            session_id="session-123",
            data={"progress": 50, "stage": "Separating..."}
        ))
    """
    
    _instance: Optional['EventBus'] = None
    _main_loop: Optional[asyncio.AbstractEventLoop] = None
    
    def __init__(self):
        # Subscribers per session_id
        self._subscribers: Dict[str, Set[EventHandler]] = {}
        # Global subscribers (receive all events)
        self._global_subscribers: Set[EventHandler] = set()
        # Event history (for replay on reconnect)
        self._history: Dict[str, list[Event]] = {}
        self._history_limit = 100
    
    def set_main_loop(self, loop: asyncio.AbstractEventLoop):
        """Store reference to main event loop for cross-thread publishing"""
        EventBus._main_loop = loop
    
    @classmethod
    def get_instance(cls) -> 'EventBus':
        """Singleton access"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    # =========================================================================
    # SUBSCRIPTION
    # =========================================================================
    
    def subscribe(self, session_id: str, handler: EventHandler) -> Callable[[], None]:
        """
        Subscribe to events for a specific session.
        
        Returns:
            Unsubscribe function
        """
        if session_id not in self._subscribers:
            self._subscribers[session_id] = set()
        
        self._subscribers[session_id].add(handler)
        
        def unsubscribe():
            self._subscribers[session_id].discard(handler)
            if not self._subscribers[session_id]:
                del self._subscribers[session_id]
        
        return unsubscribe
    
    def subscribe_global(self, handler: EventHandler) -> Callable[[], None]:
        """Subscribe to all events"""
        self._global_subscribers.add(handler)
        
        def unsubscribe():
            self._global_subscribers.discard(handler)
        
        return unsubscribe
    
    # =========================================================================
    # PUBLISHING
    # =========================================================================
    
    async def publish(self, event: Event):
        """
        Publish an event to all relevant subscribers.
        
        This is non-blocking - if a handler fails, others still receive.
        """
        # Store in history
        self._store_in_history(event)
        
        # Gather handlers
        handlers: Set[EventHandler] = set()
        
        # Session-specific handlers
        if event.session_id in self._subscribers:
            handlers.update(self._subscribers[event.session_id])
        
        # Global handlers
        handlers.update(self._global_subscribers)
        
        # Dispatch to all handlers concurrently
        if handlers:
            await asyncio.gather(
                *[self._safe_dispatch(handler, event) for handler in handlers],
                return_exceptions=True
            )
    
    def publish_sync(self, event: Event):
        """
        Publish from synchronous code (e.g., background thread).
        
        Uses thread-safe asyncio.run_coroutine_threadsafe with stored main loop.
        """
        # Store in history regardless
        self._store_in_history(event)
        
        # Try to get the main event loop
        try:
            loop = asyncio.get_running_loop()
            # We're in an async context - schedule normally
            loop.create_task(self.publish(event))
            return
        except RuntimeError:
            pass
        
        # Use stored main loop reference (set during startup)
        if EventBus._main_loop is not None and EventBus._main_loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self.publish(event), EventBus._main_loop)
                return
            except Exception as e:
                print(f"[EventBus] Cross-thread publish failed: {e}")
        
        # Fallback: deliver synchronously
        self._deliver_sync(event)
    
    def _deliver_sync(self, event: Event):
        """Synchronously deliver event to handlers (fallback)"""
        handlers = set()
        if event.session_id in self._subscribers:
            handlers.update(self._subscribers[event.session_id])
        handlers.update(self._global_subscribers)
        
        for handler in handlers:
            try:
                # Create a new event loop just for this delivery
                asyncio.run(handler(event))
            except Exception as e:
                print(f"[EventBus] Sync delivery error: {e}")
    
    async def _safe_dispatch(self, handler: EventHandler, event: Event):
        """Dispatch with error handling"""
        try:
            await handler(event)
        except Exception as e:
            print(f"[EventBus] Handler error: {e}")
    
    # =========================================================================
    # HISTORY
    # =========================================================================
    
    def _store_in_history(self, event: Event):
        """Store event in history for replay"""
        if event.session_id not in self._history:
            self._history[event.session_id] = []
        
        self._history[event.session_id].append(event)
        
        # Trim to limit
        if len(self._history[event.session_id]) > self._history_limit:
            self._history[event.session_id] = self._history[event.session_id][-self._history_limit:]
    
    def get_history(self, session_id: str, since: Optional[datetime] = None) -> list[Event]:
        """Get event history for a session"""
        events = self._history.get(session_id, [])
        
        if since:
            events = [e for e in events if e.timestamp > since]
        
        return events
    
    def clear_history(self, session_id: str):
        """Clear event history for a session"""
        if session_id in self._history:
            del self._history[session_id]


# Convenience functions
_bus: Optional[EventBus] = None


def get_event_bus() -> EventBus:
    """Get the event bus singleton"""
    global _bus
    if _bus is None:
        _bus = EventBus.get_instance()
    return _bus


async def emit(event: Event):
    """Emit an event to the global bus"""
    await get_event_bus().publish(event)


def emit_sync(event: Event):
    """Emit from sync context"""
    get_event_bus().publish_sync(event)


# Helper constructors
def job_progress(session_id: str, job_id: str, progress: float, stage: str) -> Event:
    """Create a job progress event"""
    return Event(
        type=EventType.JOB_PROGRESS,
        session_id=session_id,
        data={
            "job_id": job_id,
            "progress": progress,
            "stage": stage,
        }
    )


def job_completed(session_id: str, job_id: str, output_paths: Dict[str, str]) -> Event:
    """Create a job completed event"""
    return Event(
        type=EventType.JOB_COMPLETED,
        session_id=session_id,
        data={
            "job_id": job_id,
            "output_paths": output_paths,
        }
    )


def job_failed(session_id: str, job_id: str, error: str) -> Event:
    """Create a job failed event"""
    return Event(
        type=EventType.JOB_FAILED,
        session_id=session_id,
        data={
            "job_id": job_id,
            "error": error,
        }
    )
