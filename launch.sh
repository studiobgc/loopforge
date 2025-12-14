#!/bin/bash

# LoopForge Launcher - Bulletproof Mac app launcher
# Works after sleep, restart, or fresh boot
# Starts supervisor for auto-recovery

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export HOME="/Users/ben"

LOG="/tmp/loopforge-launch.log"

echo "$(date): LoopForge starting..." > "$LOG"

backend_healthy() {
    curl -s --connect-timeout 2 "http://localhost:$LOOPFORGE_BACKEND_PORT/health" > /dev/null 2>&1
}

frontend_healthy() {
    curl -s --connect-timeout 2 "http://localhost:$LOOPFORGE_FRONTEND_PORT" > /dev/null 2>&1
}

# Check if already running and healthy
if frontend_healthy && backend_healthy; then
    echo "$(date): Already running" >> "$LOG"
    open "http://localhost:$LOOPFORGE_FRONTEND_PORT"
    exit 0
fi

echo "$(date): Starting servers..." >> "$LOG"

# Kill stale processes and any old supervisor
pkill -f "loopforge.*supervisor" 2>/dev/null
lsof -ti:$LOOPFORGE_BACKEND_PORT | xargs kill -9 2>/dev/null
lsof -ti:$LOOPFORGE_FRONTEND_PORT | xargs kill -9 2>/dev/null
sleep 1

# Start backend
echo "$(date): Starting backend..." >> "$LOG"
cd "$LOOPFORGE_APP_DIR/backend"
source venv/bin/activate
nohup venv/bin/uvicorn app.main_v2:app --host 0.0.0.0 --port $LOOPFORGE_BACKEND_PORT > /tmp/loopforge-backend.log 2>&1 &
echo $! > /tmp/loopforge-backend.pid

# Wait for backend
for i in {1..10}; do
    backend_healthy && break
    sleep 1
done

# Start frontend
echo "$(date): Starting frontend..." >> "$LOG"
cd "$LOOPFORGE_APP_DIR/frontend"
nohup npm run dev > /tmp/loopforge-frontend.log 2>&1 &
echo $! > /tmp/loopforge-frontend.pid

# Start supervisor in background for auto-recovery
echo "$(date): Starting supervisor..." >> "$LOG"
nohup "$SCRIPT_DIR/supervisor.sh" > /dev/null 2>&1 &

# Wait for frontend
for i in {1..15}; do
    if frontend_healthy; then
        echo "$(date): Ready!" >> "$LOG"
        open "http://localhost:$LOOPFORGE_FRONTEND_PORT"
        exit 0
    fi
    sleep 1
done

echo "$(date): Opening browser (may still be loading)" >> "$LOG"
open "http://localhost:$LOOPFORGE_FRONTEND_PORT"
