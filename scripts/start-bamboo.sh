#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/pi/bamboo-cut-agent"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
PYBIN="${ROOT_DIR}/backend/.venv/bin/python"

API_HOST="${API_HOST:-0.0.0.0}"
API_PORT="${API_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

BROWSER_HOST="${BROWSER_HOST:-127.0.0.1}"
BROWSER_URL="${BROWSER_URL:-http://${BROWSER_HOST}:${FRONTEND_PORT}}"
BROWSER_BIN="${BROWSER_BIN:-/usr/bin/chromium}"
CAGE_BIN="${CAGE_BIN:-/usr/bin/cage}"
XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/bamboo}"

export API_HOST API_PORT
export FRONTEND_HOST FRONTEND_PORT
export BROWSER_URL BROWSER_BIN CAGE_BIN XDG_RUNTIME_DIR

export CANMV_SERIAL_PORT="${CANMV_SERIAL_PORT:-/dev/serial0}"
export CANMV_BAUDRATE="${CANMV_BAUDRATE:-115200}"
export LIGHT_GPIO_PIN="${LIGHT_GPIO_PIN:-10}"
export LIGHT_LED_COUNT="${LIGHT_LED_COUNT:-16}"
export LIGHT_BRIGHTNESS="${LIGHT_BRIGHTNESS:-255}"
export CUTTER_PULSE_PIN="${CUTTER_PULSE_PIN:-17}"
export CUTTER_DIR_PIN="${CUTTER_DIR_PIN:-27}"
export CUTTER_ENABLE_PIN="${CUTTER_ENABLE_PIN:-22}"
export CUTTER_DIR_DOWN_VALUE="${CUTTER_DIR_DOWN_VALUE:-1}"
export CUTTER_PULSE_ACTIVE_HIGH="${CUTTER_PULSE_ACTIVE_HIGH:-0}"
export CUTTER_DIR_ACTIVE_HIGH="${CUTTER_DIR_ACTIVE_HIGH:-0}"
export CUTTER_ENABLE_ACTIVE_HIGH="${CUTTER_ENABLE_ACTIVE_HIGH:-0}"
export CUTTER_PULSE_HZ="${CUTTER_PULSE_HZ:-300}"
export CUTTER_DOWN_STEPS="${CUTTER_DOWN_STEPS:-800}"
export CUTTER_UP_STEPS="${CUTTER_UP_STEPS:-800}"
export CUTTER_DIR_SETUP_MS="${CUTTER_DIR_SETUP_MS:-5}"
export CUTTER_ENABLE_SETUP_MS="${CUTTER_ENABLE_SETUP_MS:-5}"
export CUTTER_DISABLE_AFTER_MOVE="${CUTTER_DISABLE_AFTER_MOVE:-1}"
export VIDEO_DEVICE="${VIDEO_DEVICE:-/dev/v4l/by-id/usb-MACROSILICON_V-Z624_20210621-video-index0}"
export VIDEO_WIDTH="${VIDEO_WIDTH:-1280}"
export VIDEO_HEIGHT="${VIDEO_HEIGHT:-720}"
export VIDEO_FPS="${VIDEO_FPS:-30}"
export VIDEO_ENCODER="${VIDEO_ENCODER:-x264enc}"
export VIDEO_BITRATE_KBPS="${VIDEO_BITRATE_KBPS:-2500}"
export VIDEO_STUN_SERVER="${VIDEO_STUN_SERVER:-}"
export VIDEO_SOURCE_FORMAT="${VIDEO_SOURCE_FORMAT:-jpeg}"
export VIDEO_RAW_PIXEL_FORMAT="${VIDEO_RAW_PIXEL_FORMAT:-YUY2}"
export VIDEO_QUEUE_BUFFERS="${VIDEO_QUEUE_BUFFERS:-1}"
export VIDEO_KEYFRAME_INTERVAL="${VIDEO_KEYFRAME_INTERVAL:-30}"

mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}"

backend_pid=""
frontend_pid=""

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  echo "bamboo cleanup code=${code}" >&2

  if [[ -n "${frontend_pid}" ]] && kill -0 "${frontend_pid}" 2>/dev/null; then
    echo "stopping frontend pid=${frontend_pid}" >&2
    kill "${frontend_pid}" 2>/dev/null || true
    wait "${frontend_pid}" 2>/dev/null || true
  fi

  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    echo "stopping backend pid=${backend_pid}" >&2
    kill "${backend_pid}" 2>/dev/null || true
    wait "${backend_pid}" 2>/dev/null || true
  fi

  exit "${code}"
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local name="$3"
  local attempts=60

  for ((i = 0; i < attempts; i++)); do
    if bash -lc "exec 3<>/dev/tcp/${host}/${port}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for ${name} at ${host}:${port}" >&2
  return 1
}

trap cleanup EXIT INT TERM

echo "starting bamboo stack api=${API_HOST}:${API_PORT} frontend=${FRONTEND_HOST}:${FRONTEND_PORT} browser=${BROWSER_URL}" >&2

cd "${ROOT_DIR}"
"${PYBIN}" -m uvicorn backend.app.main:app --host "${API_HOST}" --port "${API_PORT}" &
backend_pid=$!
echo "backend pid=${backend_pid}" >&2

wait_for_port "127.0.0.1" "${API_PORT}" "backend"
echo "backend ready" >&2

cd "${FRONTEND_DIR}"
/usr/bin/npm run preview -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}" &
frontend_pid=$!
echo "frontend pid=${frontend_pid}" >&2

wait_for_port "127.0.0.1" "${FRONTEND_PORT}" "frontend"
echo "frontend ready" >&2
echo "launching cage=${CAGE_BIN} browser=${BROWSER_BIN}" >&2

exec "${CAGE_BIN}" -- \
  "${BROWSER_BIN}" \
  --kiosk \
  --app="${BROWSER_URL}" \
  --start-fullscreen \
  --window-size=1280,720 \
  --window-position=0,0 \
  --enable-features=OverlayScrollbar \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --incognito \
  --ozone-platform=wayland \
  --enable-wayland-ime \
  --wayland-text-input-version=3
