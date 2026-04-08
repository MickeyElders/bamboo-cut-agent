from __future__ import annotations

import asyncio
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

try:
    from gpiozero import DigitalOutputDevice  # type: ignore
except Exception:
    DigitalOutputDevice = None


class _SignalLine:
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

    def write(self, asserted: bool) -> None:
        if self.device is None:
            return
        if asserted:
            self.device.on()
        else:
            self.device.off()

    def pulse(self, half_period_s: float) -> None:
        if self.device is None:
            return
        self.write(True)
        time.sleep(half_period_s)
        self.write(False)
        time.sleep(half_period_s)

    def close(self) -> None:
        if self.device is None:
            return
        self.device.close()
        self.device = None


class StepperCutter:
    driver_name = "stepper_pulse"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.pulse_pin = self._parse_pin(os.getenv("CUTTER_PULSE_PIN"))
        self.dir_pin = self._parse_pin(os.getenv("CUTTER_DIR_PIN"))
        self.enable_pin = self._parse_pin(os.getenv("CUTTER_ENABLE_PIN"))
        self.dir_down_value = self._parse_bool(os.getenv("CUTTER_DIR_DOWN_VALUE", "1"), default=True)
        self.pulse_active_high = self._parse_bool(os.getenv("CUTTER_PULSE_ACTIVE_HIGH", "0"), default=False)
        self.dir_active_high = self._parse_bool(os.getenv("CUTTER_DIR_ACTIVE_HIGH", "0"), default=False)
        self.enable_active_high = self._parse_bool(os.getenv("CUTTER_ENABLE_ACTIVE_HIGH", "0"), default=False)
        self.pulse_hz = max(1, int(os.getenv("CUTTER_PULSE_HZ", "300")))
        self.down_steps = max(1, int(os.getenv("CUTTER_DOWN_STEPS", "800")))
        self.up_steps = max(1, int(os.getenv("CUTTER_UP_STEPS", str(self.down_steps))))
        self.dir_setup_ms = max(0, int(os.getenv("CUTTER_DIR_SETUP_MS", "5")))
        self.enable_setup_ms = max(0, int(os.getenv("CUTTER_ENABLE_SETUP_MS", "5")))
        self.disable_after_move = self._parse_bool(os.getenv("CUTTER_DISABLE_AFTER_MOVE", "1"), default=True)

        self.available = False
        self.error: str | None = None

        try:
            if self.pulse_pin is None or self.dir_pin is None:
                raise ValueError("CUTTER_PULSE_PIN and CUTTER_DIR_PIN are required")
            if DigitalOutputDevice is None:
                raise RuntimeError("gpiozero is unavailable")

            self._pulse = _SignalLine(self.pulse_pin, active_high=self.pulse_active_high)
            self._dir = _SignalLine(self.dir_pin, active_high=self.dir_active_high)
            self._enable = _SignalLine(self.enable_pin, active_high=self.enable_active_high)
            self._set_enabled(False)
            self.available = True
            logger.info(
                "stepper cutter ready pulse_pin=%s dir_pin=%s enable_pin=%s pulse_hz=%s down_steps=%s up_steps=%s",
                self.pulse_pin,
                self.dir_pin,
                self.enable_pin,
                self.pulse_hz,
                self.down_steps,
                self.up_steps,
            )
        except Exception as exc:
            self.error = str(exc)
            self.available = False
            logger.exception("stepper cutter init failed")
            self._pulse = _SignalLine(None, active_high=True)
            self._dir = _SignalLine(None, active_high=True)
            self._enable = _SignalLine(None, active_high=True)

    async def move_down(self) -> None:
        await asyncio.to_thread(self._move_sync, True, self.down_steps)

    async def move_up(self) -> None:
        await asyncio.to_thread(self._move_sync, False, self.up_steps)

    def close(self) -> None:
        self._set_enabled(False)
        self._pulse.close()
        self._dir.close()
        self._enable.close()

    def _move_sync(self, down: bool, steps: int) -> None:
        if not self.available:
            raise RuntimeError(self.error or "stepper cutter unavailable")

        half_period_s = max(0.0002, 0.5 / float(self.pulse_hz))
        direction_asserted = self.dir_down_value if down else (not self.dir_down_value)

        with self._lock:
            self._set_enabled(True)
            if self.enable_setup_ms > 0:
                time.sleep(self.enable_setup_ms / 1000.0)

            self._dir.write(direction_asserted)
            if self.dir_setup_ms > 0:
                time.sleep(self.dir_setup_ms / 1000.0)

            for _ in range(max(1, steps)):
                self._pulse.pulse(half_period_s)

            if self.disable_after_move:
                self._set_enabled(False)

    def _set_enabled(self, enabled: bool) -> None:
        if not self._enable.available:
            return
        self._enable.write(enabled)

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
