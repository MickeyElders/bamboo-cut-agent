from pydantic import BaseModel, Field
from typing import List


class Detection(BaseModel):
    label: str = "node"
    score: float = 0.0
    x: int
    y: int
    w: int
    h: int


class CanMvSystemStatus(BaseModel):
    cpu_percent: float | None = None
    kpu_percent: float | None = None
    memory_percent: float | None = None
    temperature_c: float | None = None


class AiFrame(BaseModel):
    timestamp: float
    fps: float | None = None
    detections: List[Detection] = Field(default_factory=list)
    canmv_status: CanMvSystemStatus | None = None
    cut_request: bool = False
    cut_config: "CutConfig | None" = None


class CommandAck(BaseModel):
    ok: bool = True
    command: str
    value: int | None = None
    timestamp: float


class ModeControlRequest(BaseModel):
    mode: str


class ActionControlRequest(BaseModel):
    action: str


class CutterAxisState(BaseModel):
    position_known: bool = False
    current_position_mm: float = 0.0
    stroke_mm: float | None = Field(default=None, gt=0.0, le=1000.0)
    available: bool = False
    driver: str | None = None
    error: str | None = None
    updated_at: float | None = None


class CutterAxisUpdate(BaseModel):
    position_known: bool | None = None
    current_position_mm: float | None = None
    stroke_mm: float | None = Field(default=None, gt=0.0, le=1000.0)
    stroke_up_mm: float | None = Field(default=None, gt=0.0, le=1000.0)
    stroke_down_mm: float | None = Field(default=None, gt=0.0, le=1000.0)


class LightControlRequest(BaseModel):
    action: str
    value: int | None = None
    brightness: int | None = Field(default=None, ge=0, le=255)
    red: int | None = Field(default=None, ge=0, le=255)
    green: int | None = Field(default=None, ge=0, le=255)
    blue: int | None = Field(default=None, ge=0, le=255)


class PiSystemStatus(BaseModel):
    hostname: str
    cpu_percent: float | None = None
    memory_percent: float | None = None
    uptime_seconds: float | None = None


class JobStatus(BaseModel):
    mode: str
    auto_state: str
    cycle_count: int
    last_action: str
    cut_request_active: bool
    fault_active: bool = False
    fault_code: str | None = None
    fault_detail: str | None = None


class StartupCheck(BaseModel):
    key: str
    label: str
    status: str
    detail: str


class AlertItem(BaseModel):
    level: str
    code: str
    title: str
    detail: str


class EventItem(BaseModel):
    timestamp: float
    category: str = "runtime"
    level: str
    code: str
    message: str


class InputSignal(BaseModel):
    key: str
    label: str
    pin: int | None = None
    active: bool | None = None
    available: bool = False
    pull_up: bool = True
    active_high: bool = False
    detail: str


class SystemStatus(BaseModel):
    schema_version: str = "device-status.v1"
    raspberry_pi: PiSystemStatus
    canmv_connected: bool
    canmv_last_seen_seconds: float | None = None
    canmv_fps: float | None = None
    canmv_status: CanMvSystemStatus | None = None
    job_status: JobStatus | None = None
    cutter_axis: CutterAxisState | None = None
    input_signals: List[InputSignal] = Field(default_factory=list)
    startup_checks: List[StartupCheck] = Field(default_factory=list)
    alerts: List[AlertItem] = Field(default_factory=list)
    recent_events: List[EventItem] = Field(default_factory=list)


class CutConfig(BaseModel):
    line_ratio_x: float = Field(default=0.5, ge=0.0, le=1.0)
    tolerance_ratio_x: float = Field(default=0.015, ge=0.0, le=0.25)
    show_guide: bool = False
    min_hits: int = Field(default=3, ge=1, le=20)
    hold_ms: int = Field(default=200, ge=0, le=5000)


class CutConfigUpdate(BaseModel):
    line_ratio_x: float | None = Field(default=None, ge=0.0, le=1.0)
    tolerance_ratio_x: float | None = Field(default=None, ge=0.0, le=0.25)
    show_guide: bool | None = None
    min_hits: int | None = Field(default=None, ge=1, le=20)
    hold_ms: int | None = Field(default=None, ge=0, le=5000)


class SystemActionRequest(BaseModel):
    action: str


class NetworkInterfaceStatus(BaseModel):
    name: str
    is_up: bool
    ipv4: List[str] = Field(default_factory=list)
    mac: str | None = None
    kind: str = "unknown"


class SystemMaintenanceSnapshot(BaseModel):
    hostname: str
    device_url: str
    default_interface: str | None = None
    wifi_ssid: str | None = None
    network_online: bool = False
    ip_addresses: List[str] = Field(default_factory=list)
    interfaces: List[NetworkInterfaceStatus] = Field(default_factory=list)
    disk_total_gb: float | None = None
    disk_used_gb: float | None = None
    disk_free_gb: float | None = None
    disk_percent: float | None = None
    supported_actions: List[str] = Field(default_factory=list)


class SystemActionAck(BaseModel):
    ok: bool = True
    action: str
    detail: str
    timestamp: float


class DeviceIdentity(BaseModel):
    schema_version: str = "device-api.v1"
    local_uid: str
    hostname: str
    model: str
    hardware_revision: str | None = None
    software_version: str


class DeviceCapability(BaseModel):
    key: str
    label: str
    supported: bool = True
    detail: str = ""


class DeviceCommandParameter(BaseModel):
    name: str
    type: str
    required: bool = False
    min: int | float | None = None
    max: int | float | None = None
    detail: str = ""


class DeviceCommandDescriptor(BaseModel):
    command: str
    label: str
    category: str
    dangerous: bool = False
    manual_only: bool = False
    detail: str = ""
    parameters: List[DeviceCommandParameter] = Field(default_factory=list)


class DeviceCapabilities(BaseModel):
    capabilities: List[DeviceCapability] = Field(default_factory=list)
    commands: List[DeviceCommandDescriptor] = Field(default_factory=list)


class DeviceCommandRequest(BaseModel):
    command: str
    params: dict[str, object] = Field(default_factory=dict)

