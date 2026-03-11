from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

try:
    import gi

    gi.require_version("Gst", "1.0")
    gi.require_version("GstSdp", "1.0")
    gi.require_version("GstWebRTC", "1.0")
    from gi.repository import Gst, GstSdp, GstWebRTC  # type: ignore

    Gst.init(None)
    GST_AVAILABLE = True
    GST_ERROR = ""
except Exception:
    Gst = None
    GstSdp = None
    GstWebRTC = None
    GST_AVAILABLE = False
    GST_ERROR = "GStreamer Python bindings unavailable"


@dataclass
class VideoConfig:
    device: str = os.getenv(
        "VIDEO_DEVICE",
        "/dev/v4l/by-id/usb-MACROSILICON_V-Z624_20210621-video-index0",
    )
    width: int = int(os.getenv("VIDEO_WIDTH", "1280"))
    height: int = int(os.getenv("VIDEO_HEIGHT", "720"))
    fps: int = int(os.getenv("VIDEO_FPS", "30"))
    bitrate_kbps: int = int(os.getenv("VIDEO_BITRATE_KBPS", "2500"))
    encoder: str = os.getenv("VIDEO_ENCODER", "x264enc")
    stun_server: str = os.getenv("VIDEO_STUN_SERVER", "")


class WebRtcSession:
    def __init__(self, ws: WebSocket, loop: asyncio.AbstractEventLoop, config: VideoConfig) -> None:
        if not GST_AVAILABLE:
            raise RuntimeError("GStreamer Python bindings are unavailable")

        self.ws = ws
        self.loop = loop
        self.config = config
        self.pipeline = None
        self.webrtc = None

    async def start(self) -> None:
        await self.ws.accept()
        pipeline_str = self._build_pipeline()
        self.pipeline = Gst.parse_launch(pipeline_str)
        self.webrtc = self.pipeline.get_by_name("sendrecv")
        if self.webrtc is None:
            raise RuntimeError("Failed to create webrtcbin")

        self.webrtc.connect("on-negotiation-needed", self._on_negotiation_needed)
        self.webrtc.connect("on-ice-candidate", self._on_ice_candidate)
        self.webrtc.connect("notify::ice-gathering-state", self._on_gathering_state)
        self.pipeline.set_state(Gst.State.PLAYING)
        await self._send({"type": "state", "state": "starting"})

    async def stop(self) -> None:
        if self.pipeline is not None:
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
            self.webrtc = None

    async def handle_message(self, text: str) -> None:
        payload = json.loads(text)
        msg_type = payload.get("type")
        if msg_type == "answer":
            self._set_remote_answer(payload["sdp"])
        elif msg_type == "ice":
            candidate = payload.get("candidate")
            sdp_m_line_index = int(payload.get("sdpMLineIndex", 0))
            if candidate and self.webrtc is not None:
                self.webrtc.emit("add-ice-candidate", sdp_m_line_index, candidate)
        elif msg_type == "ping":
            await self._send({"type": "pong"})

    def _build_pipeline(self) -> str:
        encoder = self._encoder_pipeline()
        stun_segment = f' stun-server="{self.config.stun_server}"' if self.config.stun_server else ""
        return (
            f'webrtcbin name=sendrecv bundle-policy=max-bundle{stun_segment} '
            f'v4l2src device={self.config.device} ! '
            f'image/jpeg,width={self.config.width},height={self.config.height},framerate={self.config.fps}/1 ! '
            'jpegdec ! videoconvert ! queue ! '
            f'{encoder} ! h264parse ! rtph264pay config-interval=1 pt=96 ! '
            'application/x-rtp,media=video,encoding-name=H264,payload=96 ! sendrecv.'
        )

    def _encoder_pipeline(self) -> str:
        if self.config.encoder == "v4l2h264enc":
            return f"v4l2h264enc extra-controls=controls,video_bitrate={self.config.bitrate_kbps * 1000}"
        return (
            f"x264enc tune=zerolatency speed-preset=ultrafast bitrate={self.config.bitrate_kbps} "
            "key-int-max=30"
        )

    def _on_negotiation_needed(self, element: Any) -> None:
        promise = Gst.Promise.new_with_change_func(self._on_offer_created, element, None)
        element.emit("create-offer", None, promise)

    def _on_offer_created(self, promise: Any, _element: Any, _data: Any) -> None:
        if self.webrtc is None:
            return

        reply = promise.get_reply()
        offer = reply.get_value("offer")
        local_promise = Gst.Promise.new()
        self.webrtc.emit("set-local-description", offer, local_promise)
        local_promise.interrupt()
        asyncio.run_coroutine_threadsafe(
            self._send({"type": "offer", "sdp": offer.sdp.as_text()}),
            self.loop,
        )

    def _set_remote_answer(self, sdp: str) -> None:
        if self.webrtc is None:
            return

        result, sdpmsg = GstSdp.SDPMessage.new()
        if result != GstSdp.SDPResult.OK:
            raise RuntimeError("Failed to allocate SDP message")

        parse_result = GstSdp.sdp_message_parse_buffer(bytes(sdp.encode()), sdpmsg)
        if parse_result != GstSdp.SDPResult.OK:
            raise RuntimeError("Failed to parse remote SDP answer")

        answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdpmsg)
        promise = Gst.Promise.new()
        self.webrtc.emit("set-remote-description", answer, promise)
        promise.interrupt()

    def _on_ice_candidate(self, _element: Any, mlineindex: int, candidate: str) -> None:
        asyncio.run_coroutine_threadsafe(
            self._send({"type": "ice", "candidate": candidate, "sdpMLineIndex": mlineindex}),
            self.loop,
        )

    def _on_gathering_state(self, _element: Any, _param: Any) -> None:
        if self.webrtc is None:
            return
        state = self.webrtc.get_property("ice-gathering-state")
        asyncio.run_coroutine_threadsafe(
            self._send({"type": "state", "state": str(state.value_nick)}),
            self.loop,
        )

    async def _send(self, payload: dict[str, Any]) -> None:
        await self.ws.send_text(json.dumps(payload))


class VideoWebRtcManager:
    def __init__(self) -> None:
        self.config = VideoConfig()
        self.sessions: set[WebRtcSession] = set()

    async def run_session(self, ws: WebSocket) -> None:
        if not GST_AVAILABLE:
            await ws.accept()
            await ws.send_text(json.dumps({"type": "error", "detail": "GStreamer Python bindings not installed"}))
            await ws.close(code=1011)
            return

        session = WebRtcSession(ws=ws, loop=asyncio.get_running_loop(), config=self.config)
        self.sessions.add(session)
        try:
            await session.start()
            while True:
                text = await ws.receive_text()
                await session.handle_message(text)
        finally:
            self.sessions.discard(session)
            await session.stop()

    async def shutdown(self) -> None:
        for session in list(self.sessions):
            await session.stop()
        self.sessions.clear()

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": GST_AVAILABLE,
            "detail": GST_ERROR if not GST_AVAILABLE else "",
            "device": self.config.device,
            "width": self.config.width,
            "height": self.config.height,
            "fps": self.config.fps,
            "encoder": self.config.encoder,
            "bitrate_kbps": self.config.bitrate_kbps,
        }
