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
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Start frontend (terminal 2)
cd frontend
npm run dev
```

Open http://localhost:3001

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
