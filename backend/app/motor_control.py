from __future__ import annotations

from asyncio import Lock
from .models import MotorStatus


class MotorController:
    """
    Stub motor controller.
    Replace internals with GPIO/relay calls on Raspberry Pi.
    """

    def __init__(self) -> None:
        self._status = MotorStatus()
        self._lock = Lock()

    async def status(self) -> MotorStatus:
        async with self._lock:
            return self._status.model_copy(deep=True)

    async def command(self, cmd: str) -> MotorStatus:
        async with self._lock:
            if cmd == "mode_manual":
                self._status.mode = "manual"
            elif cmd == "mode_auto":
                self._status.mode = "auto"
                self._status.feed_running = False
                self._status.cutter_down = False
            elif cmd == "feed_start":
                self._ensure_manual(cmd)
                self._status.feed_running = True
            elif cmd == "feed_stop":
                self._ensure_manual(cmd)
                self._status.feed_running = False
            elif cmd == "cutter_down":
                self._ensure_manual(cmd)
                self._status.cutter_down = True
            elif cmd == "cutter_up":
                self._ensure_manual(cmd)
                self._status.cutter_down = False
            elif cmd == "emergency_stop":
                self._status.feed_running = False
                self._status.cutter_down = False
            else:
                raise ValueError(f"Unsupported motor command: {cmd}")

            self._status.last_action = cmd
            return self._status.model_copy(deep=True)

    def _ensure_manual(self, cmd: str) -> None:
        if self._status.mode != "manual":
            raise ValueError(f"Command requires manual mode: {cmd}")
