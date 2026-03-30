# Bamboo Cut Agent

竹材切割工作站控制系统，包含：
- `frontend/`：React + TypeScript 工业风 HMI 界面
- `backend/`：FastAPI 后端、CanMV 桥接、视频转发、设备控制

## Runtime Architecture

整体链路分为三部分：
- 视频链路：`CanMV HDMI -> HDMI 采集卡 -> Raspberry Pi -> backend WebRTC -> frontend`
- AI/状态链路：`CanMV -> UART 或 WebSocket -> Raspberry Pi backend`
- 控制链路：`frontend -> backend /api/control/* -> Raspberry Pi 执行机构`

当前架构约束：
- 前端运行时状态只来自 `ws://<pi-ip>:8000/ws/ui`
- 前端不再通过 HTTP 轮询设备状态
- 控制命令全部是独立 HTTP 接口
- 机器执行状态仅保留在后端控制器内部，不作为公共前端状态模型暴露

相关说明文档：
- 现场 HMI：[docs/local-hmi.md](d:\github\bamboo-cut-agent\docs\local-hmi.md)
- 设备对外契约：[docs/device-api.md](d:\github\bamboo-cut-agent\docs\device-api.md)

## Project Structure

- `frontend/`：Vite 前端工程
- `backend/`：FastAPI 服务
- `systemd/`：树莓派部署用服务文件
- `pi/`：树莓派侧辅助内容

## Quick Start

### Backend

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

### Frontend

```bash
cd frontend
npm install
npm run dev
```

默认地址：
- UI：`http://localhost:5173`
- Backend：`http://localhost:8000`

## Interface Guides

- 现场操作接口与通道说明：[docs/local-hmi.md](d:\github\bamboo-cut-agent\docs\local-hmi.md)
- 外部集成接口说明：[docs/device-api.md](d:\github\bamboo-cut-agent\docs\device-api.md)

建议阅读顺序：
1. 先看现场运行与操作边界：[docs/local-hmi.md](d:\github\bamboo-cut-agent\docs\local-hmi.md)
2. 再看设备对外集成契约：[docs/device-api.md](d:\github\bamboo-cut-agent\docs\device-api.md)

## Video Streaming

前端不直接使用浏览器 `getUserMedia`，而是播放后端提供的 WebRTC 视频。

### Raspberry Pi Packages

在树莓派安装 GStreamer WebRTC 相关依赖：

```bash
sudo apt update
sudo apt install -y python3-gi python3-gst-1.0 \
  gir1.2-gst-plugins-base-1.0 gir1.2-gstreamer-1.0 \
  gir1.2-gst-plugins-bad-1.0 gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \
  gstreamer1.0-libav gstreamer1.0-nice
```

如果缺少 `gstreamer1.0-nice`，后端日志通常会出现：
- `Your GStreamer installation is missing a plug-in`

如果后端运行在 `backend/.venv` 中，需要确保可以访问系统 GI 组件：

```bash
rm -rf backend/.venv
make backend-install
```

### Video Environment

使用 HDMI 采集卡时，启动后端前设置：

```bash
export VIDEO_DEVICE=/dev/v4l/by-id/usb-MACROSILICON_V-Z624_20210621-video-index0
export VIDEO_WIDTH=1280
export VIDEO_HEIGHT=720
export VIDEO_FPS=30
export VIDEO_ENCODER=x264enc
export VIDEO_BITRATE_KBPS=2500
export VIDEO_SOURCE_FORMAT=jpeg
export VIDEO_QUEUE_BUFFERS=1
export VIDEO_KEYFRAME_INTERVAL=30
```

建议：
- 默认使用 `VIDEO_ENCODER=x264enc` 以获得更高兼容性
- 保持 `VIDEO_QUEUE_BUFFERS=1`，避免旧帧积压导致画面越看越慢
- 如果硬件编码链路验证通过，可再尝试 `VIDEO_ENCODER=v4l2h264enc`
- 如果采集卡支持更低延迟格式，可继续尝试 `VIDEO_SOURCE_FORMAT=raw` 或 `VIDEO_SOURCE_FORMAT=h264`

前端通过：
- `ws://<pi-ip>:8000/ws/video`

建立 WebRTC 视频连接。

## Systemd Services

仓库只保留一个统一服务文件：
- `systemd/bamboo.service`

统一服务启动链路：
- `systemd`
- `scripts/start-bamboo.sh`
- FastAPI backend
- Vite preview frontend
- `Cage`
- `Chromium --kiosk`

树莓派安装方式：

```bash
make install-service
```

如果要做纯 kiosk 设备：

```bash
sudo systemctl disable --now lightdm || true
sudo systemctl set-default multi-user.target
```

`bamboo.service` 会在 `tty1` 上拉起完整运行栈，并最终通过 `Cage + Chromium` 全屏显示 UI。

常用命令：

```bash
make service-status
make service-restart
make service-logs
make deploy
```

## CanMV Communication

CanMV 可以通过 WebSocket 或串口向树莓派发送 AI 结果。

### Wiring: CanMV to Raspberry Pi

推荐使用三条独立链路：

1. `HDMI` 传视频
2. `UART over GPIO` 传识别结果、切割请求和切割位配置
3. `GPIO 数字输入` 传硬实时切割触发

### HDMI Video Path

- `CanMV HDMI` -> `HDMI capture card input`
- `Capture card USB` -> `Raspberry Pi USB`

后端通过 V4L2 读取采集卡，再通过 WebRTC 转给前端。

### UART GPIO Path

推荐三线 UART：

- `CanMV Pin 8 TX1(IO3)` -> `Raspberry Pi Pin 10 RXD(GPIO15)`
- `CanMV Pin 10 RX1(IO4)` -> `Raspberry Pi Pin 8 TXD(GPIO14)`
- `CanMV Pin 9 GND` -> `Raspberry Pi Pin 6 GND`

规则：
- `TX -> RX`
- `RX -> TX`
- `GND -> GND`
- 不要连接 `5V`
- 不要把两块板的 `3.3V` 电源轨直接互连

默认运行配置：

```bash
CANMV_SERIAL_PORT=/dev/serial0
CANMV_BAUDRATE=115200
CANMV_CUT_REQUEST_INPUT_PIN=24
LIGHT_GPIO_PIN=10
LIGHT_LED_COUNT=16
LIGHT_BRIGHTNESS=255
```

### CanMV Hard Trigger GPIO Path

为了让自动切割尽量不依赖 UART JSON 解析延迟，推荐增加一条 `CanMV -> Raspberry Pi` 的硬触发线：

- `CanMV 3.3V GPIO output` -> `Raspberry Pi BCM GPIO24 / physical pin 18`
- `CanMV GND` -> `Raspberry Pi GND`

说明：
- 这是一条单独的数字信号线，只负责“到达切割位/允许切割”这一类关键触发
- 推荐输出 `3.3V` 高电平触发
- 当前后端默认按 `pull_down + active_high` 读取该输入
- 若已配置 `CANMV_CUT_REQUEST_INPUT_PIN`，自动流程会优先使用 GPIO 触发
- UART 仍然保留，用于识别框、温度、FPS、诊断与切割配置下发

推荐职责划分：

- `HDMI`: 视频画面
- `UART`: AI 状态、识别结果、诊断、配置
- `GPIO`: 关键切割触发

### Work Light Wiring

本项目当前使用树莓派 5 的 SPI 路径驱动 `WS2812/WS2812B` 灯带：

- `Red` -> `5V`
- `Black` -> `GND`
- `Yellow` -> `BCM GPIO10 / MOSI / physical pin 19`

说明：
- `LIGHT_LED_COUNT` 必须和实际灯珠数量一致
- `LIGHT_BRIGHTNESS` 范围为 `0-255`

### Enable Raspberry Pi Serial

```bash
sudo raspi-config
```

设置：
- `Interface Options -> Serial Port`
- `Login shell over serial`: `No`
- `Serial port hardware enabled`: `Yes`

重启后检查：

```bash
ls -l /dev/serial0
```

### CanMV WebSocket Ingest

- 地址：`ws://<pi-ip>:8000/ws/canmv`
- 消息示例：

```json
{
  "timestamp": 1710000000.123,
  "fps": 18.2,
  "cut_request": false,
  "canmv_status": {
    "cpu_percent": 18.5,
    "kpu_percent": 42.0,
    "memory_percent": 36.0,
    "temperature_c": 54.2
  },
  "detections": [
    {
      "label": "node",
      "score": 0.92,
      "x": 120,
      "y": 80,
      "w": 60,
      "h": 40
    }
  ]
}
```

UI 订阅：
- `ws://<pi-ip>:8000/ws/ui`

后端会向 UI 推送：
- `system_status`
- `ai_frame`

### CanMV Serial Ingest

- 当 HDMI 负责视频时，串口负责 `CanMV -> Raspberry Pi` 的 AI/状态上报
- 串口格式：按行分隔的 JSON
- 结构与 WebSocket 上报负载一致
- 默认端口：`/dev/serial0`
- 若已启用 `CANMV_CUT_REQUEST_INPUT_PIN`，串口中的 `cut_request` 主要作为状态参考，不再作为自动流程首选触发源

### Local Simulation

无 CanMV 板卡时可本地模拟：

```bash
cd backend
python examples/canmv_ws_sender.py --host 127.0.0.1 --port 8000 --fps 10
```

## Notes

- 工作灯由后端通过 Raspberry Pi 5 SPI 方式输出 `WS2812` 数据信号
- 统一服务默认内置 `LIGHT_GPIO_PIN`、`LIGHT_LED_COUNT`、`LIGHT_BRIGHTNESS` 等运行参数
- 当前优先使用 `rpi5-ws2812`，在非树莓派开发环境下降级为 no-op 驱动
- 当前 UI 灯带行为：
  - 滑块设置 `0-16` 的待应用灯珠数量
  - `应用灯带设置` 将该数量写入灯带
  - `关灯` 立即关闭全部灯珠
- 前端视频由后端 WebRTC 提供
- 当 CanMV 上报 `canmv_status` 时，UI 会显示 CPU/KPU/内存/温度

## Cage Kiosk Mode

推荐在树莓派上使用 `Cage + Chromium` 运行全屏 UI，而不是完整桌面环境。

### Install packages

```bash
sudo apt update
sudo apt install -y cage chromium
```

### Install services

```bash
cd ~/bamboo-cut-agent
make install-service
```

### Disable desktop session

如果设备只用于全屏运行 UI，可以关闭桌面管理器并切到多用户目标：

```bash
sudo systemctl disable --now lightdm || true
sudo systemctl set-default multi-user.target
sudo reboot
```

### Runtime behavior

- `bamboo.service`：启动 backend、frontend，并在 `tty1` 上以 `Cage + Chromium` 显示全屏 UI

### Debug commands

```bash
make service-status
make service-logs
```
