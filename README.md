# Bamboo Cut Agent

Initial scaffold for:
- React + TypeScript UI
- FastAPI backend
- CanMV AI result communication

## Structure
- `frontend/`: React UI (Vite)
- `backend/`: FastAPI service, WebSocket bridge for CanMV/UI

## Quick Start
### 1) Backend
```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

UI default URL: `http://localhost:5173`
Backend default URL: `http://localhost:8000`

## CanMV Communication
CanMV can send AI results by either WebSocket (recommended) or serial.

### WebSocket ingest
- URL: `ws://<pi-ip>:8000/ws/canmv`
- Message example:
```json
{
  "timestamp": 1710000000.123,
  "fps": 18.2,
  "detections": [
    {"label": "node", "score": 0.92, "x": 120, "y": 80, "w": 60, "h": 40}
  ]
}
```

UI subscribes to:
- `ws://<pi-ip>:8000/ws/ui`

### Serial ingest (optional)
- Set env in `backend/.env.example` format:
  - `CANMV_SERIAL_PORT=/dev/ttyUSB0`
  - `CANMV_BAUDRATE=115200`
- Then start backend with these env vars.
- Serial format: newline-delimited JSON, same schema as websocket payload.

### Local simulation (without CanMV board)
```bash
cd backend
python examples/canmv_ws_sender.py --host 127.0.0.1 --port 8000 --fps 10
```

## Notes
- Motor I/O is currently mocked in `backend/app/motor_control.py`.
- Replace with GPIO/relay driver logic on Raspberry Pi.
- Frontend camera is USB UVC via browser `getUserMedia`.
