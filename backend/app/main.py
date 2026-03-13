from __future__ import annotations

import json
import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .canmv_bridge import CanMvBridge
from .models import AiFrame, MotorCommand, MotorStatus, SystemStatus
from .motor_control import MotorController
from .system_status import SystemStatusStore
from .video_webrtc import VideoWebRtcManager
from .ws_manager import WebSocketHub

app = FastAPI(title="Bamboo Cut Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

hub = WebSocketHub()
motor = MotorController()
video = VideoWebRtcManager()
system_status = SystemStatusStore()
canmv_bridge = CanMvBridge(
    hub=hub,
    serial_port=os.getenv("CANMV_SERIAL_PORT"),
    baudrate=int(os.getenv("CANMV_BAUDRATE", "115200")),
    on_frame=system_status.update_canmv_frame,
)


@app.on_event("startup")
async def startup() -> None:
    await canmv_bridge.start()


@app.on_event("shutdown")
async def shutdown() -> None:
    await canmv_bridge.stop()
    await video.shutdown()


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "ts": time.time()}


@app.get("/api/canmv/config")
async def canmv_config() -> dict[str, Any]:
    return {
        "websocket_ingest": "/ws/canmv",
        "serial_port": os.getenv("CANMV_SERIAL_PORT"),
        "baudrate": int(os.getenv("CANMV_BAUDRATE", "115200")),
    }


@app.get("/api/video/config")
async def video_config() -> dict[str, Any]:
    return video.describe()


@app.get("/api/motor/status", response_model=MotorStatus)
async def motor_status() -> MotorStatus:
    return await motor.status()


@app.get("/api/system/status", response_model=SystemStatus)
async def get_system_status() -> SystemStatus:
    return system_status.snapshot()


@app.post("/api/motor/command", response_model=MotorStatus)
async def motor_command(req: MotorCommand) -> MotorStatus:
    try:
        return await motor.command(req.command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.websocket("/ws/ui")
async def ws_ui(ws: WebSocket) -> None:
    await hub.add_ui(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.remove_ui(ws)
    except Exception:
        hub.remove_ui(ws)


@app.websocket("/ws/canmv")
async def ws_canmv(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            payload = json.loads(raw)
            if "timestamp" not in payload:
                payload["timestamp"] = time.time()

            frame = AiFrame.model_validate(payload)
            system_status.update_canmv_frame(frame)
            await hub.broadcast_to_ui(frame.model_dump_json())
    except WebSocketDisconnect:
        return
    except Exception:
        return


@app.websocket("/ws/video")
async def ws_video(ws: WebSocket) -> None:
    await video.run_session(ws)
