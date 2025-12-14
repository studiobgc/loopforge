#!/bin/bash

# LoopForge Launcher - called by the Mac app
# Ensures proper environment for npm/node

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME="/Users/ben"
APP_DIR="/Users/ben/Documents/GitHub/loopforge"

# Log file for debugging
LOG="/tmp/loopforge-launch.log"
echo "$(date): Starting LoopForge..." > "$LOG"

# Check if already running
if curl -s http://localhost:3001 > /dev/null 2>&1; then
    echo "$(date): Already running, opening browser" >> "$LOG"
    open "http://loopforge.local:3001"
    exit 0
fi

# Kill existing processes
echo "$(date): Killing existing processes..." >> "$LOG"
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
sleep 2

# Start backend
echo "$(date): Starting backend..." >> "$LOG"
cd "$APP_DIR/backend"
source venv/bin/activate 2>> "$LOG"
nohup "$APP_DIR/backend/venv/bin/uvicorn" app.main_v2:app --host 0.0.0.0 --port 8000 >> /tmp/loopforge-backend.log 2>&1 &
BACKEND_PID=$!
echo "$(date): Backend PID: $BACKEND_PID" >> "$LOG"

# Wait for backend (up to 20 seconds)
for i in {1..20}; do
    sleep 1
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "$(date): Backend ready" >> "$LOG"
        break
    fi
done

# Start frontend with explicit node path
echo "$(date): Starting frontend..." >> "$LOG"
cd "$APP_DIR/frontend"
nohup /opt/homebrew/bin/npm run dev >> /tmp/loopforge-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "$(date): Frontend PID: $FRONTEND_PID" >> "$LOG"

# Wait for frontend (up to 20 seconds)
for i in {1..20}; do
    sleep 1
    if curl -s http://localhost:3001 > /dev/null 2>&1; then
        echo "$(date): Frontend ready" >> "$LOG"
        break
    fi
done

# Final check and open browser
if curl -s http://localhost:3001 > /dev/null 2>&1; then
    echo "$(date): Opening browser" >> "$LOG"
    open "http://loopforge.local:3001"
else
    echo "$(date): Frontend failed to start!" >> "$LOG"
    # Show error to user
    osascript -e 'display dialog "LoopForge failed to start. Check /tmp/loopforge-launch.log for details." buttons {"OK"} default button "OK" with icon stop'
fi
