from __future__ import annotations

import asyncio
import logging
import os
import time

from .modbus_rtu import ModbusError, ModbusRtuClient

logger = logging.getLogger(__name__)


class DkcY3x0Cutter:
    driver_name = "dkc_y3x0_modbus"

    def __init__(self) -> None:
        self.serial_port = (os.getenv("DKC_SERIAL_PORT") or "").strip()
        self.baudrate = int(os.getenv("DKC_BAUDRATE", "9600"))
        self.slave_id = int(os.getenv("DKC_SLAVE_ID", "1"))
        self.timeout_ms = max(50, int(os.getenv("DKC_TIMEOUT_MS", "300")))
        self.trigger_pulse_ms = max(20, int(os.getenv("DKC_TRIGGER_PULSE_MS", "120")))
        self.low_word_first = str(os.getenv("DKC_WORD_ORDER", "0")).strip() != "1"
        self.position_scale = max(1.0, float(os.getenv("DKC_POSITION_SCALE", "1000")))

        # Backward compatibility: older code used D1 / D11 names for axis feedback.
        self.position_d = self._parse_optional_int(os.getenv("DKC_AXIS_POSITION_D") or os.getenv("DKC_AXIS_TARGET_D"), default=1)
        self.speed_feedback_d = self._parse_optional_int(os.getenv("DKC_AXIS_SPEED_FEEDBACK_D") or os.getenv("DKC_AXIS_SPEED_D"), default=11)

        self.down_target_d = self._parse_optional_int(os.getenv("DKC_CUTTER_DOWN_TARGET_D"), default=30)
        self.down_speed_d = self._parse_optional_int(os.getenv("DKC_CUTTER_DOWN_SPEED_D"), default=31)
        self.up_target_d = self._parse_optional_int(os.getenv("DKC_CUTTER_UP_TARGET_D"), default=32)
        self.up_speed_d = self._parse_optional_int(os.getenv("DKC_CUTTER_UP_SPEED_D"), default=33)
        self.zero_target_d = self._parse_optional_int(os.getenv("DKC_CUTTER_ZERO_TARGET_D"), default=34)

        self.down_default_speed = max(1, int(os.getenv("DKC_CUTTER_DOWN_SPEED", "10000")))
        self.up_default_speed = max(1, int(os.getenv("DKC_CUTTER_UP_SPEED", "10000")))

        self.down_trigger_m = self._parse_optional_int(os.getenv("DKC_CUTTER_DOWN_M"), default=1)
        self.up_trigger_m = self._parse_optional_int(os.getenv("DKC_CUTTER_UP_M"), default=2)
        self.zero_trigger_m = self._parse_optional_int(os.getenv("DKC_CUTTER_ZERO_M"), default=3)
        self.busy_m = self._parse_optional_int(os.getenv("DKC_CUTTER_BUSY_M"), default=10)
        self.done_m = self._parse_optional_int(os.getenv("DKC_CUTTER_DONE_M"), default=11)
        self.fault_m = self._parse_optional_int(os.getenv("DKC_CUTTER_FAULT_M"), default=12)

        self.available = False
        self.error: str | None = None
        self._client = ModbusRtuClient(
            port=self.serial_port,
            baudrate=self.baudrate,
            slave_id=self.slave_id,
            timeout_s=self.timeout_ms / 1000.0,
        )

        try:
            if not self.serial_port:
                raise ValueError("DKC_SERIAL_PORT is required")
            if self.down_target_d is None or self.down_speed_d is None or self.up_target_d is None or self.up_speed_d is None or self.zero_target_d is None:
                raise ValueError("DKC target D registers are incomplete")
            if self.down_trigger_m is None or self.up_trigger_m is None or self.zero_trigger_m is None:
                raise ValueError("DKC cutter trigger M bits are incomplete")
            if not self._client.available:
                raise ValueError(self._client.error or "modbus client unavailable")

            self.available = True
            logger.info(
                "dkc y3x0 cutter ready port=%s baudrate=%s slave_id=%s pos_d=%s down=(D%s/D%s,M%s) up=(D%s/D%s,M%s) zero=(D%s,M%s)",
                self.serial_port,
                self.baudrate,
                self.slave_id,
                self.position_d,
                self.down_target_d,
                self.down_speed_d,
                self.down_trigger_m,
                self.up_target_d,
                self.up_speed_d,
                self.up_trigger_m,
                self.zero_target_d,
                self.zero_trigger_m,
            )
        except Exception as exc:
            self.available = False
            self.error = str(exc)
            logger.exception("dkc y3x0 cutter init failed")

    async def move_down(self) -> None:
        # Legacy trigger-only fallback.
        await asyncio.to_thread(self._trigger_program, self.down_trigger_m, "down")

    async def move_up(self) -> None:
        # Legacy trigger-only fallback.
        await asyncio.to_thread(self._trigger_program, self.up_trigger_m, "up")

    async def move_down_to(self, target_position_mm: float, *, speed_hz: int | None = None) -> float | None:
        return await asyncio.to_thread(
            self._move_absolute,
            target_position_mm,
            speed_hz or self.down_default_speed,
            self.down_target_d,
            self.down_speed_d,
            self.down_trigger_m,
            "down",
        )

    async def move_up_to(self, target_position_mm: float, *, speed_hz: int | None = None) -> float | None:
        return await asyncio.to_thread(
            self._move_absolute,
            target_position_mm,
            speed_hz or self.up_default_speed,
            self.up_target_d,
            self.up_speed_d,
            self.up_trigger_m,
            "up",
        )

    async def set_zero_position(self, position_mm: float = 0.0) -> float | None:
        return await asyncio.to_thread(self._set_zero_position_sync, position_mm)

    async def read_position_mm(self) -> float | None:
        return await asyncio.to_thread(self._read_position_mm_sync)

    async def read_fault_active(self) -> bool | None:
        return await asyncio.to_thread(self._read_fault_active_sync)

    async def read_busy_active(self) -> bool | None:
        return await asyncio.to_thread(self._read_busy_active_sync)

    def close(self) -> None:
        self._client.close()

    def _move_absolute(
        self,
        target_position_mm: float,
        speed_hz: int,
        target_d: int | None,
        speed_d: int | None,
        trigger_m: int | None,
        label: str,
    ) -> float | None:
        self._ensure_ready()
        if target_d is None or speed_d is None:
            raise RuntimeError(f"missing DKC registers for {label}")

        self._guard_fault()
        self._client.write_d_int32(speed_d, int(speed_hz), low_word_first=self.low_word_first)
        self._client.write_d_int32(target_d, self._encode_position_mm(target_position_mm), low_word_first=self.low_word_first)
        self._trigger_program(trigger_m, label)
        return self._read_position_mm_sync()

    def _set_zero_position_sync(self, position_mm: float) -> float | None:
        self._ensure_ready()
        if self.zero_target_d is None:
            raise RuntimeError("missing DKC zero target register")

        self._guard_fault()
        self._client.write_d_int32(self.zero_target_d, self._encode_position_mm(position_mm), low_word_first=self.low_word_first)
        self._trigger_program(self.zero_trigger_m, "zero")
        return self._read_position_mm_sync()

    def _trigger_program(self, bit_index: int | None, label: str) -> None:
        self._ensure_ready()
        if bit_index is None:
            raise RuntimeError(f"missing DKC trigger M bit for {label}")

        self._client.write_m(bit_index, True)
        time.sleep(self.trigger_pulse_ms / 1000.0)
        self._client.write_m(bit_index, False)
        self._wait_for_completion()

    def _wait_for_completion(self) -> None:
        if self.busy_m is None and self.done_m is None:
            return

        deadline = time.time() + max(1.0, self.timeout_ms / 1000.0 * 12)
        saw_busy = self.busy_m is None
        while time.time() < deadline:
            busy_active = False
            done_active = False

            if self.busy_m is not None:
                busy_active = self._client.read_m(self.busy_m)
                if busy_active:
                    saw_busy = True
            if self.done_m is not None:
                done_active = self._client.read_m(self.done_m)
            if self.fault_m is not None and self._client.read_m(self.fault_m):
                raise RuntimeError(f"DKC fault bit M{self.fault_m} is active")

            if self.done_m is not None and done_active:
                return
            if self.busy_m is not None and saw_busy and not busy_active:
                return

            time.sleep(0.03)

        raise RuntimeError("timeout waiting for DKC program completion")

    def _read_position_mm_sync(self) -> float | None:
        self._ensure_ready()
        if self.position_d is None:
            return None
        raw = self._client.read_d_int32(self.position_d, low_word_first=self.low_word_first)
        return round(raw / self.position_scale, 4)

    def _read_fault_active_sync(self) -> bool | None:
        self._ensure_ready()
        if self.fault_m is None:
            return None
        return bool(self._client.read_m(self.fault_m))

    def _read_busy_active_sync(self) -> bool | None:
        self._ensure_ready()
        if self.busy_m is None:
            return None
        return bool(self._client.read_m(self.busy_m))

    def _guard_fault(self) -> None:
        try:
            fault_active = self._read_fault_active_sync()
        except ModbusError as exc:
            self.error = str(exc)
            raise RuntimeError(f"failed to read DKC fault state: {exc}") from exc
        if fault_active:
            raise RuntimeError(f"DKC fault bit M{self.fault_m} is active")

    def _ensure_ready(self) -> None:
        if not self.available:
            raise RuntimeError(self.error or "dkc y3x0 cutter unavailable")

    def _encode_position_mm(self, position_mm: float) -> int:
        return int(round(float(position_mm) * self.position_scale))

    @staticmethod
    def _parse_optional_int(value: str | None, default: int | None = None) -> int | None:
        if value is None:
            return default
        text = value.strip()
        if not text:
            return default
        return int(text)
