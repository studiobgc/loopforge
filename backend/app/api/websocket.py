"""
WebSocket API

Real-time communication for:
- Job progress updates
- Sequencer transport & triggers
- Live collaboration (future)
"""

import asyncio
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.events import get_event_bus, Event, EventType
from ..core.database import get_db
from ..core.models import Job

router = APIRouter(tags=["WebSocket"])


# Active connections per session
_connections: Dict[str, Set[WebSocket]] = {}


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket for real-time session updates.
    
    Client receives:
    - Job progress: {"type": "job.progress", "data": {"job_id": "...", "progress": 50, "stage": "..."}}
    - Job complete: {"type": "job.completed", "data": {"job_id": "...", "output_paths": {...}}}
    - Job failed: {"type": "job.failed", "data": {"job_id": "...", "error": "..."}}
    - Triggers: {"type": "trigger", "data": {"event": {...}, "beat": 4.0}}
    
    Client can send:
    - Ping: {"type": "ping"}
    - Subscribe to extra events: {"type": "subscribe", "events": ["trigger", "beat"]}
    """
    await websocket.accept()
    
    # Register connection
    if session_id not in _connections:
        _connections[session_id] = set()
    _connections[session_id].add(websocket)
    
    # Subscribe to events
    event_bus = get_event_bus()
    
    async def event_handler(event: Event):
        try:
            await websocket.send_json(event.to_dict())
        except Exception:
            pass
    
    unsubscribe = event_bus.subscribe(session_id, event_handler)
    
    try:
        # Send current job states on connect
        await _send_current_state(websocket, session_id)
        
        # Message loop
        while True:
            try:
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=60.0
                )
                
                msg_type = data.get("type")
                
                if msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                
                elif msg_type == "get_state":
                    await _send_current_state(websocket, session_id)
                
            except asyncio.TimeoutError:
                # Send keepalive
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
                    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        unsubscribe()
        _connections[session_id].discard(websocket)
        if not _connections[session_id]:
            del _connections[session_id]


async def _send_current_state(websocket: WebSocket, session_id: str):
    """Send current job states on connect"""
    db = get_db()
    
    try:
        with db.session() as session:
            jobs = session.query(Job).filter(
                Job.session_id == session_id
            ).all()
            
            for job in jobs:
                # Include job_type in status message for frontend filtering
                job_data = job.to_dict()
                await websocket.send_json({
                    "type": f"job.{job.status.value}" if job.status else "job.pending",
                    "session_id": session_id,
                    "data": {
                        **job_data,
                        "job_type": job.job_type.value if job.job_type else None,
                    },
                })
    except Exception as e:
        print(f"[WS] Error sending current state: {e}")
        # Don't re-raise - let connection continue


# Sequencer-specific WebSocket
@router.websocket("/ws/sequencer/{session_id}")
async def sequencer_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket for real-time sequencer control.
    
    Client sends:
    - {"type": "load_sequence", "events": [...], "bpm": 120}
    - {"type": "play"}
    - {"type": "stop"}
    - {"type": "seek", "beat": 4.0}
    - {"type": "set_bpm", "bpm": 140}
    
    Server sends:
    - {"type": "trigger", "event": {...}, "beat": 4.0}
    - {"type": "beat", "beat": 4}
    - {"type": "state", "is_playing": true, "beat": 4.0}
    """
    await websocket.accept()
    
    state = SequencerState()
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "load_sequence":
                state.events = data.get("events", [])
                state.bpm = data.get("bpm", 120.0)
                state.current_event_index = 0
                state.current_beat = 0.0
                await websocket.send_json({
                    "type": "loaded",
                    "num_events": len(state.events),
                })
            
            elif msg_type == "play":
                state.is_playing = True
                await websocket.send_json({
                    "type": "state",
                    "is_playing": True,
                    "beat": state.current_beat,
                })
                asyncio.create_task(_playback_loop(websocket, state))
            
            elif msg_type == "stop":
                state.is_playing = False
                await websocket.send_json({
                    "type": "state",
                    "is_playing": False,
                    "beat": state.current_beat,
                })
            
            elif msg_type == "seek":
                state.current_beat = data.get("beat", 0.0)
                state.current_event_index = 0
                for i, event in enumerate(state.events):
                    if event.get("time", 0) > state.current_beat:
                        break
                    state.current_event_index = i
            
            elif msg_type == "set_bpm":
                state.bpm = data.get("bpm", 120.0)
            
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        state.is_playing = False


class SequencerState:
    """State for a sequencer session"""
    def __init__(self):
        self.is_playing = False
        self.current_beat = 0.0
        self.bpm = 120.0
        self.events = []
        self.current_event_index = 0


async def _playback_loop(websocket: WebSocket, state: SequencerState):
    """Background loop that sends trigger events"""
    beat_duration = 60.0 / state.bpm
    tick_interval = beat_duration / 24  # 24 PPQ
    
    last_beat = -1
    
    while state.is_playing:
        # Check for events to trigger
        while (state.current_event_index < len(state.events) and
               state.events[state.current_event_index].get("time", 0) <= state.current_beat):
            event = state.events[state.current_event_index]
            try:
                await websocket.send_json({
                    "type": "trigger",
                    "event": event,
                    "beat": state.current_beat,
                })
            except Exception:
                state.is_playing = False
                return
            state.current_event_index += 1
        
        # Send beat updates
        current_beat_int = int(state.current_beat)
        if current_beat_int != last_beat:
            last_beat = current_beat_int
            try:
                await websocket.send_json({
                    "type": "beat",
                    "beat": current_beat_int,
                })
            except Exception:
                state.is_playing = False
                return
        
        # Advance time
        await asyncio.sleep(tick_interval)
        state.current_beat += tick_interval / beat_duration
        
        # Loop
        if state.events and state.current_event_index >= len(state.events):
            max_time = max(e.get("time", 0) for e in state.events)
            if state.current_beat > max_time + 1:
                state.current_event_index = 0
                state.current_beat = 0.0
