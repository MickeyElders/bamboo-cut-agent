from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

try:
    from gpiozero import DigitalInputDevice  # type: ignore
except Exception:
    DigitalInputDevice = None


@dataclass(slots=True)
class InputSignalState:
    key: str
    label: str
    pin: int | None
    active: bool | None
    available: bool
    pull_up: bool
    active_high: bool
    detail: str


class _InputChannel:
    def __init__(self, key: str, label: str, env_name: str, *, default_pin: str = "", pull_up: bool = True, active_high: bool = False) -> None:
        self.key = key
        self.label = label
        self.pin = self._parse_pin(os.getenv(env_name, default_pin))
        self.pull_up = pull_up
        self.active_high = active_high
        self.available = False
        self.detail = "未配置"
        self._device = None

        if self.pin is None:
            return
        if DigitalInputDevice is None:
            self.detail = "gpiozero 不可用"
            return

        try:
            self._device = DigitalInputDevice(self.pin, pull_up=pull_up)
            self.available = True
            self.detail = "输入已就绪"
        except Exception as exc:
            self.detail = str(exc)
            logger.exception("gpio input init failed key=%s pin=%s", self.key, self.pin)

    def read(self) -> InputSignalState:
        if not self.available or self._device is None:
            return InputSignalState(
                key=self.key,
                label=self.label,
                pin=self.pin,
                active=None,
                available=False,
                pull_up=self.pull_up,
                active_high=self.active_high,
                detail=self.detail,
            )

        raw_active = bool(self._device.value)
        active = raw_active if self.active_high else not raw_active
        return InputSignalState(
            key=self.key,
            label=self.label,
            pin=self.pin,
            active=active,
            available=True,
            pull_up=self.pull_up,
            active_high=self.active_high,
            detail="正常",
        )

    def close(self) -> None:
        if self._device is None:
            return
        try:
            self._device.close()
        except Exception:
            logger.exception("gpio input close failed key=%s pin=%s", self.key, self.pin)

    @staticmethod
    def _parse_pin(value: str | None) -> int | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            return None
        try:
            return int(text)
        except ValueError:
            logger.warning("invalid gpio input pin value=%s", value)
            return None


class InputMonitor:
    def __init__(self) -> None:
        self._channels = [
            _InputChannel("canmv_cut_request", "CanMV 切割触发", "CANMV_CUT_REQUEST_INPUT_PIN", pull_up=False, active_high=True),
            _InputChannel("feed_home", "送料到位", "FEED_HOME_INPUT_PIN"),
            _InputChannel("clamp_closed", "压紧到位", "CLAMP_CLOSED_INPUT_PIN"),
            _InputChannel("cutter_up", "刀片上位", "CUTTER_UP_INPUT_PIN"),
            _InputChannel("cutter_down", "刀片下位", "CUTTER_DOWN_INPUT_PIN"),
            _InputChannel("estop", "急停回路", "ESTOP_INPUT_PIN"),
        ]

    def snapshot(self) -> list[InputSignalState]:
        return [channel.read() for channel in self._channels]

    def read(self, key: str) -> InputSignalState | None:
        for channel in self._channels:
            if channel.key == key:
                return channel.read()
        return None

    def is_available(self, key: str) -> bool:
        state = self.read(key)
        return bool(state and state.available)

    def available_count(self) -> int:
        return sum(1 for channel in self._channels if channel.available)

    def close(self) -> None:
        for channel in self._channels:
            channel.close()
