from __future__ import annotations

import asyncio
import logging
import os
import time

logger = logging.getLogger(__name__)

try:
    from gpiozero import DigitalOutputDevice  # type: ignore
except Exception:
    DigitalOutputDevice = None


class _TriggerLine:
    def __init__(self, pin: int | None, *, active_high: bool) -> None:
        self.pin = pin
        self.active_high = active_high
        self.device = None

        if pin is None or DigitalOutputDevice is None:
            return

        initial = False if active_high else True
        self.device = DigitalOutputDevice(pin, active_high=active_high, initial_value=initial)

    @property
    def available(self) -> bool:
        return self.device is not None

    def pulse(self, duration_s: float) -> None:
        if self.device is None:
            return
        self.device.on()
        time.sleep(max(duration_s, 0.001))
        self.device.off()

    def close(self) -> None:
        if self.device is None:
            return
        self.device.close()
        self.device = None


class DkcProgramCutter:
    driver_name = "dkc_program_trigger"

    def __init__(self) -> None:
        self.up_pin = self._parse_pin(os.getenv("CUTTER_TRIGGER_UP_PIN") or os.getenv("DKC_TRIGGER_UP_PIN"))
        self.down_pin = self._parse_pin(os.getenv("CUTTER_TRIGGER_DOWN_PIN") or os.getenv("DKC_TRIGGER_DOWN_PIN"))
        self.stop_pin = self._parse_pin(os.getenv("CUTTER_TRIGGER_STOP_PIN") or os.getenv("DKC_TRIGGER_STOP_PIN"))
        self.active_high = self._parse_bool(os.getenv("CUTTER_TRIGGER_ACTIVE_HIGH", "1"), default=True)
        self.pulse_ms = max(20, int(os.getenv("CUTTER_TRIGGER_PULSE_MS", "120")))
        self.available = False
        self.error: str | None = None

        try:
            if self.up_pin is None or self.down_pin is None:
                raise ValueError("CUTTER_TRIGGER_UP_PIN and CUTTER_TRIGGER_DOWN_PIN are required")
            if DigitalOutputDevice is None:
                raise RuntimeError("gpiozero is unavailable")

            self._up = _TriggerLine(self.up_pin, active_high=self.active_high)
            self._down = _TriggerLine(self.down_pin, active_high=self.active_high)
            self._stop = _TriggerLine(self.stop_pin, active_high=self.active_high)
            self.available = True
            logger.info(
                "dkc program cutter ready up_pin=%s down_pin=%s stop_pin=%s pulse_ms=%s",
                self.up_pin,
                self.down_pin,
                self.stop_pin,
                self.pulse_ms,
            )
        except Exception as exc:
            self.error = str(exc)
            self.available = False
            logger.exception("dkc program cutter init failed")
            self._up = _TriggerLine(None, active_high=True)
            self._down = _TriggerLine(None, active_high=True)
            self._stop = _TriggerLine(None, active_high=True)

    async def move_down(self) -> None:
        await asyncio.to_thread(self._down.pulse, self.pulse_ms / 1000.0)

    async def move_up(self) -> None:
        await asyncio.to_thread(self._up.pulse, self.pulse_ms / 1000.0)

    async def stop_motion(self) -> None:
        if not self._stop.available:
            raise RuntimeError("CUTTER_TRIGGER_STOP_PIN is not configured")
        await asyncio.to_thread(self._stop.pulse, self.pulse_ms / 1000.0)

    def close(self) -> None:
        self._up.close()
        self._down.close()
        self._stop.close()

    @staticmethod
    def _parse_pin(value: str | None) -> int | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            return None
        return int(text)

    @staticmethod
    def _parse_bool(value: str | None, *, default: bool) -> bool:
        if value is None:
            return default
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
