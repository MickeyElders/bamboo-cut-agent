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


class MotorCommand(BaseModel):
    command: str


class MotorStatus(BaseModel):
    feed_running: bool = False
    cutter_down: bool = False
    last_action: str = "init"


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
