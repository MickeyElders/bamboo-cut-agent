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
  gstreamer1.0-libav gstreamer1.0-nice
```

`webrtcbin` also requires ICE support from `gstreamer1.0-nice`. If it is missing, backend logs show errors like `sendrecv can't handle caps ... Your GStreamer installation is missing a plug-in`.

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
The repository includes backend/frontend/kiosk `systemd` units and one shared env file template:
- `systemd/bamboo-backend.service`
- `systemd/bamboo-frontend.service`
- `systemd/bamboo-kiosk.service`
- `systemd/bamboo.env.example`

Install and enable it on Raspberry Pi:
```bash
cp systemd/bamboo.env.example systemd/bamboo.env
make install-service
make install-frontend-service
make install-kiosk-service
```

For a kiosk-only appliance setup:
```bash
sudo systemctl disable --now lightdm || true
sudo systemctl set-default multi-user.target
```

The kiosk service starts Chromium in fullscreen on tty1 and opens `BROWSER_URL` from `systemd/bamboo.env`.

Useful commands:
```bash
make service-status
make service-restart
make service-logs
make frontend-service-status
make frontend-service-restart
make frontend-service-logs
make kiosk-service-status
make kiosk-service-restart
make kiosk-service-logs
make deploy SERVICE=bamboo-backend.service FRONTEND_SERVICE=bamboo-frontend.service
```

## CanMV Communication
CanMV can send AI results by either WebSocket (recommended) or serial.

### Wiring: CanMV to Raspberry Pi
Use two independent links:

1. `HDMI` for video
2. `UART over GPIO` for detections, cut requests, and cut-line config

#### HDMI video path
- `CanMV HDMI` -> `HDMI capture card input`
- `Capture card USB` -> `Raspberry Pi USB`

The backend reads the capture card through V4L2 and forwards video to the UI over WebRTC.

#### UART GPIO path
Recommended three-wire UART connection:

- `CanMV Pin 8  TX1(IO3)` -> `Raspberry Pi Pin 10 RXD(GPIO15)`
- `CanMV Pin 10 RX1(IO4)` -> `Raspberry Pi Pin 8  TXD(GPIO14)`
- `CanMV Pin 9  GND` -> `Raspberry Pi Pin 6  GND`

Rules:
- `TX -> RX`
- `RX -> TX`
- `GND -> GND`
- Do not connect `5V`
- Do not connect `3.3V` power rails between the boards

The shared runtime config uses:

```bash
CANMV_SERIAL_PORT=/dev/serial0
CANMV_BAUDRATE=115200
LIGHT_GPIO_PIN=2
LIGHT_ACTIVE_HIGH=1
```

Work light wiring:
- `Red` -> `5V`
- `Black` -> `GND`
- `Yellow` -> `BCM GPIO18`
- `LIGHT_ACTIVE_HIGH=1` means output high level turns the light on

Enable Raspberry Pi hardware serial:

```bash
sudo raspi-config
```

Then set:
- `Interface Options` -> `Serial Port`
- `Login shell over serial`: `No`
- `Serial port hardware enabled`: `Yes`

Reboot and verify:

```bash
ls -l /dev/serial0
```

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

### Serial ingest
- Serial transport is used for `CanMV -> Raspberry Pi` control/status when HDMI carries video.
- Serial format: newline-delimited JSON, same schema as websocket payload.
- The default runtime port is `/dev/serial0`.

### Local simulation (without CanMV board)
```bash
cd backend
python examples/canmv_ws_sender.py --host 127.0.0.1 --port 8000 --fps 10
```

## Notes
- Work light output is now wired through backend GPIO control.
- Backend reads `LIGHT_GPIO_PIN` and `LIGHT_ACTIVE_HIGH` from `systemd/bamboo.env`.
- Current implementation uses `gpiozero.PWMOutputDevice` when available and degrades to a no-op driver on non-Raspberry Pi development machines.
- The current UI behavior is `开灯 = 100% PWM duty`, `关灯 = 0% PWM duty`.
- Frontend video is provided by backend WebRTC streaming.
- `CanMV` CPU/KPU usage is shown when the CanMV payload includes `canmv_status`.
