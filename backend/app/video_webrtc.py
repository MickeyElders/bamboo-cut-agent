from __future__ import annotations

import asyncio
import contextlib
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
    encoder: str = os.getenv("VIDEO_ENCODER", "v4l2h264enc")
    stun_server: str = os.getenv("VIDEO_STUN_SERVER", "")
    source_format: str = os.getenv("VIDEO_SOURCE_FORMAT", "jpeg")
    queue_buffers: int = int(os.getenv("VIDEO_QUEUE_BUFFERS", "1"))
    keyframe_interval: int = int(os.getenv("VIDEO_KEYFRAME_INTERVAL", "30"))


class WebRtcSession:
    def __init__(self, ws: WebSocket, loop: asyncio.AbstractEventLoop, config: VideoConfig) -> None:
        if not GST_AVAILABLE:
            raise RuntimeError("GStreamer Python bindings are unavailable")

        self.ws = ws
        self.loop = loop
        self.config = config
        self.pipeline = None
        self.webrtc = None
        self.bus = None
        self.bus_task: asyncio.Task | None = None

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
        self.bus = self.pipeline.get_bus()
        self.bus_task = asyncio.create_task(self._watch_bus())
        await self._send({"type": "state", "state": "starting"})

    async def stop(self) -> None:
        if self.bus_task is not None:
            self.bus_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.bus_task
            self.bus_task = None
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
        source_caps = self._source_caps()
        pre_encoder = self._pre_encoder_pipeline()
        stun_segment = f' stun-server="{self.config.stun_server}"' if self.config.stun_server else ""
        return (
            f'webrtcbin name=sendrecv bundle-policy=max-bundle{stun_segment} '
            f'v4l2src device={self.config.device} ! '
            f'{source_caps} ! '
            f'queue max-size-buffers={max(self.config.queue_buffers, 1)} leaky=downstream ! '
            f'{pre_encoder}{encoder} ! h264parse ! rtph264pay config-interval=1 pt=96 ! '
            'application/x-rtp,media=video,encoding-name=H264,payload=96 ! sendrecv.'
        )

    def _source_caps(self) -> str:
        if self.config.source_format == "raw":
            return (
                f'video/x-raw,width={self.config.width},height={self.config.height},framerate={self.config.fps}/1'
            )
        if self.config.source_format == "h264":
            return (
                f'video/x-h264,width={self.config.width},height={self.config.height},framerate={self.config.fps}/1'
            )
        return (
            f'image/jpeg,width={self.config.width},height={self.config.height},framerate={self.config.fps}/1 ! '
            'jpegdec ! videoconvert'
        )

    def _encoder_pipeline(self) -> str:
        if self.config.encoder == "v4l2h264enc":
            return (
                "v4l2h264enc "
                f"extra-controls=controls,video_bitrate={self.config.bitrate_kbps * 1000},repeat_sequence_header=1,h264_i_frame_period={max(self.config.keyframe_interval, 1)}"
            )
        return (
            f"x264enc tune=zerolatency speed-preset=ultrafast bitrate={self.config.bitrate_kbps} "
            f"key-int-max={max(self.config.keyframe_interval, 1)} bframes=0 rc-lookahead=0 sync-lookahead=0 sliced-threads=true"
        )

    def _pre_encoder_pipeline(self) -> str:
        if self.config.encoder == "v4l2h264enc":
            return "videoconvert ! video/x-raw,format=I420 ! "
        return ""

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

    async def _watch_bus(self) -> None:
        if self.bus is None:
            return

        while True:
            msg = self.bus.timed_pop_filtered(
                100 * Gst.MSECOND,
                Gst.MessageType.ERROR | Gst.MessageType.WARNING | Gst.MessageType.STATE_CHANGED,
            )
            if msg is None:
                await asyncio.sleep(0)
                continue

            if msg.type == Gst.MessageType.ERROR:
                err, dbg = msg.parse_error()
                await self._send({"type": "error", "detail": f"GStreamer error: {err}; {dbg or ''}"})
            elif msg.type == Gst.MessageType.WARNING:
                warn, dbg = msg.parse_warning()
                await self._send({"type": "state", "state": f"warning: {warn}; {dbg or ''}"})
            elif msg.type == Gst.MessageType.STATE_CHANGED and msg.src == self.pipeline:
                _old, new, _pending = msg.parse_state_changed()
                await self._send({"type": "state", "state": f"pipeline={new.value_nick}"})


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
            try:
                await session.start()
            except Exception as exc:
                await ws.accept()
                await ws.send_text(json.dumps({"type": "error", "detail": f"Video pipeline start failed: {exc}"}))
                await ws.close(code=1011)
                return
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
            "source_format": self.config.source_format,
            "queue_buffers": self.config.queue_buffers,
            "keyframe_interval": self.config.keyframe_interval,
        }
