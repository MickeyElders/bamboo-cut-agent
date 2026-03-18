from __future__ import annotations

import asyncio
import contextlib
import os

from .gpio_outputs import LightController
from .models import AiFrame, MotorStatus


class MotorController:
    """
    Backend-side machine controller.
    CanMV only reports detection and cut_request. The full execution sequence
    runs on the Raspberry Pi.
    """

    def __init__(self) -> None:
        self._status = MotorStatus()
        self._lock = asyncio.Lock()
        self._auto_task: asyncio.Task | None = None
        self._light = LightController()
        self._status.light_on = self._light.is_on
        self._clamp_ms = int(os.getenv("CLAMP_MS", "250"))
        self._cut_down_ms = int(os.getenv("CUT_DOWN_MS", "400"))
        self._cut_hold_ms = int(os.getenv("CUT_HOLD_MS", "150"))
        self._cut_up_ms = int(os.getenv("CUT_UP_MS", "300"))
        self._release_ms = int(os.getenv("CLAMP_RELEASE_MS", "200"))
        self._resume_delay_ms = int(os.getenv("FEED_RESUME_DELAY_MS", "120"))

    async def status(self) -> MotorStatus:
        async with self._lock:
            return self._status.model_copy(deep=True)

    async def command(self, cmd: str) -> MotorStatus:
        async with self._lock:
            if cmd == "mode_manual":
                await self._cancel_auto_task_locked()
                self._status.mode = "manual"
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cut_request_active = False
                self._status.auto_state = "manual_ready"
            elif cmd == "mode_auto":
                await self._cancel_auto_task_locked()
                self._status.mode = "auto"
                self._status.feed_running = True
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cut_request_active = False
                self._status.auto_state = "feeding"
            elif cmd == "feed_start":
                self._ensure_manual(cmd)
                self._status.feed_running = True
            elif cmd == "feed_stop":
                self._ensure_manual(cmd)
                self._status.feed_running = False
            elif cmd == "clamp_engage":
                self._ensure_manual(cmd)
                self._status.clamp_engaged = True
            elif cmd == "clamp_release":
                self._ensure_manual(cmd)
                self._status.clamp_engaged = False
            elif cmd == "cutter_down":
                self._ensure_manual(cmd)
                self._status.cutter_down = True
            elif cmd == "cutter_up":
                self._ensure_manual(cmd)
                self._status.cutter_down = False
            elif cmd == "light_on":
                self._status.light_on = self._light.set_on(True)
            elif cmd == "light_off":
                self._status.light_on = self._light.set_on(False)
            elif cmd == "emergency_stop":
                await self._cancel_auto_task_locked()
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cut_request_active = False
                self._status.auto_state = "emergency_stop"
            else:
                raise ValueError(f"Unsupported motor command: {cmd}")

            self._status.last_action = cmd
            return self._status.model_copy(deep=True)

    async def process_ai_frame(self, frame: AiFrame) -> None:
        start_cycle = False
        async with self._lock:
            self._status.cut_request_active = bool(frame.cut_request)
            if self._status.mode == "auto":
                if self._status.auto_state in ("auto_armed", "manual_ready"):
                    self._status.auto_state = "feeding"
                if (
                    frame.cut_request
                    and self._auto_task is None
                    and self._status.auto_state in ("feeding", "waiting_cut_signal", "auto_armed")
                ):
                    self._status.last_action = "cut_request_received"
                    self._status.auto_state = "position_reached"
                    start_cycle = True
                elif not frame.cut_request and self._auto_task is None and self._status.feed_running:
                    self._status.auto_state = "feeding"

        if start_cycle:
            self._auto_task = asyncio.create_task(self._run_auto_cycle())

    async def _run_auto_cycle(self) -> None:
        try:
            await self._apply_auto_state(feed_running=False, auto_state="position_reached", last_action="feed_stop_auto")
            await self._sleep_ms(self._resume_delay_ms)

            await self._apply_auto_state(clamp_engaged=True, auto_state="clamping", last_action="clamp_engage_auto")
            await self._sleep_ms(self._clamp_ms)

            await self._apply_auto_state(cutter_down=True, auto_state="cutting", last_action="cutter_down_auto")
            await self._sleep_ms(self._cut_down_ms)

            await self._sleep_ms(self._cut_hold_ms)

            await self._apply_auto_state(cutter_down=False, auto_state="blade_return", last_action="cutter_up_auto")
            await self._sleep_ms(self._cut_up_ms)

            await self._apply_auto_state(clamp_engaged=False, auto_state="release", last_action="clamp_release_auto")
            await self._sleep_ms(self._release_ms)

            async with self._lock:
                if self._status.mode == "auto":
                    self._status.feed_running = True
                    self._status.cut_request_active = False
                    self._status.auto_state = "feeding"
                    self._status.cycle_count += 1
                    self._status.last_action = "cycle_complete"
        except asyncio.CancelledError:
            raise
        finally:
            async with self._lock:
                self._auto_task = None

    async def _apply_auto_state(
        self,
        *,
        feed_running: bool | None = None,
        clamp_engaged: bool | None = None,
        cutter_down: bool | None = None,
        auto_state: str | None = None,
        last_action: str | None = None,
    ) -> None:
        async with self._lock:
            if self._status.mode != "auto":
                return
            if feed_running is not None:
                self._status.feed_running = feed_running
            if clamp_engaged is not None:
                self._status.clamp_engaged = clamp_engaged
            if cutter_down is not None:
                self._status.cutter_down = cutter_down
            if auto_state is not None:
                self._status.auto_state = auto_state
            if last_action is not None:
                self._status.last_action = last_action

    async def _cancel_auto_task_locked(self) -> None:
        task = self._auto_task
        self._auto_task = None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _sleep_ms(self, value: int) -> None:
        if value <= 0:
            return
        await asyncio.sleep(value / 1000.0)

    async def shutdown(self) -> None:
        async with self._lock:
            await self._cancel_auto_task_locked()
            self._status.light_on = self._light.set_on(False)
            self._light.close()

    def _ensure_manual(self, cmd: str) -> None:
        if self._status.mode != "manual":
            raise ValueError(f"Command requires manual mode: {cmd}")
