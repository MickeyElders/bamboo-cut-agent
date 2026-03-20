from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from fastapi import HTTPException

from ..canmv_bridge import CanMvBridge
from ..cut_config import CutConfigStore
from ..models import AiFrame, CommandAck, JobStatus
from ..system_status import SystemStatusStore
from ..video_webrtc import VideoWebRtcManager
from ..ws_manager import WebSocketHub
from .motor_control import MotorController
from .system_control import SystemControlService

logger = logging.getLogger(__name__)


class RuntimeServices:
    def __init__(self) -> None:
        self.hub = WebSocketHub()
        self.motor = MotorController()
        self.video = VideoWebRtcManager()
        self.system_status = SystemStatusStore()
        self.system = SystemControlService()
        self.cut_config_store = CutConfigStore(path=os.getenv("CUT_CONFIG_PATH"))
        self.status_task: asyncio.Task | None = None
        self.canmv_bridge = CanMvBridge(
            hub=self.hub,
            serial_port=os.getenv("CANMV_SERIAL_PORT"),
            baudrate=int(os.getenv("CANMV_BAUDRATE", "115200")),
            on_frame=self.handle_ai_frame,
        )

    async def broadcast_system_status(self) -> None:
        snapshot = self.system_status.snapshot()
        motor_status = await self.motor.status()
        job_status = JobStatus(
            mode=str(motor_status.get("mode", "auto")),
            auto_state=str(motor_status.get("auto_state", "unknown")),
            cycle_count=int(motor_status.get("cycle_count", 0)),
            last_action=str(motor_status.get("last_action", "init")),
            cut_request_active=bool(motor_status.get("cut_request_active", False)),
        )
        payload = snapshot.model_copy(update={"job_status": job_status}).model_dump()
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
        logger.info("runtime startup begin")
        await self.canmv_bridge.start()
        await self.canmv_bridge.set_cut_config(self.cut_config_store.get())
        self.status_task = asyncio.create_task(self.status_broadcast_loop())
        logger.info("runtime startup complete")

    async def shutdown(self) -> None:
        logger.info("runtime shutdown begin")
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
        logger.info("runtime shutdown complete")

    async def execute_control(self, command: str, value: int | None = None) -> CommandAck:
        try:
            logger.info("execute control command=%s value=%s", command, value)
            await self.motor.command(command, value)
            ack = CommandAck(command=command, value=value, timestamp=time.time())
            logger.info("execute control success command=%s value=%s", command, value)
            return ack
        except ValueError as exc:
            logger.warning("execute control rejected command=%s value=%s detail=%s", command, value, exc)
            raise HTTPException(status_code=400, detail=str(exc)) from exc


runtime = RuntimeServices()
