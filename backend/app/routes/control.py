from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from ..models import ActionControlRequest, CommandAck, LightControlRequest, ModeControlRequest
from ..services import runtime

router = APIRouter()


@router.post("/api/control/mode", response_model=CommandAck)
async def control_mode(req: ModeControlRequest) -> CommandAck:
    if req.mode == "manual":
        return await runtime.execute_control("mode_manual")
    if req.mode == "auto":
        return await runtime.execute_control("mode_auto")
    raise HTTPException(status_code=400, detail=f"Unsupported mode: {req.mode}")


@router.post("/api/control/feed", response_model=CommandAck)
async def control_feed(req: ActionControlRequest) -> CommandAck:
    if req.action == "start":
        return await runtime.execute_control("feed_start")
    if req.action == "stop":
        return await runtime.execute_control("feed_stop")
    raise HTTPException(status_code=400, detail=f"Unsupported feed action: {req.action}")


@router.post("/api/control/clamp", response_model=CommandAck)
async def control_clamp(req: ActionControlRequest) -> CommandAck:
    if req.action == "engage":
        return await runtime.execute_control("clamp_engage")
    if req.action == "release":
        return await runtime.execute_control("clamp_release")
    raise HTTPException(status_code=400, detail=f"Unsupported clamp action: {req.action}")


@router.post("/api/control/cutter", response_model=CommandAck)
async def control_cutter(req: ActionControlRequest) -> CommandAck:
    if req.action == "down":
        return await runtime.execute_control("cutter_down")
    if req.action == "up":
        return await runtime.execute_control("cutter_up")
    raise HTTPException(status_code=400, detail=f"Unsupported cutter action: {req.action}")


@router.post("/api/control/light", response_model=CommandAck)
async def control_light(req: LightControlRequest) -> CommandAck:
    try:
        if req.action == "off":
            return await runtime.execute_control("light_off")
        if req.action == "set_count":
            return await runtime.execute_control("light_set_count", req.value)
        if req.action == "configure":
            if req.value is None:
                raise HTTPException(status_code=400, detail="Light count is required")
            if req.brightness is None:
                raise HTTPException(status_code=400, detail="Light brightness is required")
            if req.red is None or req.green is None or req.blue is None:
                raise HTTPException(status_code=400, detail="Light color is required")
            await runtime.motor.configure_light(
                active_leds=req.value,
                brightness=req.brightness,
                red=req.red,
                green=req.green,
                blue=req.blue,
            )
            return CommandAck(command="light_config", value=req.value, timestamp=time.time())
        raise HTTPException(status_code=400, detail=f"Unsupported light action: {req.action}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/control/emergency-stop", response_model=CommandAck)
async def control_emergency_stop() -> CommandAck:
    return await runtime.execute_control("emergency_stop")
