from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class MeterReading:
    """A snapshot of a smart meter at one moment. Power in W, energy in kWh, gas in m³."""

    ts: int
    # Net grid power split by direction: at most one of the two is non-zero.
    power_import: float
    power_export: float
    # Net power per phase (import minus export), W.
    power_l1: float | None = None
    power_l2: float | None = None
    power_l3: float | None = None
    voltage_l1: float | None = None
    voltage_l2: float | None = None
    voltage_l3: float | None = None
    current_l1: float | None = None
    current_l2: float | None = None
    current_l3: float | None = None
    # Cumulative meter counters.
    energy_import_t1: float | None = None
    energy_import_t2: float | None = None
    energy_export_t1: float | None = None
    energy_export_t2: float | None = None
    gas: float | None = None

    @property
    def power_net(self) -> float:
        return self.power_import - self.power_export


@dataclass(slots=True)
class DeviceStatus:
    id: str
    name: str
    kind: str
    connection: str
    connected: bool = False
    last_update: float | None = None
    error: str | None = None
    details: dict[str, Any] = field(default_factory=dict)


class MeterDriver(ABC):
    """Interface every smart-meter driver implements.

    A driver keeps its own connection alive in `run()` and exposes the most recent
    reading through `snapshot()`. The collector samples it at a fixed interval.
    """

    stale_after: float = 15.0

    @abstractmethod
    async def run(self) -> None:
        """Connect and keep receiving data until cancelled. Must handle reconnects itself."""

    @abstractmethod
    def snapshot(self) -> MeterReading | None:
        """Latest complete reading, or None when no fresh data is available."""

    @abstractmethod
    def status(self) -> DeviceStatus: ...

    def is_fresh(self, last_update: float | None) -> bool:
        return last_update is not None and time.time() - last_update < self.stale_after
