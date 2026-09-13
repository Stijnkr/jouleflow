"""P1 driver for ESPHome-based meter readers (e.g. the SlimmeLezer).

ESPHome's web server exposes a Server-Sent Events stream at `/events`. On connect it
sends the state of every entity, after which it pushes updates as the meter sends new
telegrams (every second for DSMR 5).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import httpx

from .base import DeviceStatus, DriverField, DriverInfo, MeterDriver, MeterReading, ProbeError

log = logging.getLogger(__name__)

# ESPHome reports power in kW; Jouleflow stores W.
KW = 1000.0
PROBE_TIMEOUT = 8.0


def normalize_url(host: str) -> str:
    host = host.strip().rstrip("/")
    if not host:
        raise ValueError("Enter the IP address or hostname of your P1 reader")
    if "://" not in host:
        host = f"http://{host}"
    if not host.startswith(("http://", "https://")):
        raise ValueError("Only http:// and https:// addresses are supported")
    return host


class EspHomeP1Driver(MeterDriver):
    info = DriverInfo(
        id="esphome",
        name="SlimmeLezer / ESPHome",
        description="Wi-Fi P1 readers running ESPHome, such as the SlimmeLezer and SlimmeLezer+.",
        fields=(
            DriverField(
                key="host",
                label="IP address or hostname",
                placeholder="192.168.1.50 or slimmelezer.local",
                help=(
                    "Find it in your router or in the ESPHome app. "
                    "The reader's web server must be enabled."
                ),
            ),
        ),
    )

    def __init__(self, url: str, device_id: str = "p1") -> None:
        self.url = url.rstrip("/")
        self.device_id = device_id
        self._values: dict[str, Any] = {}
        self._last_update: float | None = None
        self._connected = False
        self._error: str | None = None

    @classmethod
    def from_options(cls, options: dict[str, str]) -> EspHomeP1Driver:
        return cls(normalize_url(options.get("host", "")))

    @classmethod
    async def probe(cls, options: dict[str, str]) -> dict[str, Any]:
        try:
            driver = cls.from_options(options)
        except ValueError as exc:
            raise ProbeError(str(exc), "invalid_address") from exc

        async def read(client: httpx.AsyncClient) -> None:
            async with client.stream("GET", f"{driver.url}/events") as response:
                if response.status_code == 404:
                    raise ProbeError(
                        "The device answered, but it doesn't look like an ESPHome reader "
                        "with the web server enabled.",
                        "not_esphome",
                    )
                response.raise_for_status()
                driver._connected = True
                event = ""
                async for line in response.aiter_lines():
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:") and event == "state":
                        driver.handle_state(line[5:].strip())
                        # ESPHome sends every entity on connect; the firmware version comes last.
                        if driver.snapshot() is not None and driver._text("esphome_version"):
                            return

        # Small ESPHome devices sometimes stall a new event stream while serving another
        # client (such as Jouleflow itself), so try twice before giving up.
        attempt_timeout = PROBE_TIMEOUT / 2
        async with httpx.AsyncClient(timeout=httpx.Timeout(attempt_timeout)) as client:
            for attempt in range(2):
                try:
                    await asyncio.wait_for(read(client), attempt_timeout)
                    break
                except ProbeError:
                    raise
                except (TimeoutError, httpx.TimeoutException) as exc:
                    if driver.snapshot() is not None:
                        break
                    if attempt == 1:
                        if driver._connected:
                            raise ProbeError(
                                "Connected to the reader, but no meter data came in. "
                                "Check that it is plugged into the P1 port of your smart meter.",
                                "no_data",
                            ) from exc
                        raise ProbeError(
                            f"No response from {driver.url}. Check the address.", "no_response"
                        ) from exc
                except httpx.HTTPError as exc:
                    raise ProbeError(
                        f"Could not connect to {driver.url}: {exc or 'connection failed'}",
                        "connect_failed",
                    ) from exc

        reading = driver.snapshot()
        status = driver.status()
        return {
            "url": driver.url,
            "meter_id": status.details.get("meter_id"),
            "dsmr_version": status.details.get("dsmr_version"),
            "power_net_w": reading.power_net if reading else None,
            "has_gas": status.details.get("has_gas"),
            "wifi_signal_dbm": status.details.get("wifi_signal_dbm"),
        }

    async def run(self) -> None:
        backoff = 1.0
        timeout = httpx.Timeout(10.0, read=30.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            while True:
                try:
                    async with client.stream("GET", f"{self.url}/events") as response:
                        response.raise_for_status()
                        self._connected = True
                        self._error = None
                        backoff = 1.0
                        log.info("Connected to P1 reader at %s", self.url)
                        await self._consume(response)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - keep the collector alive on any failure
                    self._error = str(exc) or exc.__class__.__name__
                    log.warning("P1 reader connection lost: %s", self._error)
                finally:
                    self._connected = False
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def _consume(self, response: httpx.Response) -> None:
        event = ""
        async for line in response.aiter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:") and event == "state":
                self.handle_state(line[5:].strip())

    def handle_state(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return
        entity = data.get("id")
        if not entity:
            return
        self._values[entity] = data.get("value")
        if entity in ("sensor-power_consumed", "sensor-power_produced"):
            self._last_update = time.time()

    def _num(self, key: str, scale: float = 1.0) -> float | None:
        value = self._values.get(f"sensor-{key}")
        if isinstance(value, (int, float)):
            return float(value) * scale
        return None

    def _phase_net(self, phase: int) -> float | None:
        consumed = self._num(f"power_consumed_phase_{phase}", KW)
        produced = self._num(f"power_produced_phase_{phase}", KW)
        if consumed is None and produced is None:
            return None
        return (consumed or 0.0) - (produced or 0.0)

    def snapshot(self) -> MeterReading | None:
        if not self.is_fresh(self._last_update):
            return None
        power_import = self._num("power_consumed", KW)
        power_export = self._num("power_produced", KW)
        if power_import is None or power_export is None:
            return None
        # The reader sums import and export per phase, so both can be non-zero at once
        # (e.g. solar exporting on L1 while L2 imports). The meter nets the phases, so
        # store the net grid power; per-phase detail stays in power_l1..l3.
        net = power_import - power_export
        return MeterReading(
            ts=int(time.time()),
            power_import=max(net, 0.0),
            power_export=max(-net, 0.0),
            power_l1=self._phase_net(1),
            power_l2=self._phase_net(2),
            power_l3=self._phase_net(3),
            voltage_l1=self._num("voltage_phase_1"),
            voltage_l2=self._num("voltage_phase_2"),
            voltage_l3=self._num("voltage_phase_3"),
            current_l1=self._num("current_phase_1"),
            current_l2=self._num("current_phase_2"),
            current_l3=self._num("current_phase_3"),
            energy_import_t1=self._num("energy_consumed_tariff_1"),
            energy_import_t2=self._num("energy_consumed_tariff_2"),
            energy_export_t1=self._num("energy_produced_tariff_1"),
            energy_export_t2=self._num("energy_produced_tariff_2"),
            gas=self._gas(),
            power_failures=self._int("electricity_failures"),
            long_power_failures=self._int("long_electricity_failures"),
        )

    def _int(self, key: str) -> int | None:
        value = self._num(key)
        return None if value is None else int(value)

    def _gas(self) -> float | None:
        gas = self._num("gas_consumed")
        return gas if gas is not None else self._num("gas_consumed_belgium")

    def _text(self, key: str) -> str | None:
        return self._values.get(f"text_sensor-{key}") or None

    def status(self) -> DeviceStatus:
        text = self._text
        host = self.url.removeprefix("http://")
        return DeviceStatus(
            id=self.device_id,
            name="P1 meter",
            kind="p1_meter",
            connection=f"{self.info.name} · {host}",
            driver=self.info.id,
            options={"host": host},
            connected=self._connected and self.is_fresh(self._last_update),
            last_update=self._last_update,
            error=self._error,
            details={
                "dsmr_version": text("dsmr_version"),
                "meter_id": text("dsmr_identification"),
                "wifi_signal_dbm": self._num("slimmelezer_wi-fi_signal"),
                "reader_uptime_s": self._num("slimmelezer_uptime"),
                "firmware": text("esphome_version"),
                "power_failures": self._num("electricity_failures"),
                "long_power_failures": self._num("long_electricity_failures"),
                "has_gas": self._gas() is not None,
            },
        )
