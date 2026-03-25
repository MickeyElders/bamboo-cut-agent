from __future__ import annotations

from fastapi import APIRouter, HTTPException

from typing import List

from ..models import EventItem, SystemActionAck, SystemActionRequest, SystemMaintenanceSnapshot
from ..services import runtime

router = APIRouter()


@router.get("/api/system/maintenance", response_model=SystemMaintenanceSnapshot)
async def get_system_maintenance() -> SystemMaintenanceSnapshot:
    return await runtime.system.snapshot()


@router.post("/api/system/action", response_model=SystemActionAck)
async def post_system_action(req: SystemActionRequest) -> SystemActionAck:
    try:
        return await runtime.system.execute_action(req.action)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/system/events", response_model=List[EventItem])
async def get_system_events(
    limit: int = 100,
    category: str | None = None,
    level: str | None = None,
    since: float | None = None,
) -> List[EventItem]:
    return await runtime.motor.event_history(
        limit=max(1, min(limit, 500)),
        category=category,
        level=level,
        since=since,
    )
