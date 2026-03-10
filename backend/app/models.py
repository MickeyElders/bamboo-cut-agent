from pydantic import BaseModel, Field
from typing import List


class Detection(BaseModel):
    label: str = "node"
    score: float = 0.0
    x: int
    y: int
    w: int
    h: int


class AiFrame(BaseModel):
    timestamp: float
    fps: float | None = None
    detections: List[Detection] = Field(default_factory=list)


class MotorCommand(BaseModel):
    command: str


class MotorStatus(BaseModel):
    feed_running: bool = False
    cutter_down: bool = False
    last_action: str = "init"
