#!/bin/bash

# LoopForge Supervisor - Keeps servers running with auto-restart
# Run this in background: nohup ./supervisor.sh &

source "$(dirname "$0")/config.sh"

LOG="/tmp/loopforge-supervisor.log"
CHECK_INTERVAL=10  # seconds between health checks
MAX_RESTARTS=5     # max restarts before giving up
RESTART_COUNT=0

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

backend_healthy() {
    curl -s --connect-timeout 3 "http://localhost:$LOOPFORGE_BACKEND_PORT/health" > /dev/null 2>&1
}

frontend_healthy() {
    curl -s --connect-timeout 3 "http://localhost:$LOOPFORGE_FRONTEND_PORT" > /dev/null 2>&1
}

start_backend() {
    log "Starting backend..."
    cd "$LOOPFORGE_APP_DIR/backend"
    source venv/bin/activate
    nohup venv/bin/uvicorn app.main_v2:app --host 0.0.0.0 --port $LOOPFORGE_BACKEND_PORT > /tmp/loopforge-backend.log 2>&1 &
    echo $! > /tmp/loopforge-backend.pid
    log "Backend started (PID: $(cat /tmp/loopforge-backend.pid))"
}

start_frontend() {
    log "Starting frontend..."
    cd "$LOOPFORGE_APP_DIR/frontend"
    nohup npm run dev > /tmp/loopforge-frontend.log 2>&1 &
    echo $! > /tmp/loopforge-frontend.pid
    log "Frontend started (PID: $(cat /tmp/loopforge-frontend.pid))"
}

cleanup() {
    log "Supervisor stopping..."
    exit 0
}

trap cleanup SIGINT SIGTERM

log "=== LoopForge Supervisor Started ==="
log "Backend port: $LOOPFORGE_BACKEND_PORT, Frontend port: $LOOPFORGE_FRONTEND_PORT"

# Initial start if not running
if ! backend_healthy; then
    lsof -ti:$LOOPFORGE_BACKEND_PORT | xargs kill -9 2>/dev/null
    sleep 1
    start_backend
    sleep 3
fi

if ! frontend_healthy; then
    lsof -ti:$LOOPFORGE_FRONTEND_PORT | xargs kill -9 2>/dev/null
    sleep 1
    start_frontend
    sleep 3
fi

# Main monitoring loop
while true; do
    sleep $CHECK_INTERVAL
    
    # Check backend
    if ! backend_healthy; then
        RESTART_COUNT=$((RESTART_COUNT + 1))
        log "Backend offline! Restart attempt $RESTART_COUNT/$MAX_RESTARTS"
        
        if [ $RESTART_COUNT -gt $MAX_RESTARTS ]; then
            log "Max restarts exceeded. Check logs manually."
            RESTART_COUNT=0
            sleep 60  # Wait before trying again
            continue
        fi
        
        lsof -ti:$LOOPFORGE_BACKEND_PORT | xargs kill -9 2>/dev/null
        sleep 2
        start_backend
        sleep 5
        
        if backend_healthy; then
            log "Backend recovered!"
            RESTART_COUNT=0
        fi
    fi
    
    # Check frontend
    if ! frontend_healthy; then
        log "Frontend offline! Restarting..."
        lsof -ti:$LOOPFORGE_FRONTEND_PORT | xargs kill -9 2>/dev/null
        sleep 2
        start_frontend
        sleep 5
        
        if frontend_healthy; then
            log "Frontend recovered!"
        fi
    fi
done
