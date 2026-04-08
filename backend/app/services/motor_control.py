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

from ..cutter_axis import CutterAxisStore
from ..dkc_cutter import DkcProgramCutter
from ..dkc_y3x0_cutter import DkcY3x0Cutter
from ..gpio_outputs import LightController
from ..models import AiFrame, CutterAxisState, CutterAxisUpdate, EventItem
from ..stepper_cutter import StepperCutter

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
    cutter_available: bool = False
    cutter_jog_supported: bool = False
    cutter_driver: str = "unavailable"
    cutter_error: str | None = None
    cutter_position_known: bool = False
    cutter_position_mm: float = 0.0
    cutter_stroke_mm: float | None = None
    cutter_motion_active: bool = False
    cutter_motion_direction: str | None = None
    cutter_stop_supported: bool = False
    cutter_stop_requested: bool = False
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
        self._cutter_motion_task: asyncio.Task | None = None
        self._uart_cut_request_active = False
        self._gpio_cut_request_active = False
        self._prefer_gpio_cut_request = False
        self._light = LightController()
        self._cutter_axis = CutterAxisStore(path=os.getenv("CUTTER_AXIS_PATH"))
        self._cutter = self._build_cutter_driver()
        self._cutter_status_refresh_s = max(0.2, float(os.getenv("CUTTER_STATUS_REFRESH_S", "1.0")))
        self._last_cutter_status_refresh_ts = 0.0
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
        self._sync_cutter_status_locked()
        self._status.cutter_stop_supported = self._cutter_supports_stop()

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
        if not self._cutter.available:
            self._record_event("hardware", "warning", "cutter_unavailable", f"刀轴驱动不可用: {self._cutter.error or 'unknown'}")

        self._record_event("system", "info", "init", "控制器初始化完成")
        logger.info("motor controller initialized status=%s", self._status_snapshot())

    async def status(self) -> dict[str, object]:
        async with self._lock:
            await self._refresh_cutter_live_state_locked()
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
        if cmd == "cutter_down":
            logger.info("motor command received cmd=%s value=%s", cmd, value)
            return await self._start_cutter_motion(True)
        if cmd == "cutter_up":
            logger.info("motor command received cmd=%s value=%s", cmd, value)
            return await self._start_cutter_motion(False)
        if cmd == "cutter_stop":
            logger.info("motor command received cmd=%s value=%s", cmd, value)
            return await self._stop_cutter_motion()

        async with self._lock:
            logger.info("motor command received cmd=%s value=%s", cmd, value)
            if cmd == "mode_manual":
                await self._cancel_auto_task_locked()
                await self._cancel_cutter_motion_locked()
                self._clear_fault_locked()
                self._status.mode = "manual"
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cutter_motion_active = False
                self._status.cutter_motion_direction = None
                self._status.cutter_stop_requested = False
                self._status.cut_request_active = False
                self._status.auto_state = "manual_ready"
            elif cmd == "mode_auto":
                await self._cancel_auto_task_locked()
                await self._cancel_cutter_motion_locked()
                self._clear_fault_locked()
                self._status.mode = "auto"
                self._status.feed_running = True
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cutter_motion_active = False
                self._status.cutter_motion_direction = None
                self._status.cutter_stop_requested = False
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
                await self._cancel_cutter_motion_locked()
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cutter_motion_active = False
                self._status.cutter_motion_direction = None
                self._status.cutter_stop_requested = False
                self._status.cut_request_active = False
                self._status.auto_state = "emergency_stop"
                self._set_fault_locked("emergency_stop", "设备已进入急停状态")
            elif cmd == "fault_reset":
                await self._cancel_auto_task_locked()
                await self._cancel_cutter_motion_locked()
                self._status.feed_running = False
                self._status.clamp_engaged = False
                self._status.cutter_down = False
                self._status.cutter_motion_active = False
                self._status.cutter_motion_direction = None
                self._status.cutter_stop_requested = False
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

    async def cutter_axis_state(self) -> CutterAxisState:
        async with self._lock:
            await self._refresh_cutter_live_state_locked()
            return self._current_cutter_axis_state_locked()

    async def set_cutter_axis_zero_here(self) -> CutterAxisState:
        async with self._lock:
            logger.info("cutter axis zero request mode=%s motion_active=%s", self._status.mode, self._status.cutter_motion_active)
            self._ensure_manual("cutter_set_zero")
            if self._cutter_supports_zeroing():
                position = await self._cutter.set_zero_position(0.0)
                state = self._cutter_axis.update(
                    CutterAxisUpdate(
                        position_known=True,
                        current_position_mm=0.0 if position is None else position,
                    )
                )
            else:
                state = self._cutter_axis.mark_zero_here()
            self._apply_cutter_axis_state_locked(state)
            self._status.last_action = "cutter_set_zero"
            self._record_event_locked("control", "info", "cutter_set_zero", "刀轴当前位置已设为零点")
            return self._current_cutter_axis_state_locked()

    async def update_cutter_axis(self, patch: CutterAxisUpdate) -> CutterAxisState:
        async with self._lock:
            logger.info(
                "cutter axis update request stroke_mm=%s position_known=%s current_position_mm=%s",
                patch.stroke_mm,
                patch.position_known,
                patch.current_position_mm,
            )
            state = self._cutter_axis.update(patch)
            self._apply_cutter_axis_state_locked(state)
            await self._refresh_cutter_live_state_locked(force=True)
            self._record_event_locked("control", "info", "cutter_axis_update", "刀轴行程参数已更新")
            return self._current_cutter_axis_state_locked()

    async def set_cut_request_gpio_enabled(self, enabled: bool) -> None:
        async with self._lock:
            self._prefer_gpio_cut_request = enabled
            self._status.cut_request_active = self._combined_cut_request_active_locked()

    async def process_cut_request_gpio(self, active: bool) -> None:
        start_cycle = False
        async with self._lock:
            previous = self._gpio_cut_request_active
            self._gpio_cut_request_active = active
            self._status.cut_request_active = self._combined_cut_request_active_locked()
            if self._prefer_gpio_cut_request and self._status.mode == "auto" and not self._status.fault_active:
                if self._status.auto_state in ("auto_armed", "manual_ready"):
                    self._status.auto_state = "feeding"
                if (
                    active
                    and not previous
                    and self._auto_task is None
                    and self._status.auto_state in ("feeding", "waiting_cut_signal", "auto_armed")
                ):
                    self._status.last_action = "cut_request_received"
                    self._status.auto_state = "position_reached"
                    self._record_event_locked("runtime", "info", "cut_request_gpio", "收到 GPIO 切割触发信号")
                    start_cycle = True
                elif not active and self._auto_task is None and self._status.feed_running:
                    self._status.auto_state = "feeding"

        if start_cycle:
            logger.info("auto cycle triggered by gpio cut request")
            self._auto_task = asyncio.create_task(self._run_auto_cycle())

    async def process_ai_frame(self, frame: AiFrame) -> None:
        start_cycle = False
        async with self._lock:
            self._uart_cut_request_active = bool(frame.cut_request)
            self._status.cut_request_active = self._combined_cut_request_active_locked()
            if not self._prefer_gpio_cut_request and self._status.mode == "auto" and not self._status.fault_active:
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
        await self._apply_auto_state(auto_state="cutting", last_action="cutter_down_auto")
        await self._run_cutter_move(True)
        await self._sleep_ms(self._cut_hold_ms)
        await self._apply_auto_state(auto_state="blade_return", last_action="cutter_up_auto")
        await self._run_cutter_move(False)

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
            await self._cancel_cutter_motion_locked()
            self._status.feed_running = False
            self._status.clamp_engaged = False
            self._status.cutter_down = False
            self._status.cutter_motion_active = False
            self._status.cutter_motion_direction = None
            self._status.cutter_stop_requested = False
            self._status.cut_request_active = False
            self._status.light_on = self._light.reset()
            self._status.light_active_leds = 0
            self._sync_light_status_locked()
            self._light.close()
            self._cutter.close()
            self._record_event_locked("system", "info", "shutdown", "控制器已安全停机")
            logger.info("motor controller shutdown complete status=%s", self._status_snapshot())

    async def _start_cutter_motion(self, down: bool) -> dict[str, object]:
        direction = "down" if down else "up"
        async with self._lock:
            self._ensure_manual(f"cutter_{direction}")
            if not self._cutter.available:
                raise ValueError(f"刀轴驱动不可用: {self._cutter.error or 'unknown'}")
            if self._cutter_motion_task is not None and not self._cutter_motion_task.done():
                active_direction = self._status.cutter_motion_direction or "unknown"
                raise ValueError(f"刀轴正在{self._describe_cutter_direction(active_direction)}，请先停止当前动作")

            self._status.cutter_motion_active = True
            self._status.cutter_motion_direction = direction
            self._status.cutter_stop_requested = False
            self._status.last_action = f"cutter_{direction}_start"
            self._record_event_locked("control", "info", self._status.last_action, f"刀轴开始{self._describe_cutter_direction(direction)}")
            self._cutter_motion_task = asyncio.create_task(self._run_manual_cutter_motion(down))
            snapshot = self._status_snapshot()

        logger.info("manual cutter motion started direction=%s", direction)
        return snapshot

    async def _stop_cutter_motion(self) -> dict[str, object]:
        async with self._lock:
            if self._status.mode != "manual":
                raise ValueError("刀轴停止仅允许在手动模式下执行")
            task = self._cutter_motion_task
            if task is None or task.done():
                raise ValueError("当前没有正在执行的刀轴动作")
            if not self._cutter_supports_stop():
                raise ValueError("当前刀轴驱动不支持中途中止，请配置停止位后再使用")

            self._status.cutter_stop_requested = True
            self._status.last_action = "cutter_stop_requested"
            self._record_event_locked("control", "warning", "cutter_stop_requested", "已请求停止当前刀轴动作")
            snapshot = self._status_snapshot()

        await self._cutter.stop_motion()
        logger.info("manual cutter stop requested")
        return snapshot

    async def _run_manual_cutter_motion(self, down: bool) -> None:
        direction = "down" if down else "up"
        completed = False
        error: Exception | None = None
        position_mm: float | None = None
        interrupted = False
        current_task = asyncio.current_task()

        try:
            position_mm, interrupted = await self._execute_cutter_move(down)
            completed = True
        except asyncio.CancelledError:
            logger.info("manual cutter motion cancelled direction=%s", direction)
            raise
        except Exception as exc:
            error = exc
            logger.warning("manual cutter motion failed direction=%s detail=%s", direction, exc)

        async with self._lock:
            if self._cutter_motion_task is current_task:
                self._cutter_motion_task = None

            self._status.cutter_motion_active = False
            self._status.cutter_motion_direction = None
            stop_requested = self._status.cutter_stop_requested
            self._status.cutter_stop_requested = False
            self._last_cutter_status_refresh_ts = 0.0

            if error is not None:
                if stop_requested:
                    self._status.last_action = "cutter_stop_completed"
                    self._record_event_locked("control", "warning", "cutter_stop_completed", "刀轴动作已被停止")
                else:
                    self._set_fault_locked("cutter_motion_failed", f"刀轴运动失败: {error}")
                    self._status.cutter_down = False
                    self._status.last_action = "cutter_motion_failed"
            elif completed:
                if position_mm is None:
                    if not interrupted:
                        self._apply_cutter_axis_state_locked(self._cutter_axis.apply_motion(down=down))
                else:
                    self._apply_cutter_axis_state_locked(
                        self._cutter_axis.update(
                            CutterAxisUpdate(
                                position_known=True,
                                current_position_mm=position_mm,
                            )
                        )
                    )

                self._status.cutter_down = down if not interrupted else self._status.cutter_down
                if interrupted or stop_requested:
                    self._status.last_action = "cutter_stop_completed"
                    self._record_event_locked(
                        "control",
                        "warning",
                        "cutter_stop_completed",
                        f"刀轴{self._describe_cutter_direction(direction)}已中止",
                    )
                else:
                    self._status.cutter_down = down
                    self._status.last_action = f"cutter_{direction}_complete"
                    self._record_event_locked(
                        "control",
                        "info",
                        self._status.last_action,
                        f"刀轴{self._describe_cutter_direction(direction)}完成",
                    )

            logger.info("manual cutter motion ended direction=%s status=%s", direction, self._status_snapshot())

    async def _execute_cutter_move(self, down: bool) -> tuple[float | None, bool]:
        if self._cutter_supports_programmed_moves():
            target_position, _ = await self._prepare_programmed_cutter_move(down)
            if down:
                result = await self._cutter.move_down_to(target_position)
            else:
                result = await self._cutter.move_up_to(target_position)
            actual_position = target_position if result is None else result
            interrupted = abs(actual_position - target_position) > 0.05
            return actual_position, interrupted

        if down:
            result = await self._cutter.move_down()
        else:
            result = await self._cutter.move_up()

        expected_steps = getattr(self._cutter, "down_steps" if down else "up_steps", None)
        interrupted = isinstance(result, int) and expected_steps is not None and result < expected_steps
        return None, interrupted

    async def _prepare_programmed_cutter_move(
        self,
        down: bool,
        *,
        distance_mm: float | None = None,
        require_known_position: bool = True,
    ) -> tuple[float, float]:
        async with self._lock:
            state = self._cutter_axis.get()
            if require_known_position and not state.position_known:
                raise ValueError("请先在刀轴标定中将当前位置设为零点")

            resolved_distance = distance_mm if distance_mm is not None else state.stroke_mm
            if resolved_distance is None:
                raise ValueError("请先保存刀轴行程")

            fallback_position = state.current_position_mm

        base_position = await self._cutter.read_position_mm()
        if base_position is None:
            base_position = fallback_position

        target_position = round(base_position + resolved_distance, 4) if down else round(base_position - resolved_distance, 4)
        return target_position, base_position

    async def _cancel_cutter_motion_locked(self) -> None:
        task = self._cutter_motion_task
        self._cutter_motion_task = None
        if task is not None:
            if self._cutter_supports_stop():
                with contextlib.suppress(Exception):
                    await self._cutter.stop_motion()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    @staticmethod
    def _describe_cutter_direction(direction: str) -> str:
        if direction == "down":
            return "下压"
        if direction == "up":
            return "抬起"
        return direction

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

    def _sync_cutter_status_locked(self) -> None:
        self._status.cutter_available = self._cutter.available
        self._status.cutter_jog_supported = self._cutter_supports_jog()
        self._status.cutter_driver = getattr(self._cutter, "driver_name", "unknown")
        self._status.cutter_error = self._cutter.error
        self._status.cutter_stop_supported = self._cutter_supports_stop()
        self._apply_cutter_axis_state_locked(self._cutter_axis.get())

    def _apply_cutter_axis_state_locked(self, state: CutterAxisState) -> None:
        self._status.cutter_position_known = state.position_known
        self._status.cutter_position_mm = state.current_position_mm
        self._status.cutter_stroke_mm = state.stroke_mm

    def _current_cutter_axis_state_locked(self) -> CutterAxisState:
        return CutterAxisState(
            position_known=self._status.cutter_position_known,
            current_position_mm=self._status.cutter_position_mm,
            stroke_mm=self._status.cutter_stroke_mm,
            available=self._status.cutter_available,
            jog_supported=self._status.cutter_jog_supported,
            driver=self._status.cutter_driver,
            error=self._status.cutter_error,
        )

    async def _run_cutter_move_locked(self, down: bool) -> None:
        if not self._cutter.available:
            raise ValueError(f"刀轴驱动不可用: {self._cutter.error or 'unknown'}")
        try:
            if self._cutter_supports_programmed_moves():
                position = await self._run_programmed_cutter_move_locked(down)
            else:
                if down:
                    await self._cutter.move_down()
                else:
                    await self._cutter.move_up()
                position = None
        except Exception as exc:
            self._set_fault_locked("cutter_motion_failed", f"刀轴运动失败: {exc}")
            self._status.cutter_down = False
            raise ValueError(f"刀轴运动失败: {exc}") from exc

        self._status.cutter_down = down
        self._last_cutter_status_refresh_ts = 0.0
        if position is None:
            self._apply_cutter_axis_state_locked(self._cutter_axis.apply_motion(down=down))
        else:
            self._apply_cutter_axis_state_locked(
                self._cutter_axis.update(
                    CutterAxisUpdate(
                        position_known=True,
                        current_position_mm=position,
                    )
                )
            )

    async def _run_cutter_move(self, down: bool) -> None:
        async with self._lock:
            await self._run_cutter_move_locked(down)

    def _build_cutter_driver(self):
        if os.getenv("DKC_SERIAL_PORT"):
            return DkcY3x0Cutter()
        if os.getenv("CUTTER_TRIGGER_UP_PIN") or os.getenv("DKC_TRIGGER_UP_PIN"):
            return DkcProgramCutter()
        return StepperCutter()

    def _cutter_supports_programmed_moves(self) -> bool:
        return hasattr(self._cutter, "move_down_to") and hasattr(self._cutter, "move_up_to") and hasattr(self._cutter, "read_position_mm")

    def _cutter_supports_zeroing(self) -> bool:
        return hasattr(self._cutter, "set_zero_position")

    def _cutter_supports_fault_status(self) -> bool:
        return hasattr(self._cutter, "read_fault_active")

    def _cutter_supports_stop(self) -> bool:
        return hasattr(self._cutter, "stop_motion")

    def _cutter_supports_jog(self) -> bool:
        return hasattr(self._cutter, "jog_relative_mm") or self._cutter_supports_programmed_moves()

    async def jog_cutter_axis(self, *, direction: str, distance_mm: float) -> CutterAxisState:
        direction_normalized = direction.strip().lower()
        if direction_normalized not in {"forward", "reverse", "down", "up"}:
            raise ValueError(f"Unsupported cutter jog direction: {direction}")

        down = direction_normalized in {"forward", "down"}
        logger.info("cutter axis jog request direction=%s distance_mm=%s", direction_normalized, distance_mm)

        async with self._lock:
            self._ensure_manual("cutter_jog")
            if not self._cutter.available:
                raise ValueError(f"刀轴驱动不可用: {self._cutter.error or 'unknown'}")
            if self._cutter_motion_task is not None and not self._cutter_motion_task.done():
                raise ValueError("刀轴正在运动中，请先等待当前动作结束或停止当前动作")
            if not self._cutter_supports_jog():
                raise ValueError("当前刀轴驱动不支持临时调整")

        position = await self._execute_cutter_jog(down=down, distance_mm=distance_mm)

        async with self._lock:
            self._status.cutter_down = down
            self._status.last_action = "cutter_jog_down" if down else "cutter_jog_up"
            self._last_cutter_status_refresh_ts = 0.0
            self._apply_cutter_axis_state_locked(
                self._cutter_axis.update(
                    CutterAxisUpdate(
                        current_position_mm=position if position is not None else self._status.cutter_position_mm,
                    )
                )
            )
            self._record_event_locked(
                "control",
                "info",
                self._status.last_action,
                f"刀轴临时调整 {self._describe_cutter_direction('down' if down else 'up')} {distance_mm:.3f} mm",
            )
            return self._current_cutter_axis_state_locked()

    async def _execute_cutter_jog(self, *, down: bool, distance_mm: float) -> float | None:
        if hasattr(self._cutter, "jog_relative_mm"):
            result = await self._cutter.jog_relative_mm(distance_mm if down else -distance_mm)
            return None if result is None else float(result)

        target_position, _ = await self._prepare_programmed_cutter_move(down, distance_mm=distance_mm, require_known_position=False)
        if down:
            result = await self._cutter.move_down_to(target_position)
        else:
            result = await self._cutter.move_up_to(target_position)
        return target_position if result is None else result

    async def _run_programmed_cutter_move_locked(self, down: bool) -> float:
        state = self._cutter_axis.get()
        if not state.position_known:
            raise ValueError("请先在刀轴标定中将当前位置设为零点")

        distance_mm = state.stroke_mm
        if distance_mm is None:
            raise ValueError("请先保存刀轴行程")

        base_position = await self._cutter.read_position_mm()
        if base_position is None:
            base_position = state.current_position_mm

        target_position = round(base_position + distance_mm, 4) if down else round(max(0.0, base_position - distance_mm), 4)
        if down:
            result = await self._cutter.move_down_to(target_position)
        else:
            result = await self._cutter.move_up_to(target_position)
        return target_position if result is None else result

    async def _refresh_cutter_live_state_locked(self, *, force: bool = False) -> None:
        if not self._cutter.available:
            return

        now = time.time()
        if not force and now - self._last_cutter_status_refresh_ts < self._cutter_status_refresh_s:
            return
        self._last_cutter_status_refresh_ts = now

        position_mm: float | None = None
        fault_active: bool | None = None
        refresh_failed = False

        if hasattr(self._cutter, "read_position_mm"):
            try:
                position_mm = await self._cutter.read_position_mm()
            except Exception as exc:
                refresh_failed = True
                self._status.cutter_error = str(exc)
                logger.warning("failed to refresh cutter position: %s", exc)

        if self._cutter_supports_fault_status():
            try:
                fault_active = await self._cutter.read_fault_active()
            except Exception as exc:
                refresh_failed = True
                self._status.cutter_error = str(exc)
                logger.warning("failed to refresh cutter fault bit: %s", exc)

        if not refresh_failed:
            self._status.cutter_error = self._cutter.error

        if position_mm is not None:
            if self._status.cutter_position_known:
                self._status.cutter_position_mm = position_mm
            else:
                # Keep the raw feedback available for diagnostics even before zeroing.
                self._status.cutter_position_mm = position_mm

        if fault_active is True and self._status.fault_code != "cutter_controller_fault":
            self._set_fault_locked("cutter_controller_fault", "DKC 控制器报告刀轴故障")
        elif fault_active is False and self._status.fault_code == "cutter_controller_fault":
            self._clear_fault_locked()

    def _combined_cut_request_active_locked(self) -> bool:
        if self._prefer_gpio_cut_request:
            return self._gpio_cut_request_active
        return self._gpio_cut_request_active or self._uart_cut_request_active

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
