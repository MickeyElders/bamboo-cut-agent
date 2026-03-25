from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from collections import deque
from dataclasses import asdict, dataclass
from pathlib import Path

from ..gpio_outputs import LightController
from ..models import AiFrame, EventItem

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _MotorStatus:
    mode: str = "manual"
    feed_running: bool = False
    clamp_engaged: bool = False
    cutter_down: bool = False
    light_on: bool = False
    light_available: bool = False
    light_driver: str = "noop"
    light_error: str | None = None
    light_pin: int | None = None
    light_led_count: int = 16
    light_active_leds: int = 0
    light_brightness: int = 255
    light_red: int = 255
    light_green: int = 255
    light_blue: int = 255
    cut_request_active: bool = False
    auto_state: str = "manual_ready"
    cycle_count: int = 0
    last_action: str = "init"
    fault_active: bool = False
    fault_code: str | None = None
    fault_detail: str | None = None


class MotorController:
    """
    Backend-side machine controller.
    CanMV only reports detection and cut_request. The full execution sequence
    runs on the Raspberry Pi.
    """

    def __init__(self) -> None:
        self._status = _MotorStatus()
        self._lock = asyncio.Lock()
        self._auto_task: asyncio.Task | None = None
        self._light = LightController()
        self._events: deque[EventItem] = deque(maxlen=int(os.getenv("RUNTIME_EVENT_LIMIT", "20")))
        self._event_log_path = Path(os.getenv("RUNTIME_EVENT_LOG_PATH", Path(__file__).resolve().parents[2] / "data" / "runtime_events.jsonl"))
        self._event_log_path.parent.mkdir(parents=True, exist_ok=True)
        self._event_log_max_bytes = int(os.getenv("RUNTIME_EVENT_LOG_MAX_BYTES", str(512 * 1024)))
        self._event_log_backup_count = int(os.getenv("RUNTIME_EVENT_LOG_BACKUP_COUNT", "3"))

        self._status.light_on = self._light.reset()
        self._status.light_available = self._light.available
        self._status.light_driver = self._light.driver_name
        self._status.light_error = self._light.error
        self._status.light_pin = self._light.pin
        self._status.light_led_count = self._light.led_count
        self._status.light_active_leds = 0
        self._status.light_brightness = self._light.brightness
        self._status.light_red = self._light.red
        self._status.light_green = self._light.green
        self._status.light_blue = self._light.blue

        self._clamp_ms = int(os.getenv("CLAMP_MS", "250"))
        self._cut_down_ms = int(os.getenv("CUT_DOWN_MS", "400"))
        self._cut_hold_ms = int(os.getenv("CUT_HOLD_MS", "150"))
        self._cut_up_ms = int(os.getenv("CUT_UP_MS", "300"))
        self._release_ms = int(os.getenv("CLAMP_RELEASE_MS", "200"))
        self._resume_delay_ms = int(os.getenv("FEED_RESUME_DELAY_MS", "120"))

        self._position_timeout_ms = int(os.getenv("AUTO_POSITION_TIMEOUT_MS", "1500"))
        self._clamp_timeout_ms = int(os.getenv("AUTO_CLAMP_TIMEOUT_MS", "1500"))
        self._cut_timeout_ms = int(os.getenv("AUTO_CUT_TIMEOUT_MS", "2000"))
        self._release_timeout_ms = int(os.getenv("AUTO_RELEASE_TIMEOUT_MS", "1500"))

        if not self._light.available:
            self._record_event("hardware", "warning", "light_unavailable", f"灯光驱动不可用: {self._light.error or 'unknown'}")

        self._record_event("system", "info", "init", "控制器初始化完成")
        logger.info("motor controller initialized status=%s", self._status_snapshot())

    async def status(self) -> dict[str, object]:
        async with self._lock:
            return self._status_snapshot()

    async def recent_events(self) -> list[EventItem]:
        async with self._lock:
            return list(self._events)

    async def event_history(
        self,
        limit: int = 100,
        *,
        category: str | None = None,
        level: str | None = None,
        since: float | None = None,
    ) -> list[EventItem]:
        async with self._lock:
            return self._read_event_history_locked(limit, category=category, level=level, since=since)

    async def command(self, cmd: str, value: int | None = None) -> dict[str, object]:
        async with self._lock:
            logger.info("motor command received cmd=%s value=%s", cmd, value)
            if cmd == "mode_manual":
                await self._cancel_auto_task_locked()
                self._clear_fault_locked()
                self._status.mode = "manual"
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cut_request_active = False
                self._status.auto_state = "manual_ready"
            elif cmd == "mode_auto":
                await self._cancel_auto_task_locked()
                self._clear_fault_locked()
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
                self._status.light_active_leds = self._light.led_count
            elif cmd == "light_off":
                self._status.light_on = self._light.set_on(False)
                self._status.light_active_leds = 0
            elif cmd == "light_set_count":
                if value is None:
                    raise ValueError("Command requires value: light_set_count")
                self._status.light_active_leds = self._light.write_count(value)
                self._status.light_on = self._status.light_active_leds > 0
            elif cmd == "emergency_stop":
                await self._cancel_auto_task_locked()
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cut_request_active = False
                self._status.auto_state = "emergency_stop"
                self._set_fault_locked("emergency_stop", "设备已进入急停状态")
            elif cmd == "fault_reset":
                await self._cancel_auto_task_locked()
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cut_request_active = False
                self._status.auto_state = "manual_ready" if self._status.mode == "manual" else "feeding"
                self._clear_fault_locked()
            else:
                raise ValueError(f"Unsupported motor command: {cmd}")

            self._status.last_action = cmd
            self._sync_light_status_locked()
            self._record_event_locked("control", "info", cmd, f"执行控制命令: {cmd}")
            logger.info("motor command applied cmd=%s status=%s", cmd, self._status_snapshot())
            return self._status_snapshot()

    async def configure_light(self, *, active_leds: int, brightness: int, red: int, green: int, blue: int) -> dict[str, object]:
        async with self._lock:
            self._status.light_active_leds = self._light.configure(active_leds, brightness, red, green, blue)
            self._status.light_on = self._status.light_active_leds > 0
            self._sync_light_status_locked()
            self._status.last_action = "light_config"
            self._record_event_locked(
                "control",
                "info",
                "light_config",
                f"灯光已更新: {self._status.light_active_leds}/{self._status.light_led_count} 颗",
            )
            logger.info("motor light configured status=%s", self._status_snapshot())
            return self._status_snapshot()

    async def process_ai_frame(self, frame: AiFrame) -> None:
        start_cycle = False
        async with self._lock:
            self._status.cut_request_active = bool(frame.cut_request)
            if self._status.mode == "auto" and not self._status.fault_active:
                if self._status.auto_state in ("auto_armed", "manual_ready"):
                    self._status.auto_state = "feeding"
                if (
                    frame.cut_request
                    and self._auto_task is None
                    and self._status.auto_state in ("feeding", "waiting_cut_signal", "auto_armed")
                ):
                    self._status.last_action = "cut_request_received"
                    self._status.auto_state = "position_reached"
                    self._record_event_locked("runtime", "info", "cut_request_received", "收到切割触发信号")
                    start_cycle = True
                elif not frame.cut_request and self._auto_task is None and self._status.feed_running:
                    self._status.auto_state = "feeding"

        if start_cycle:
            logger.info("auto cycle triggered by ai frame")
            self._auto_task = asyncio.create_task(self._run_auto_cycle())

    async def _run_auto_cycle(self) -> None:
        try:
            logger.info("auto cycle start")
            await self._run_stage(
                "position_reached",
                "auto_position_timeout",
                "等待切割位完成超时",
                self._position_timeout_ms,
                self._stage_position_reached,
            )
            await self._run_stage(
                "clamping",
                "auto_clamp_timeout",
                "压紧阶段超时",
                self._clamp_timeout_ms,
                self._stage_clamping,
            )
            await self._run_stage(
                "cutting",
                "auto_cut_timeout",
                "切割阶段超时",
                self._cut_timeout_ms,
                self._stage_cutting,
            )
            await self._run_stage(
                "release",
                "auto_release_timeout",
                "释放阶段超时",
                self._release_timeout_ms,
                self._stage_release,
            )

            async with self._lock:
                if self._status.mode == "auto" and not self._status.fault_active:
                    self._status.feed_running = True
                    self._status.cut_request_active = False
                    self._status.auto_state = "feeding"
                    self._status.cycle_count += 1
                    self._status.last_action = "cycle_complete"
                    self._record_event_locked("runtime", "info", "cycle_complete", "自动切割循环完成")
                    logger.info("auto cycle complete status=%s", self._status_snapshot())
        except asyncio.CancelledError:
            logger.info("auto cycle cancelled")
            raise
        except Exception:
            logger.exception("auto cycle failed")
        finally:
            async with self._lock:
                self._auto_task = None

    async def _stage_position_reached(self) -> None:
        await self._apply_auto_state(feed_running=False, auto_state="position_reached", last_action="feed_stop_auto")
        await self._sleep_ms(self._resume_delay_ms)

    async def _stage_clamping(self) -> None:
        await self._apply_auto_state(clamp_engaged=True, auto_state="clamping", last_action="clamp_engage_auto")
        await self._sleep_ms(self._clamp_ms)

    async def _stage_cutting(self) -> None:
        await self._apply_auto_state(cutter_down=True, auto_state="cutting", last_action="cutter_down_auto")
        await self._sleep_ms(self._cut_down_ms)
        await self._sleep_ms(self._cut_hold_ms)
        await self._apply_auto_state(cutter_down=False, auto_state="blade_return", last_action="cutter_up_auto")
        await self._sleep_ms(self._cut_up_ms)

    async def _stage_release(self) -> None:
        await self._apply_auto_state(clamp_engaged=False, auto_state="release", last_action="clamp_release_auto")
        await self._sleep_ms(self._release_ms)

    async def _run_stage(
        self,
        stage_name: str,
        fault_code: str,
        fault_detail: str,
        timeout_ms: int,
        action: asyncio.Future | asyncio.Task | object,
    ) -> None:
        async def _await_action() -> None:
            result = action() if callable(action) else action
            await result  # type: ignore[arg-type]

        try:
            await asyncio.wait_for(_await_action(), timeout=max(timeout_ms, 1) / 1000.0)
        except asyncio.TimeoutError:
            async with self._lock:
                self._set_fault_locked(fault_code, fault_detail)
                self._status.auto_state = stage_name
                self._status.last_action = fault_code
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
            raise

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
            if self._status.mode != "auto" or self._status.fault_active:
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
                self._record_event_locked("runtime", "info", last_action, f"自动流程进入阶段: {auto_state or last_action}")

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
            logger.info("motor controller shutdown begin")
            await self._cancel_auto_task_locked()
            self._status.feed_running = False
            self._status.clamp_engaged = False
            self._status.cutter_down = False
            self._status.cut_request_active = False
            self._status.light_on = self._light.reset()
            self._status.light_active_leds = 0
            self._sync_light_status_locked()
            self._light.close()
            self._record_event_locked("system", "info", "shutdown", "控制器已安全停机")
            logger.info("motor controller shutdown complete status=%s", self._status_snapshot())

    def _ensure_manual(self, cmd: str) -> None:
        if self._status.mode != "manual":
            raise ValueError(f"Command requires manual mode: {cmd}")
        if self._status.fault_active:
            raise ValueError(f"Command blocked by active fault: {self._status.fault_code}")

    def _sync_light_status_locked(self) -> None:
        self._status.light_available = self._light.available
        self._status.light_driver = self._light.driver_name
        self._status.light_error = self._light.error
        self._status.light_pin = self._light.pin
        self._status.light_led_count = self._light.led_count
        self._status.light_brightness = self._light.brightness
        self._status.light_red = self._light.red
        self._status.light_green = self._light.green
        self._status.light_blue = self._light.blue

    def _set_fault_locked(self, code: str, detail: str) -> None:
        self._status.fault_active = True
        self._status.fault_code = code
        self._status.fault_detail = detail
        self._record_event_locked("fault", "error", code, detail)

    def _clear_fault_locked(self) -> None:
        if self._status.fault_active:
            self._record_event_locked("fault", "info", "fault_cleared", "故障已清除")
        self._status.fault_active = False
        self._status.fault_code = None
        self._status.fault_detail = None

    def _record_event(self, category: str, level: str, code: str, message: str) -> None:
        event = EventItem(timestamp=time.time(), category=category, level=level, code=code, message=message)
        self._events.appendleft(event)
        self._append_event_log(event)

    def _record_event_locked(self, category: str, level: str, code: str, message: str) -> None:
        self._record_event(category, level, code, message)

    def _append_event_log(self, event: EventItem) -> None:
        try:
            self._rotate_event_log_if_needed()
            with self._event_log_path.open("a", encoding="utf-8") as fp:
                fp.write(json.dumps(event.model_dump(), ensure_ascii=False) + "\n")
        except Exception:
            logger.exception("failed to append runtime event log")

    def _rotate_event_log_if_needed(self) -> None:
        try:
            if not self._event_log_path.exists():
                return
            if self._event_log_path.stat().st_size < self._event_log_max_bytes:
                return

            for index in range(self._event_log_backup_count, 0, -1):
                source = self._event_log_path.with_suffix(self._event_log_path.suffix + f".{index}")
                target = self._event_log_path.with_suffix(self._event_log_path.suffix + f".{index + 1}")
                if index == self._event_log_backup_count and source.exists():
                    source.unlink(missing_ok=True)
                elif source.exists():
                    source.replace(target)

            first_backup = self._event_log_path.with_suffix(self._event_log_path.suffix + ".1")
            self._event_log_path.replace(first_backup)
        except Exception:
            logger.exception("failed to rotate runtime event log")

    def _read_event_history_locked(
        self,
        limit: int,
        *,
        category: str | None = None,
        level: str | None = None,
        since: float | None = None,
    ) -> list[EventItem]:
        lines: list[str] = []
        try:
            if not self._event_log_path.exists():
                return self._filter_events(list(self._events), limit, category=category, level=level, since=since)
            with self._event_log_path.open("r", encoding="utf-8") as fp:
                lines = fp.readlines()[-max(limit, 1) :]
        except Exception:
            logger.exception("failed to read runtime event log")
            return self._filter_events(list(self._events), limit, category=category, level=level, since=since)

        events: list[EventItem] = []
        for line in reversed(lines):
            try:
                events.append(EventItem(**json.loads(line)))
            except Exception:
                logger.warning("skip malformed runtime event log line")
        return self._filter_events(events, limit, category=category, level=level, since=since)

    def _filter_events(
        self,
        events: list[EventItem],
        limit: int,
        *,
        category: str | None = None,
        level: str | None = None,
        since: float | None = None,
    ) -> list[EventItem]:
        result = events
        if category:
            result = [event for event in result if event.category == category]
        if level:
            result = [event for event in result if event.level == level]
        if since is not None:
            result = [event for event in result if event.timestamp >= since]
        return result[:limit]

    def _status_snapshot(self) -> dict[str, object]:
        snapshot = asdict(self._status)
        snapshot["recent_events"] = [event.model_dump() for event in self._events]
        return snapshot
