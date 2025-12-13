#!/bin/bash

# LOOP FORGE Startup Script
echo "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄"
echo "█     LOOP FORGE — SAMPLE LAB     █"
echo "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀"

# Prevent background processes from being suspended when they write to the terminal
stty -tostop 2>/dev/null || true

# QUICK MODE: Skip Demucs AI separation (much faster for testing)
# Usage: QUICK=1 ./start.sh
if [ "$QUICK" = "1" ] || [ "$1" = "--quick" ]; then
    export LOOPFORGE_QUICK_MODE=1
    echo "⚡ QUICK MODE: Skipping AI separation (files copied as stems)"
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Start backend
echo "[1/2] Starting backend on port 8000..."

# SENIOR-LEVEL: Aggressive cleanup of stuck processes
echo "[START] Killing any existing backend processes..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
# Kill any existing frontend dev server too
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
# Also kill any stuck Python/uvicorn processes
pkill -9 -f "uvicorn.*app.main_v2" 2>/dev/null || true
pkill -9 -f "python.*app.main_v2" 2>/dev/null || true
sleep 2

cd "$SCRIPT_DIR/backend"
source venv/bin/activate 2>/dev/null || {
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
}

# Start backend with logging
uvicorn app.main_v2:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 60 --limit-max-requests 1000 > /tmp/backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend and verify it's healthy
echo "Waiting for backend to start..."
for i in {1..10}; do
    sleep 1
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "✅ Backend is running and healthy"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ Backend failed to start. Check /tmp/backend.log for errors."
        tail -20 /tmp/backend.log
        exit 1
    fi
done

# Start frontend
echo "[2/2] Starting frontend on port 3001..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
npm run dev &
FRONTEND_PID=$!

echo ""
echo "▶ LoopForge running at: http://localhost:3001"
echo "▶ Press Ctrl+C to stop"
echo ""

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

# Wait
wait
