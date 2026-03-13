from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Awaitable, Callable, Optional

from .models import AiFrame
from .ws_manager import WebSocketHub

try:
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None


class CanMvBridge:
    """
    Optional serial bridge.
    Reads newline-delimited JSON from CanMV over serial and forwards to UI websocket clients.
    """

    def __init__(
        self,
        hub: WebSocketHub,
        serial_port: Optional[str] = None,
        baudrate: int = 115200,
        on_frame: Callable[[AiFrame], Awaitable[None] | None] | None = None,
    ) -> None:
        self._hub = hub
        self._serial_port = serial_port
        self._baudrate = baudrate
        self._on_frame = on_frame
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        if not self._serial_port or serial is None:
            return

        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            with contextlib.suppress(Exception):
                await self._task

    async def _loop(self) -> None:
        while self._running:
            try:
                with serial.Serial(self._serial_port, self._baudrate, timeout=1) as ser:
                    while self._running:
                        line = ser.readline().decode(errors="ignore").strip()
                        if not line:
                            await asyncio.sleep(0)
                            continue

                        data = json.loads(line)
                        if "timestamp" not in data:
                            data["timestamp"] = time.time()

                        frame = AiFrame.model_validate(data)
                        if self._on_frame is not None:
                            result = self._on_frame(frame)
                            if asyncio.iscoroutine(result):
                                await result
                        await self._hub.broadcast_to_ui(frame.model_dump_json())
            except Exception:
                await asyncio.sleep(2)
