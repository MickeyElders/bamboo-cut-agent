from __future__ import annotations

from fastapi import APIRouter

from typing import List

from ..models import CommandAck, DeviceCapabilities, DeviceCommandRequest, DeviceIdentity, EventItem, SystemStatus
from ..services import runtime

router = APIRouter()


@router.get("/api/device/identity", response_model=DeviceIdentity)
async def get_device_identity() -> DeviceIdentity:
    return await runtime.device_identity()


@router.get("/api/device/capabilities", response_model=DeviceCapabilities)
async def get_device_capabilities() -> DeviceCapabilities:
    return await runtime.device_capabilities()


@router.get("/api/device/status", response_model=SystemStatus)
async def get_device_status() -> SystemStatus:
    return await runtime.device_status()


@router.get("/api/device/events", response_model=List[EventItem])
async def get_device_events(
    limit: int = 100,
    category: str | None = None,
    level: str | None = None,
    since: float | None = None,
) -> List[EventItem]:
    return await runtime.device_events(limit=limit, category=category, level=level, since=since)


@router.post("/api/device/commands", response_model=CommandAck)
async def post_device_command(req: DeviceCommandRequest) -> CommandAck:
    return await runtime.execute_device_command(req)
