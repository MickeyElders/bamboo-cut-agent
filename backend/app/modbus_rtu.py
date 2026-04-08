from __future__ import annotations

import logging
import threading
from typing import Iterable

logger = logging.getLogger(__name__)

try:
    import serial  # type: ignore
except Exception:
    serial = None


class ModbusError(RuntimeError):
    pass


class ModbusRtuClient:
    def __init__(
        self,
        *,
        port: str | None,
        baudrate: int = 9600,
        slave_id: int = 1,
        timeout_s: float = 0.3,
    ) -> None:
        self.port = (port or "").strip()
        self.baudrate = baudrate
        self.slave_id = max(0, min(255, int(slave_id)))
        self.timeout_s = max(0.05, float(timeout_s))
        self.available = False
        self.error: str | None = None
        self._lock = threading.Lock()
        self._serial = None

        if serial is None:
            self.error = "pyserial is unavailable"
            return
        if not self.port:
            self.error = "DKC_SERIAL_PORT is required"
            return

        self.available = True

    def close(self) -> None:
        with self._lock:
            if self._serial is not None:
                try:
                    self._serial.close()
                except Exception:
                    logger.exception("failed to close modbus serial port")
                finally:
                    self._serial = None

    def read_coils(self, address: int, count: int) -> list[bool]:
        if count <= 0:
            raise ValueError("coil count must be positive")

        request = self._build_request(0x01, self._u16(address), self._u16(count))
        byte_count = (count + 7) // 8
        response = self._exchange(request, expected_fn=0x01, expected_length=5 + byte_count)
        payload = response[3 : 3 + byte_count]
        result: list[bool] = []
        for index in range(count):
            result.append(bool(payload[index // 8] & (1 << (index % 8))))
        return result

    def write_single_coil(self, address: int, value: bool) -> None:
        request = self._build_request(0x05, self._u16(address), 0xFF00 if value else 0x0000)
        self._exchange(request, expected_fn=0x05, expected_length=8)

    def read_holding_registers(self, address: int, count: int) -> list[int]:
        if count <= 0:
            raise ValueError("register count must be positive")

        request = self._build_request(0x03, self._u16(address), self._u16(count))
        response = self._exchange(request, expected_fn=0x03, expected_length=5 + count * 2)
        byte_count = response[2]
        if byte_count != count * 2:
            raise ModbusError(f"unexpected register payload length: {byte_count}")

        values: list[int] = []
        for offset in range(3, 3 + byte_count, 2):
            values.append((response[offset] << 8) | response[offset + 1])
        return values

    def write_holding_registers(self, address: int, values: Iterable[int]) -> None:
        registers = [self._u16(item) for item in values]
        if not registers:
            raise ValueError("register values must not be empty")

        payload = bytearray()
        for value in registers:
            payload.extend(((value >> 8) & 0xFF, value & 0xFF))

        request = bytearray(
            [
                self.slave_id,
                0x10,
                (address >> 8) & 0xFF,
                address & 0xFF,
                (len(registers) >> 8) & 0xFF,
                len(registers) & 0xFF,
                len(payload),
            ]
        )
        request.extend(payload)
        self._append_crc(request)
        self._exchange(bytes(request), expected_fn=0x10, expected_length=8)

    def read_m(self, index: int) -> bool:
        return self.read_coils(self.m_address(index), 1)[0]

    def write_m(self, index: int, value: bool) -> None:
        self.write_single_coil(self.m_address(index), value)

    def read_d_int32(self, index: int, *, low_word_first: bool = True) -> int:
        registers = self.read_holding_registers(self.d_address(index), 2)
        raw = self._decode_u32(registers, low_word_first=low_word_first)
        if raw & 0x80000000:
            return raw - 0x100000000
        return raw

    def write_d_int32(self, index: int, value: int, *, low_word_first: bool = True) -> None:
        raw = int(value) & 0xFFFFFFFF
        self.write_holding_registers(self.d_address(index), self._encode_u32(raw, low_word_first=low_word_first))

    @staticmethod
    def m_address(index: int) -> int:
        if index < 1:
            raise ValueError("M register index must be >= 1")
        return 2001 + (index - 1)

    @staticmethod
    def d_address(index: int) -> int:
        if index < 1:
            raise ValueError("D register index must be >= 1")
        return 3001 + (index - 1) * 2

    def _exchange(self, request: bytes, *, expected_fn: int, expected_length: int) -> bytes:
        if not self.available:
            raise ModbusError(self.error or "modbus client unavailable")

        with self._lock:
            ser = self._ensure_open()
            try:
                ser.reset_input_buffer()
                ser.reset_output_buffer()
                ser.write(request)
                ser.flush()
                response = self._read_exact(ser, expected_length)
            except Exception as exc:
                self.error = str(exc)
                try:
                    if self._serial is not None:
                        self._serial.close()
                except Exception:
                    logger.exception("failed to reset modbus serial port after exchange error")
                finally:
                    self._serial = None
                raise ModbusError(f"modbus exchange failed: {exc}") from exc

        self._verify_crc(response)
        if response[0] != self.slave_id:
            raise ModbusError(f"unexpected slave id: {response[0]}")

        fn = response[1]
        if fn == (expected_fn | 0x80):
            raise ModbusError(f"modbus exception code: {response[2]}")
        if fn != expected_fn:
            raise ModbusError(f"unexpected function code: {fn}")

        return response

    def _ensure_open(self):
        if self._serial is not None and getattr(self._serial, "is_open", False):
            return self._serial

        self._serial = serial.Serial(
            self.port,
            self.baudrate,
            timeout=self.timeout_s,
            write_timeout=self.timeout_s,
            bytesize=8,
            parity="N",
            stopbits=1,
        )
        self.error = None
        return self._serial

    @staticmethod
    def _read_exact(ser, expected_length: int) -> bytes:
        remaining = expected_length
        chunks: list[bytes] = []
        while remaining > 0:
            chunk = ser.read(remaining)
            if not chunk:
                raise TimeoutError(f"timeout waiting for modbus response, missing {remaining} bytes")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _build_request(self, function: int, address: int, value: int) -> bytes:
        frame = bytearray(
            [
                self.slave_id,
                function,
                (address >> 8) & 0xFF,
                address & 0xFF,
                (value >> 8) & 0xFF,
                value & 0xFF,
            ]
        )
        self._append_crc(frame)
        return bytes(frame)

    @staticmethod
    def _append_crc(frame: bytearray) -> None:
        crc = ModbusRtuClient._crc16(frame)
        frame.extend((crc & 0xFF, (crc >> 8) & 0xFF))

    @staticmethod
    def _verify_crc(frame: bytes) -> None:
        if len(frame) < 4:
            raise ModbusError("response too short")
        actual = frame[-2] | (frame[-1] << 8)
        expected = ModbusRtuClient._crc16(frame[:-2])
        if actual != expected:
            raise ModbusError(f"crc mismatch: expected={expected:#06x} actual={actual:#06x}")

    @staticmethod
    def _crc16(data: bytes | bytearray) -> int:
        crc = 0xFFFF
        for byte in data:
            crc ^= byte
            for _ in range(8):
                if crc & 1:
                    crc = (crc >> 1) ^ 0xA001
                else:
                    crc >>= 1
        return crc & 0xFFFF

    @staticmethod
    def _u16(value: int) -> int:
        value = int(value)
        if value < 0 or value > 0xFFFF:
            raise ValueError(f"value out of uint16 range: {value}")
        return value

    @staticmethod
    def _decode_u32(registers: list[int], *, low_word_first: bool) -> int:
        if len(registers) != 2:
            raise ValueError("uint32 decoding requires exactly two registers")
        low, high = (registers[0], registers[1]) if low_word_first else (registers[1], registers[0])
        return ((high & 0xFFFF) << 16) | (low & 0xFFFF)

    @staticmethod
    def _encode_u32(value: int, *, low_word_first: bool) -> list[int]:
        low = value & 0xFFFF
        high = (value >> 16) & 0xFFFF
        return [low, high] if low_word_first else [high, low]
