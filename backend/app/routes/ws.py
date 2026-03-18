from __future__ import annotations

import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..models import AiFrame
from ..services import runtime

router = APIRouter()


@router.websocket("/ws/ui")
async def ws_ui(ws: WebSocket) -> None:
    await runtime.hub.add_ui(ws)
    try:
        payload = runtime.system_status.snapshot().model_dump()
        await ws.send_text(json.dumps({"type": "system_status", "payload": payload}))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        runtime.hub.remove_ui(ws)
    except Exception:
        runtime.hub.remove_ui(ws)


@router.websocket("/ws/canmv")
async def ws_canmv(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            payload = json.loads(raw)
            if "timestamp" not in payload:
                payload["timestamp"] = time.time()

            frame = AiFrame.model_validate(payload)
            await runtime.handle_ai_frame(frame)
            await runtime.broadcast_ai_frame(frame)
    except WebSocketDisconnect:
        return
    except Exception:
        return


@router.websocket("/ws/video")
async def ws_video(ws: WebSocket) -> None:
    try:
        await runtime.video.run_session(ws)
    except WebSocketDisconnect:
        return
