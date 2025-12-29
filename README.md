# STEMSPLIT

> "NO HOPE, NO DREAMS, NO LOVE — ONLY STEMS"

Underground stem separation powered by Demucs AI.

## Quick Start

```bash
# Install backend dependencies
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# In a new terminal, install frontend
cd frontend
npm install

# Start backend (terminal 1)
cd backend
source venv/bin/activate
uvicorn app.main_v2:app --reload --host 0.0.0.0 --port 8000

# Start frontend (terminal 2)
cd frontend
npm run dev
```

Open http://loopforge.local:3001

### Local Domain Setup

Add to `/etc/hosts`:
```
127.0.0.1 loopforge.local
```

### Remote Access (Tailscale)

Access LoopForge securely from anywhere — phone on cellular, laptop at coffee shop, etc.

```bash
# One-time setup
./scripts/setup-tailscale.sh
```

Or manually:
1. Install [Tailscale](https://tailscale.com/download) on your Mac
2. Install Tailscale on your phone/other devices
3. Log in with the same account on all devices
4. Access via your Tailscale IP: `http://100.x.x.x:3001`

**Security**: End-to-end encrypted, only YOUR devices can access.

## Features

- **Drag & drop** WAV, MP3, FLAC, M4A files
- **4 stem separation**: Drums, Bass, Vocals, Other (Melody)
- **GPU accelerated**: CUDA, Apple Silicon MPS, or CPU fallback
- **Real-time progress** via WebSocket
- **Download individual stems** or all as ZIP

## Tech Stack

- **AI Model**: Demucs htdemucs (Meta, 9.0 dB SDR)
- **Backend**: FastAPI, PyTorch, torchaudio
- **Frontend**: React, Vite, TailwindCSS
- **Aesthetic**: Underground Resistance / 90s Detroit Techno

## Requirements

- Python 3.8+
- Node.js 18+
- FFmpeg (for audio processing)
- ~4GB RAM minimum
- GPU recommended (Apple M1/M2/M3 or NVIDIA)

## License

MIT — Somewhere in the Underground, 2024
