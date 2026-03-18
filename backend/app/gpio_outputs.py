from __future__ import annotations

import os
from typing import Protocol


class _OutputDriver(Protocol):
    def write(self, value: bool) -> None: ...

    def write_count(self, active_leds: int) -> None: ...

    def close(self) -> None: ...


class _NoopDriver:
    def write(self, value: bool) -> None:
        return

    def write_count(self, active_leds: int) -> None:
        return

    def close(self) -> None:
        return


class _Ws2812Driver:
    def __init__(self, pin: int, led_count: int, brightness: int) -> None:
        if pin != 10:
            raise ValueError("Raspberry Pi 5 SPI WS2812 requires GPIO10 / MOSI / pin 19")

        from rpi5_ws2812.ws2812 import Color, WS2812SpiDriver  # type: ignore[import-not-found]

        self._Color = Color
        self._led_count = led_count
        self._brightness = max(0, min(brightness, 255))
        self._strip = WS2812SpiDriver(spi_bus=0, spi_device=0, led_count=led_count).get_strip()
        self.write(False)

    def write(self, value: bool) -> None:
        self.write_count(self._led_count if value else 0)

    def write_count(self, active_leds: int) -> None:
        count = max(0, min(active_leds, self._led_count))
        on_color = self._Color(self._brightness, self._brightness, self._brightness)
        off_color = self._Color(0, 0, 0)
        for index in range(self._led_count):
            self._strip.set_pixel(index, on_color if index < count else off_color)
        self._strip.show()

    def close(self) -> None:
        self.write(False)


class LightController:
    def __init__(self) -> None:
        self.pin = int(os.getenv("LIGHT_GPIO_PIN", "10"))
        self.led_count = int(os.getenv("LIGHT_LED_COUNT", "16"))
        self.brightness = int(os.getenv("LIGHT_BRIGHTNESS", "255"))
        self.available = False
        self.driver_name = "noop"
        self.error: str | None = None
        self._is_on = False
        self._driver: _OutputDriver = self._build_driver()

    @property
    def is_on(self) -> bool:
        return self._is_on

    def reset(self) -> bool:
        self.write_count(0)
        return self._is_on

    def set_on(self, enabled: bool) -> bool:
        self.write_count(self.led_count if enabled else 0)
        return self._is_on

    def write_count(self, active_leds: int) -> int:
        count = max(0, min(active_leds, self.led_count))
        self._driver.write_count(count)
        self._is_on = count > 0
        return count

    def close(self) -> None:
        self._driver.close()

    def _build_driver(self) -> _OutputDriver:
        try:
            driver = _Ws2812Driver(self.pin, self.led_count, self.brightness)
            self.available = True
            self.driver_name = "ws2812_spi"
            self.error = None
            return driver
        except Exception as exc:
            self.available = False
            self.driver_name = "noop"
            self.error = str(exc)
            return _NoopDriver()
