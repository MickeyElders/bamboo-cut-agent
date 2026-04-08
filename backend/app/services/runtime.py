from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import time
import uuid

from fastapi import HTTPException

from ..canmv_bridge import CanMvBridge
from ..cut_config import CutConfigStore
from ..gpio_inputs import InputMonitor
from ..models import (
    AiFrame,
    AlertItem,
    CommandAck,
    CutConfigUpdate,
    DeviceCapabilities,
    DeviceCapability,
    DeviceCommandDescriptor,
    DeviceCommandParameter,
    DeviceCommandRequest,
    DeviceIdentity,
    EventItem,
    InputSignal,
    JobStatus,
    StartupCheck,
    SystemStatus,
)
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
        self.inputs = InputMonitor()
        self.cut_config_store = CutConfigStore(path=os.getenv("CUT_CONFIG_PATH"))
        self.status_task: asyncio.Task | None = None
        self.input_task: asyncio.Task | None = None
        self.startup_checks: list[StartupCheck] = []
        self.software_version = os.getenv("BAMBOO_SOFTWARE_VERSION", "0.1.0")
        self.local_uid = os.getenv("DEVICE_LOCAL_UID") or self._build_local_uid()
        self.canmv_bridge = CanMvBridge(
            hub=self.hub,
            serial_port=os.getenv("CANMV_SERIAL_PORT"),
            baudrate=int(os.getenv("CANMV_BAUDRATE", "115200")),
            on_frame=self.handle_ai_frame,
        )

    async def broadcast_system_status(self) -> None:
        snapshot = await self.device_status()
        motor_status = await self.motor.status()
        job_status = JobStatus(
            mode=str(motor_status.get("mode", "auto")),
            auto_state=str(motor_status.get("auto_state", "unknown")),
            cycle_count=int(motor_status.get("cycle_count", 0)),
            last_action=str(motor_status.get("last_action", "init")),
            cut_request_active=bool(motor_status.get("cut_request_active", False)),
            cutter_motion_active=bool(motor_status.get("cutter_motion_active", False)),
            cutter_motion_direction=self._get_optional_str(motor_status.get("cutter_motion_direction")),
            cutter_stop_supported=bool(motor_status.get("cutter_stop_supported", False)),
            cutter_stop_requested=bool(motor_status.get("cutter_stop_requested", False)),
            fault_active=bool(motor_status.get("fault_active", False)),
            fault_code=self._get_optional_str(motor_status.get("fault_code")),
            fault_detail=self._get_optional_str(motor_status.get("fault_detail")),
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

    async def input_monitor_loop(self) -> None:
        last_cut_request: bool | None = None
        last_estop: bool | None = None
        while True:
            cut_request = self.inputs.read("canmv_cut_request")
            if cut_request and cut_request.available and cut_request.active is not None:
                await self.motor.process_cut_request_gpio(bool(cut_request.active))
                if last_cut_request is None or bool(cut_request.active) != last_cut_request:
                    last_cut_request = bool(cut_request.active)
                    logger.info("gpio cut_request changed active=%s pin=%s", cut_request.active, cut_request.pin)
                    await self.broadcast_system_status()

            estop = self.inputs.read("estop")
            if estop and estop.available and estop.active is not None:
                if last_estop is None or bool(estop.active) != last_estop:
                    last_estop = bool(estop.active)
                    logger.info("gpio estop changed active=%s pin=%s", estop.active, estop.pin)
                    await self.broadcast_system_status()

            await asyncio.sleep(0.02)

    async def startup(self) -> None:
        logger.info("runtime startup begin")
        await self.motor.set_cut_request_gpio_enabled(self.inputs.is_available("canmv_cut_request"))
        await self.canmv_bridge.start()
        await self.canmv_bridge.set_cut_config(self.cut_config_store.get())
        self.startup_checks = await self._run_startup_checks()
        self.status_task = asyncio.create_task(self.status_broadcast_loop())
        self.input_task = asyncio.create_task(self.input_monitor_loop())
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
        if self.input_task is not None:
            self.input_task.cancel()
            try:
                await self.input_task
            except asyncio.CancelledError:
                pass
            self.input_task = None
        await self.motor.shutdown()
        self.inputs.close()
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

    async def device_identity(self) -> DeviceIdentity:
        model = platform.platform()
        hardware_revision = self._read_device_model()
        return DeviceIdentity(
            local_uid=self.local_uid,
            hostname=os.uname().nodename,
            model=model,
            hardware_revision=hardware_revision,
            software_version=self.software_version,
        )

    async def device_capabilities(self) -> DeviceCapabilities:
        motor_status = await self.motor.status()
        capabilities = [
            DeviceCapability(key="mode.auto", label="自动运行", supported=True, detail="支持自动切割流程"),
            DeviceCapability(key="mode.manual", label="手动调试", supported=True, detail="支持手动调试模式"),
            DeviceCapability(
                key="cut.trigger.gpio",
                label="硬触发切割",
                supported=self.inputs.is_available("canmv_cut_request"),
                detail="GPIO 硬触发已接入，自动流程优先使用该链路"
                if self.inputs.is_available("canmv_cut_request")
                else "未配置 GPIO 硬触发，当前由 UART cut_request 触发自动流程",
            ),
            DeviceCapability(
                key="light.control",
                label="灯光控制",
                supported=bool(motor_status.get("light_available", False)),
                detail="支持 WS2812 灯光控制" if bool(motor_status.get("light_available", False)) else str(motor_status.get("light_error") or "灯光驱动不可用"),
            ),
            DeviceCapability(key="cut.config", label="切割配置", supported=True, detail="支持切割位和命中条件配置"),
            DeviceCapability(
                key="input.feedback",
                label="输入反馈",
                supported=self.inputs.available_count() > 0,
                detail=f"已接入 {self.inputs.available_count()} 路输入" if self.inputs.available_count() > 0 else "未配置输入反馈",
            ),
            DeviceCapability(key="event.history", label="事件历史", supported=True, detail="支持读取运行事件历史"),
        ]
        commands = [
            DeviceCommandDescriptor(command="set_mode_auto", label="切换自动模式", category="mode"),
            DeviceCommandDescriptor(command="set_mode_manual", label="切换手动模式", category="mode"),
            DeviceCommandDescriptor(command="emergency_stop", label="急停", category="safety", dangerous=True),
            DeviceCommandDescriptor(command="fault_reset", label="故障复位", category="safety", dangerous=True),
            DeviceCommandDescriptor(
                command="apply_cut_config",
                label="应用切割配置",
                category="config",
                parameters=[
                    DeviceCommandParameter(name="line_ratio_x", type="number", required=False, min=0, max=1, detail="切割线横向比例"),
                    DeviceCommandParameter(name="tolerance_ratio_x", type="number", required=False, min=0, max=0.25, detail="容差比例"),
                    DeviceCommandParameter(name="show_guide", type="boolean", required=False, detail="是否显示辅助线"),
                    DeviceCommandParameter(name="min_hits", type="integer", required=False, min=1, max=20, detail="命中次数"),
                    DeviceCommandParameter(name="hold_ms", type="integer", required=False, min=0, max=5000, detail="保持时间"),
                ],
            ),
            DeviceCommandDescriptor(
                command="apply_light_config",
                label="应用灯光配置",
                category="config",
                parameters=[
                    DeviceCommandParameter(name="count", type="integer", required=True, min=0, max=16, detail="亮灯数量"),
                    DeviceCommandParameter(name="brightness", type="integer", required=True, min=0, max=255, detail="灯光亮度"),
                    DeviceCommandParameter(name="red", type="integer", required=True, min=0, max=255, detail="红色"),
                    DeviceCommandParameter(name="green", type="integer", required=True, min=0, max=255, detail="绿色"),
                    DeviceCommandParameter(name="blue", type="integer", required=True, min=0, max=255, detail="蓝色"),
                ],
            ),
        ]
        return DeviceCapabilities(capabilities=capabilities, commands=commands)

    async def device_status(self) -> SystemStatus:
        snapshot = self.system_status.snapshot()
        motor_status = await self.motor.status()
        cutter_axis = await self.motor.cutter_axis_state()
        job_status = JobStatus(
            mode=str(motor_status.get("mode", "auto")),
            auto_state=str(motor_status.get("auto_state", "unknown")),
            cycle_count=int(motor_status.get("cycle_count", 0)),
            last_action=str(motor_status.get("last_action", "init")),
            cut_request_active=bool(motor_status.get("cut_request_active", False)),
            cutter_motion_active=bool(motor_status.get("cutter_motion_active", False)),
            cutter_motion_direction=self._get_optional_str(motor_status.get("cutter_motion_direction")),
            cutter_stop_supported=bool(motor_status.get("cutter_stop_supported", False)),
            cutter_stop_requested=bool(motor_status.get("cutter_stop_requested", False)),
            fault_active=bool(motor_status.get("fault_active", False)),
            fault_code=self._get_optional_str(motor_status.get("fault_code")),
            fault_detail=self._get_optional_str(motor_status.get("fault_detail")),
        )
        return snapshot.model_copy(
            update={
                "job_status": job_status,
                "cutter_axis": cutter_axis,
                "input_signals": [InputSignal(**item.__dict__) for item in self.inputs.snapshot()],
                "startup_checks": self._build_startup_checks(snapshot.model_dump(), motor_status),
                "alerts": self._build_alerts(snapshot.model_dump(), motor_status),
                "recent_events": self._build_recent_events(motor_status),
            }
        )

    async def device_events(
        self,
        limit: int = 100,
        *,
        category: str | None = None,
        level: str | None = None,
        since: float | None = None,
    ) -> list[EventItem]:
        return await self.motor.event_history(
            limit=max(1, min(limit, 500)),
            category=category,
            level=level,
            since=since,
        )

    async def execute_device_command(self, req: DeviceCommandRequest) -> CommandAck:
        command = req.command
        params = req.params
        if command == "set_mode_auto":
            return await self.execute_control("mode_auto")
        if command == "set_mode_manual":
            return await self.execute_control("mode_manual")
        if command == "emergency_stop":
            return await self.execute_control("emergency_stop")
        if command == "fault_reset":
            return await self.execute_control("fault_reset")
        if command == "apply_cut_config":
            update: dict[str, object] = {}
            for key in ("line_ratio_x", "tolerance_ratio_x", "show_guide", "min_hits", "hold_ms"):
                if key in params:
                    update[key] = params[key]
            config = self.cut_config_store.update(CutConfigUpdate(**update))
            await self.canmv_bridge.set_cut_config(config)
            return CommandAck(command=command, timestamp=time.time())
        if command == "apply_light_config":
            required = ("count", "brightness", "red", "green", "blue")
            missing = [key for key in required if key not in params]
            if missing:
                raise HTTPException(status_code=400, detail=f"Missing light config params: {', '.join(missing)}")
            await self.motor.configure_light(
                active_leds=int(params["count"]),
                brightness=int(params["brightness"]),
                red=int(params["red"]),
                green=int(params["green"]),
                blue=int(params["blue"]),
            )
            return CommandAck(command=command, timestamp=time.time())
        raise HTTPException(status_code=400, detail=f"Unsupported device command: {command}")

    async def _run_startup_checks(self) -> list[StartupCheck]:
        checks: list[StartupCheck] = []
        motor_status = await self.motor.status()
        video_info = self.video.describe()
        checks.append(
            StartupCheck(
                key="cut_config",
                label="切割配置",
                status="ok",
                detail="切割配置已加载",
            )
        )
        checks.append(
            StartupCheck(
                key="light_driver",
                label="灯光驱动",
                status="ok" if bool(motor_status.get("light_available", False)) else "warn",
                detail="灯光驱动已就绪"
                if bool(motor_status.get("light_available", False))
                else str(motor_status.get("light_error") or "灯光驱动不可用"),
            )
        )
        checks.append(
            StartupCheck(
                key="video_config",
                label="视频链路",
                status="ok" if bool(video_info.get("enabled", False)) else "warn",
                detail="视频配置已启用" if bool(video_info.get("enabled", False)) else str(video_info.get("detail") or "视频链路未启用"),
            )
        )
        checks.append(
            StartupCheck(
                key="canmv_link",
                label="CanMV 通信",
                status="warn",
                detail="等待 CanMV 上线",
            )
        )
        checks.append(
            StartupCheck(
                key="cut_request_link",
                label="切割触发链路",
                status="ok" if self.inputs.is_available("canmv_cut_request") else "warn",
                detail="GPIO 硬触发已接入" if self.inputs.is_available("canmv_cut_request") else "未配置 GPIO 硬触发，当前退回 UART 触发",
            )
        )
        checks.append(
            StartupCheck(
                key="gpio_inputs",
                label="输入反馈",
                status="ok" if self.inputs.available_count() > 0 else "warn",
                detail=f"已接入 {self.inputs.available_count()} 路 GPIO 输入" if self.inputs.available_count() > 0 else "尚未配置 GPIO 输入反馈",
            )
        )
        return checks

    def _build_startup_checks(self, snapshot: dict[str, object], motor_status: dict[str, object]) -> list[StartupCheck]:
        checks = list(self.startup_checks)
        updated: list[StartupCheck] = []
        for item in checks:
            if item.key == "canmv_link":
                updated.append(
                    StartupCheck(
                        key=item.key,
                        label=item.label,
                        status="ok" if bool(snapshot.get("canmv_connected", False)) else "warn",
                        detail="CanMV 通信正常"
                        if bool(snapshot.get("canmv_connected", False))
                        else "等待 CanMV 上线",
                    )
                )
            elif item.key == "light_driver":
                updated.append(
                    StartupCheck(
                        key=item.key,
                        label=item.label,
                        status="ok" if bool(motor_status.get("light_available", False)) else "warn",
                        detail="灯光驱动已就绪"
                        if bool(motor_status.get("light_available", False))
                        else str(motor_status.get("light_error") or "灯光驱动不可用"),
                    )
                )
            elif item.key == "gpio_inputs":
                updated.append(
                    StartupCheck(
                        key=item.key,
                        label=item.label,
                        status="ok" if self.inputs.available_count() > 0 else "warn",
                        detail=f"已接入 {self.inputs.available_count()} 路 GPIO 输入" if self.inputs.available_count() > 0 else "尚未配置 GPIO 输入反馈",
                    )
                )
            elif item.key == "cut_request_link":
                updated.append(
                    StartupCheck(
                        key=item.key,
                        label=item.label,
                        status="ok" if self.inputs.is_available("canmv_cut_request") else "warn",
                        detail="GPIO 硬触发已接入" if self.inputs.is_available("canmv_cut_request") else "未配置 GPIO 硬触发，当前退回 UART 触发",
                    )
                )
            else:
                updated.append(item)
        return updated

    def _build_alerts(self, snapshot: dict[str, object], motor_status: dict[str, object]) -> list[AlertItem]:
        alerts: list[AlertItem] = []
        input_signals = self.inputs.snapshot()
        if not bool(snapshot.get("canmv_connected", False)):
            alerts.append(
                AlertItem(
                    level="warning",
                    code="canmv_offline",
                    title="AI 识别离线",
                    detail="尚未收到 CanMV 最新状态。",
                )
            )
        if not self.inputs.is_available("canmv_cut_request"):
            alerts.append(
                AlertItem(
                    level="warning",
                    code="cut_request_gpio_unavailable",
                    title="切割硬触发未接入",
                    detail="当前自动流程退回 UART cut_request 触发，实时性与确定性弱于 GPIO 硬触发。",
                )
            )
        if bool(motor_status.get("fault_active", False)):
            alerts.append(
                AlertItem(
                    level="danger",
                    code=str(motor_status.get("fault_code") or "motor_fault"),
                    title="自动流程故障",
                    detail=str(motor_status.get("fault_detail") or "设备已进入保护状态"),
                )
            )
        if motor_status.get("light_error"):
            alerts.append(
                AlertItem(
                    level="warning",
                    code="light_driver",
                    title="灯光驱动异常",
                    detail=str(motor_status.get("light_error")),
                )
            )
        if (snapshot.get("raspberry_pi") or {}).get("memory_percent", 0) and float((snapshot.get("raspberry_pi") or {}).get("memory_percent", 0)) >= 85:
            alerts.append(
                AlertItem(
                    level="warning",
                    code="pi_memory_high",
                    title="树莓派内存偏高",
                    detail="建议检查后台进程或降低资源占用。",
                )
            )
        for signal in input_signals:
            if signal.key == "estop" and signal.available and signal.active:
                alerts.append(
                    AlertItem(
                        level="danger",
                        code="estop_active",
                        title="急停回路触发",
                        detail="检测到急停输入处于激活状态。",
                    )
                )
        return alerts

    def _build_recent_events(self, motor_status: dict[str, object]) -> list[EventItem]:
        raw_events = motor_status.get("recent_events", [])
        events: list[EventItem] = []
        for item in raw_events[:6]:
            if isinstance(item, EventItem):
                events.append(item)
            elif isinstance(item, dict):
                events.append(EventItem(**item))
        return events

    def _get_optional_str(self, value: object) -> str | None:
        if value is None:
            return None
        text = str(value)
        return text if text else None

    def _get_optional_float(self, value: object) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _build_local_uid(self) -> str:
        node = uuid.getnode()
        return f"device-{node:012x}"

    def _read_device_model(self) -> str | None:
        path = "/proc/device-tree/model"
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                return fp.read().strip("\x00").strip()
        except Exception:
            return None


runtime = RuntimeServices()
