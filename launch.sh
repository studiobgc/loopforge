#!/bin/bash

# LoopForge Launcher - Fast startup for Mac app

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export HOME="/Users/ben"
APP_DIR="/Users/ben/Documents/GitHub/loopforge"
LOG="/tmp/loopforge-launch.log"

echo "$(date): Starting LoopForge..." > "$LOG"

# Check if already running - instant open
if curl -s --connect-timeout 1 http://localhost:3001 > /dev/null 2>&1; then
    echo "$(date): Already running" >> "$LOG"
    open "http://localhost:3001"
    exit 0
fi

# Kill stale processes quickly
lsof -ti:8000 | xargs kill -9 2>/dev/null &
lsof -ti:3001 | xargs kill -9 2>/dev/null &
sleep 0.5

# Start backend
echo "$(date): Starting backend..." >> "$LOG"
cd "$APP_DIR/backend"
source venv/bin/activate 2>> "$LOG"
nohup "$APP_DIR/backend/venv/bin/uvicorn" app.main_v2:app --host 0.0.0.0 --port 8000 >> /tmp/loopforge-backend.log 2>&1 &

# Start frontend immediately (don't wait for backend)
echo "$(date): Starting frontend..." >> "$LOG"
cd "$APP_DIR/frontend"
nohup npm run dev >> /tmp/loopforge-frontend.log 2>&1 &

# Quick wait for frontend (up to 8 seconds)
for i in {1..8}; do
    sleep 1
    if curl -s --connect-timeout 1 http://localhost:3001 > /dev/null 2>&1; then
        echo "$(date): Ready!" >> "$LOG"
        open "http://localhost:3001"
        exit 0
    fi
done

# Fallback: open anyway, frontend might still be loading
echo "$(date): Opening (may still be loading)" >> "$LOG"
open "http://localhost:3001"
