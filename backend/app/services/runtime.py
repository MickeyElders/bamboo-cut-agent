from __future__ import annotations

import asyncio
import json
import os
import time

from fastapi import HTTPException

from ..canmv_bridge import CanMvBridge
from ..cut_config import CutConfigStore
from ..models import AiFrame, CommandAck
from ..system_status import SystemStatusStore
from ..video_webrtc import VideoWebRtcManager
from ..ws_manager import WebSocketHub
from .motor_control import MotorController


class RuntimeServices:
    def __init__(self) -> None:
        self.hub = WebSocketHub()
        self.motor = MotorController()
        self.video = VideoWebRtcManager()
        self.system_status = SystemStatusStore()
        self.cut_config_store = CutConfigStore(path=os.getenv("CUT_CONFIG_PATH"))
        self.status_task: asyncio.Task | None = None
        self.canmv_bridge = CanMvBridge(
            hub=self.hub,
            serial_port=os.getenv("CANMV_SERIAL_PORT"),
            baudrate=int(os.getenv("CANMV_BAUDRATE", "115200")),
            on_frame=self.handle_ai_frame,
        )

    async def broadcast_system_status(self) -> None:
        payload = self.system_status.snapshot().model_dump()
        await self.hub.broadcast_to_ui(json.dumps({"type": "system_status", "payload": payload}))

    async def broadcast_ai_frame(self, frame: AiFrame) -> None:
        await self.hub.broadcast_to_ui(json.dumps({"type": "ai_frame", "payload": frame.model_dump()}))

    async def handle_ai_frame(self, frame: AiFrame) -> None:
        self.system_status.update_canmv_frame(frame)
        await self.motor.process_ai_frame(frame)
        await self.broadcast_system_status()

    async def status_broadcast_loop(self) -> None:
        while True:
            await self.broadcast_system_status()
            await asyncio.sleep(2.0)

    async def startup(self) -> None:
        await self.canmv_bridge.start()
        await self.canmv_bridge.set_cut_config(self.cut_config_store.get())
        self.status_task = asyncio.create_task(self.status_broadcast_loop())

    async def shutdown(self) -> None:
        await self.canmv_bridge.stop()
        if self.status_task is not None:
            self.status_task.cancel()
            try:
                await self.status_task
            except asyncio.CancelledError:
                pass
            self.status_task = None
        await self.motor.shutdown()
        await self.video.shutdown()

    async def execute_control(self, command: str, value: int | None = None) -> CommandAck:
        try:
            await self.motor.command(command, value)
            return CommandAck(command=command, value=value, timestamp=time.time())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


runtime = RuntimeServices()
