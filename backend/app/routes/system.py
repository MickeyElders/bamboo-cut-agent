from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import SystemActionAck, SystemActionRequest, SystemMaintenanceSnapshot
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
