#!/bin/bash

# LoopForge Launcher - Bulletproof Mac app launcher
# Works after sleep, restart, or fresh boot

# Load config
source "$(dirname "$0")/config.sh"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export HOME="/Users/ben"

LOG="/tmp/loopforge-launch.log"
BACKEND_LOG="/tmp/loopforge-backend.log"
FRONTEND_LOG="/tmp/loopforge-frontend.log"

echo "$(date): LoopForge starting..." > "$LOG"

# Function to check if backend is healthy
backend_healthy() {
    curl -s --connect-timeout 2 "http://localhost:$LOOPFORGE_BACKEND_PORT/health" > /dev/null 2>&1
}

# Function to check if frontend is healthy  
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

# Kill any stale processes
lsof -ti:$LOOPFORGE_BACKEND_PORT | xargs kill -9 2>/dev/null
lsof -ti:$LOOPFORGE_FRONTEND_PORT | xargs kill -9 2>/dev/null
sleep 1

# Start backend
echo "$(date): Starting backend on port $LOOPFORGE_BACKEND_PORT..." >> "$LOG"
cd "$LOOPFORGE_APP_DIR/backend"
source venv/bin/activate
nohup venv/bin/uvicorn app.main_v2:app --host 0.0.0.0 --port $LOOPFORGE_BACKEND_PORT > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "$(date): Backend PID: $BACKEND_PID" >> "$LOG"

# Wait for backend to be ready (up to 10 seconds)
for i in {1..10}; do
    if backend_healthy; then
        echo "$(date): Backend ready" >> "$LOG"
        break
    fi
    sleep 1
done

# Start frontend
echo "$(date): Starting frontend on port $LOOPFORGE_FRONTEND_PORT..." >> "$LOG"
cd "$LOOPFORGE_APP_DIR/frontend"
nohup npm run dev > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo "$(date): Frontend PID: $FRONTEND_PID" >> "$LOG"

# Wait for frontend (up to 15 seconds)
for i in {1..15}; do
    if frontend_healthy; then
        echo "$(date): Ready! Opening browser..." >> "$LOG"
        open "http://localhost:$LOOPFORGE_FRONTEND_PORT"
        exit 0
    fi
    sleep 1
done

# Fallback: open anyway
echo "$(date): Timeout - opening browser anyway" >> "$LOG"
open "http://localhost:$LOOPFORGE_FRONTEND_PORT"
