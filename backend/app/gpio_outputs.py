from __future__ import annotations

import os
from typing import Protocol


class _OutputDriver(Protocol):
    def write(self, value: bool) -> None: ...

    def close(self) -> None: ...


class _NoopDriver:
    def write(self, value: bool) -> None:
        return

    def close(self) -> None:
        return


class _GpioZeroDriver:
    def __init__(self, pin: int, active_high: bool) -> None:
        from gpiozero import PWMOutputDevice  # type: ignore[import-not-found]

        self._device = PWMOutputDevice(pin=pin, active_high=active_high, initial_value=0.0)

    def write(self, value: bool) -> None:
        self._device.value = 1.0 if value else 0.0

    def close(self) -> None:
        self._device.value = 0.0
        self._device.close()


class LightController:
    def __init__(self) -> None:
        self.pin = int(os.getenv("LIGHT_GPIO_PIN", "18"))
        self.active_high = os.getenv("LIGHT_ACTIVE_HIGH", "1").lower() not in {"0", "false", "no"}
        self.available = False
        self._is_on = False
        self._driver: _OutputDriver = self._build_driver()

    @property
    def is_on(self) -> bool:
        return self._is_on

    def reset(self) -> bool:
        return self.set_on(False)

    def set_on(self, enabled: bool) -> bool:
        self._driver.write(enabled)
        self._is_on = enabled
        return self._is_on

    def close(self) -> None:
        self._driver.close()

    def _build_driver(self) -> _OutputDriver:
        try:
            driver = _GpioZeroDriver(self.pin, self.active_high)
            self.available = True
            return driver
        except Exception:
            self.available = False
            return _NoopDriver()
