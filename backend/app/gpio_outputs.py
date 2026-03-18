from __future__ import annotations

import logging
import os
from typing import Protocol

logger = logging.getLogger(__name__)


class _OutputDriver(Protocol):
    def write(self, value: bool) -> None: ...

    def write_count(self, active_leds: int) -> None: ...

    def configure(self, active_leds: int, brightness: int, red: int, green: int, blue: int) -> None: ...

    def close(self) -> None: ...


class _NoopDriver:
    def write(self, value: bool) -> None:
        logger.warning("light noop driver write called value=%s", value)
        return

    def write_count(self, active_leds: int) -> None:
        logger.warning("light noop driver write_count called active_leds=%s", active_leds)
        return

    def configure(self, active_leds: int, brightness: int, red: int, green: int, blue: int) -> None:
        logger.warning(
            "light noop driver configure called active_leds=%s brightness=%s rgb=(%s,%s,%s)",
            active_leds,
            brightness,
            red,
            green,
            blue,
        )
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
        self._red = self._brightness
        self._green = self._brightness
        self._blue = self._brightness
        self._strip = WS2812SpiDriver(spi_bus=0, spi_device=0, led_count=led_count).get_strip()
        if hasattr(self._strip, "set_brightness"):
            self._strip.set_brightness(self._brightness / 255.0)
        elif hasattr(self._strip, "brightness"):
            self._strip.brightness = self._brightness / 255.0
        logger.info(
            "ws2812 spi driver ready pin=%s led_count=%s brightness=%s",
            pin,
            led_count,
            self._brightness,
        )
        self.write(False)

    def write(self, value: bool) -> None:
        self.write_count(self._led_count if value else 0)

    def write_count(self, active_leds: int) -> None:
        self.configure(active_leds, self._brightness, self._red, self._green, self._blue)

    def configure(self, active_leds: int, brightness: int, red: int, green: int, blue: int) -> None:
        count = max(0, min(active_leds, self._led_count))
        self._brightness = max(0, min(brightness, 255))
        scale = self._brightness / 255.0
        self._red = max(0, min(red, 255))
        self._green = max(0, min(green, 255))
        self._blue = max(0, min(blue, 255))
        on_color = self._Color(int(self._red * scale), int(self._green * scale), int(self._blue * scale))
        off_color = self._Color(0, 0, 0)
        self._strip.set_all_pixels(off_color)
        for index in range(count):
            self._strip.set_pixel_color(index, on_color)
        self._strip.show()
        logger.info(
            "ws2812 spi render active_leds=%s total_leds=%s brightness=%s rgb=(%s,%s,%s)",
            count,
            self._led_count,
            self._brightness,
            self._red,
            self._green,
            self._blue,
        )

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
        self.red = 255
        self.green = 255
        self.blue = 255
        self._driver: _OutputDriver = self._build_driver()
        logger.info(
            "light controller initialized driver=%s available=%s pin=%s led_count=%s brightness=%s error=%s",
            self.driver_name,
            self.available,
            self.pin,
            self.led_count,
            self.brightness,
            self.error,
        )

    @property
    def is_on(self) -> bool:
        return self._is_on

    def reset(self) -> bool:
        logger.info("light reset")
        self.write_count(0)
        return self._is_on

    def set_on(self, enabled: bool) -> bool:
        logger.info("light set_on enabled=%s", enabled)
        self.write_count(self.led_count if enabled else 0)
        return self._is_on

    def write_count(self, active_leds: int) -> int:
        count = max(0, min(active_leds, self.led_count))
        logger.info("light write_count requested=%s clamped=%s", active_leds, count)
        self._driver.write_count(count)
        self._is_on = count > 0
        return count

    def configure(self, active_leds: int, brightness: int, red: int, green: int, blue: int) -> int:
        count = max(0, min(active_leds, self.led_count))
        self.brightness = max(0, min(brightness, 255))
        self.red = max(0, min(red, 255))
        self.green = max(0, min(green, 255))
        self.blue = max(0, min(blue, 255))
        logger.info(
            "light configure count=%s brightness=%s rgb=(%s,%s,%s)",
            count,
            self.brightness,
            self.red,
            self.green,
            self.blue,
        )
        self._driver.configure(count, self.brightness, self.red, self.green, self.blue)
        self._is_on = count > 0
        return count

    def close(self) -> None:
        logger.info("light controller close")
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
            logger.exception("light driver init failed")
            return _NoopDriver()
