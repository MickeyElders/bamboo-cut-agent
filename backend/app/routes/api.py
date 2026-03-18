from __future__ import annotations

import os
import time
from typing import Any

from fastapi import APIRouter

from ..models import CutConfig, CutConfigUpdate
from ..services import runtime

router = APIRouter()


@router.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "ts": time.time()}


@router.get("/api/canmv/config")
async def canmv_config() -> dict[str, Any]:
    return {
        "websocket_ingest": "/ws/canmv",
        "serial_port": os.getenv("CANMV_SERIAL_PORT"),
        "baudrate": int(os.getenv("CANMV_BAUDRATE", "115200")),
    }


@router.get("/api/video/config")
async def video_config() -> dict[str, Any]:
    return runtime.video.describe()


@router.get("/api/cut-config", response_model=CutConfig)
async def get_cut_config() -> CutConfig:
    return runtime.cut_config_store.get()


@router.put("/api/cut-config", response_model=CutConfig)
async def update_cut_config(req: CutConfigUpdate) -> CutConfig:
    config = runtime.cut_config_store.update(req)
    await runtime.canmv_bridge.set_cut_config(config)
    return config
