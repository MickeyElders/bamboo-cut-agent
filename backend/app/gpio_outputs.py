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


class _Ws2812Driver:
    def __init__(self, pin: int, led_count: int, brightness: int) -> None:
        from rpi_ws281x import Color, PixelStrip  # type: ignore[import-not-found]

        self._Color = Color
        self._led_count = led_count
        self._strip = PixelStrip(
            num=led_count,
            pin=pin,
            freq_hz=800000,
            dma=10,
            invert=False,
            brightness=max(0, min(brightness, 255)),
            channel=0,
        )
        self._strip.begin()
        self.write(False)

    def write(self, value: bool) -> None:
        color = self._Color(255, 255, 255) if value else self._Color(0, 0, 0)
        for index in range(self._led_count):
            self._strip.setPixelColor(index, color)
        self._strip.show()

    def close(self) -> None:
        self.write(False)


class LightController:
    def __init__(self) -> None:
        self.pin = int(os.getenv("LIGHT_GPIO_PIN", "18"))
        self.led_count = int(os.getenv("LIGHT_LED_COUNT", "16"))
        self.brightness = int(os.getenv("LIGHT_BRIGHTNESS", "255"))
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
            driver = _Ws2812Driver(self.pin, self.led_count, self.brightness)
            self.available = True
            return driver
        except Exception:
            self.available = False
            return _NoopDriver()
