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


class SystemStatus(BaseModel):
    raspberry_pi: PiSystemStatus
    canmv_connected: bool
    canmv_last_seen_seconds: float | None = None
    canmv_fps: float | None = None
    canmv_status: CanMvSystemStatus | None = None


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
