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

## Video Streaming
The UI now expects backend-provided WebRTC video instead of browser `getUserMedia`.

### Raspberry Pi packages
Install system packages for GStreamer WebRTC and Python GI bindings:
```bash
sudo apt update
sudo apt install -y python3-gi python3-gst-1.0 \
  gir1.2-gst-plugins-base-1.0 gir1.2-gstreamer-1.0 \
  gir1.2-gst-plugins-bad-1.0 gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav
```

If the backend runs inside `backend/.venv`, recreate it with system packages exposed so `python3-gi` is importable:
```bash
rm -rf backend/.venv
make backend-install
```

### Video environment
Set these before starting the backend when using the HDMI capture card:
```bash
export VIDEO_DEVICE=/dev/v4l/by-id/usb-MACROSILICON_V-Z624_20210621-video-index0
export VIDEO_WIDTH=1280
export VIDEO_HEIGHT=720
export VIDEO_FPS=30
export VIDEO_ENCODER=x264enc
export VIDEO_BITRATE_KBPS=2500
```

The frontend starts video through WebRTC signaling on `ws://<pi-ip>:8000/ws/video`.

## Systemd Service
The repository includes a backend `systemd` unit and env file template:
- `systemd/bamboo-backend.service`
- `systemd/bamboo-backend.env.example`
- `systemd/bamboo-frontend.service`
- `systemd/bamboo-frontend.env.example`

Install and enable it on Raspberry Pi:
```bash
cp systemd/bamboo-backend.env.example systemd/bamboo-backend.env
make install-service
cp systemd/bamboo-frontend.env.example systemd/bamboo-frontend.env
make install-frontend-service
```

Useful commands:
```bash
make service-status
make service-restart
make service-logs
make frontend-service-status
make frontend-service-restart
make frontend-service-logs
make deploy SERVICE=bamboo-backend.service FRONTEND_SERVICE=bamboo-frontend.service
```

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
- Frontend video is provided by backend WebRTC streaming.
