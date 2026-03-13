from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Awaitable, Callable, Optional

from .models import AiFrame, CutConfig
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
        self._serial = None
        self._write_lock = asyncio.Lock()
        self._pending_cut_config: CutConfig | None = None

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
        self._serial = None

    async def set_cut_config(self, config: CutConfig) -> None:
        self._pending_cut_config = config.model_copy(deep=True)
        await self._write_message(
            {
                "type": "cut_config",
                "payload": self._pending_cut_config.model_dump(),
            }
        )

    async def _loop(self) -> None:
        while self._running:
            try:
                with serial.Serial(self._serial_port, self._baudrate, timeout=1) as ser:
                    self._serial = ser
                    if self._pending_cut_config is not None:
                        await self._write_message(
                            {
                                "type": "cut_config",
                                "payload": self._pending_cut_config.model_dump(),
                            }
                        )
                    while self._running:
                        line = ser.readline().decode(errors="ignore").strip()
                        if not line:
                            await asyncio.sleep(0)
                            continue

                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        if not isinstance(data, dict):
                            continue
                        if data.get("type") == "cut_config_ack":
                            continue
                        if "detections" not in data and data.get("type") != "ai_frame":
                            continue
                        if data.get("type") == "ai_frame" and isinstance(data.get("payload"), dict):
                            data = data["payload"]
                        if "timestamp" not in data:
                            data["timestamp"] = time.time()

                        frame = AiFrame.model_validate(data)
                        if self._on_frame is not None:
                            result = self._on_frame(frame)
                            if asyncio.iscoroutine(result):
                                await result
                        await self._hub.broadcast_to_ui(frame.model_dump_json())
            except Exception:
                self._serial = None
                await asyncio.sleep(2)
            finally:
                self._serial = None

    async def _write_message(self, payload: dict) -> bool:
        async with self._write_lock:
            if self._serial is None:
                return False

            try:
                self._serial.write((json.dumps(payload, ensure_ascii=True) + "\n").encode())
                self._serial.flush()
                return True
            except Exception:
                self._serial = None
                return False
