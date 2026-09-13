"""The P1 meter drivers Jouleflow knows about.

To add a driver, implement `MeterDriver` and register its class in `DRIVERS`.
Entries in `PLANNED` are shown in the web app as "coming soon".
"""

from __future__ import annotations

from dataclasses import asdict

from .base import DriverInfo, MeterDriver
from .esphome_p1 import EspHomeP1Driver

DRIVERS: dict[str, type[MeterDriver]] = {
    EspHomeP1Driver.info.id: EspHomeP1Driver,
}

PLANNED: tuple[DriverInfo, ...] = (
    DriverInfo(
        id="homewizard",
        name="HomeWizard P1",
        description="HomeWizard Wi-Fi P1 meter, using its local API.",
        available=False,
    ),
    DriverInfo(
        id="serial",
        name="USB P1 cable",
        description="A P1 cable plugged straight into this device's USB port.",
        available=False,
    ),
)


def get_driver(driver_id: str) -> type[MeterDriver]:
    try:
        return DRIVERS[driver_id]
    except KeyError:
        raise ValueError(f"Unknown meter type: {driver_id}") from None


def list_drivers() -> list[dict]:
    return [asdict(d.info) for d in DRIVERS.values()] + [asdict(info) for info in PLANNED]
