from __future__ import annotations

import os
import time

from .models import AiFrame, PiSystemStatus, SystemStatus

try:
    import psutil  # type: ignore
except Exception:
    psutil = None


class SystemStatusStore:
    def __init__(self) -> None:
        self._latest_canmv_frame: AiFrame | None = None

    def update_canmv_frame(self, frame: AiFrame) -> None:
        self._latest_canmv_frame = frame

    def snapshot(self) -> SystemStatus:
        pi_status = PiSystemStatus(
            hostname=os.uname().nodename,
            cpu_percent=self._cpu_percent(),
            memory_percent=self._memory_percent(),
            uptime_seconds=self._uptime_seconds(),
        )

        frame = self._latest_canmv_frame
        connected = False
        last_seen_seconds = None
        fps = None
        canmv_status = None
        if frame is not None:
            last_seen_seconds = max(0.0, time.time() - frame.timestamp)
            connected = last_seen_seconds <= 5.0
            fps = frame.fps
            canmv_status = frame.canmv_status

        return SystemStatus(
            raspberry_pi=pi_status,
            canmv_connected=connected,
            canmv_last_seen_seconds=last_seen_seconds,
            canmv_fps=fps,
            canmv_status=canmv_status,
        )

    def _cpu_percent(self) -> float | None:
        if psutil is None:
            return None
        return float(psutil.cpu_percent(interval=None))

    def _memory_percent(self) -> float | None:
        if psutil is None:
            return None
        return float(psutil.virtual_memory().percent)

    def _uptime_seconds(self) -> float | None:
        if psutil is None:
            return None
        return max(0.0, time.time() - float(psutil.boot_time()))
