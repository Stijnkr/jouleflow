"""Samples the meter driver once per second and persists the data in batches."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from .drivers.base import MeterDriver, MeterReading
from .storage import Storage

log = logging.getLogger(__name__)


class Collector:
    def __init__(
        self,
        driver: MeterDriver | None,
        storage: Storage,
        *,
        flush_interval: float,
        raw_retention_days: int,
        minute_retention_days: int,
    ) -> None:
        self.driver = driver
        self.storage = storage
        self.flush_interval = flush_interval
        self.raw_retention_days = raw_retention_days
        self.minute_retention_days = minute_retention_days
        self.latest: MeterReading | None = None
        self._buffer: list[MeterReading] = []
        self._driver_task: asyncio.Task | None = None

    async def run(self) -> None:
        await asyncio.to_thread(self.storage.rollup_all, time.time())
        self._start_driver()
        tasks = [
            asyncio.create_task(self._sample_loop(), name="sampler"),
            asyncio.create_task(self._maintenance_loop(), name="maintenance"),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self._stop_driver()
            await self.flush()

    async def set_driver(self, driver: MeterDriver | None) -> None:
        """Switch to another meter driver without restarting."""
        await self._stop_driver()
        await self.flush()
        self.driver = driver
        self.latest = None
        self._start_driver()

    def _start_driver(self) -> None:
        if self.driver is not None:
            self._driver_task = asyncio.create_task(self.driver.run(), name="driver")

    async def _stop_driver(self) -> None:
        task, self._driver_task = self._driver_task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _sample_loop(self) -> None:
        last_flush = time.monotonic()
        while True:
            # Align to whole seconds so each sample gets its own timestamp.
            await asyncio.sleep(1 - (time.time() % 1) + 0.05)
            reading = self.driver.snapshot() if self.driver else None
            if reading is not None:
                self.latest = reading
                self._buffer.append(reading)
            if time.monotonic() - last_flush >= self.flush_interval:
                last_flush = time.monotonic()
                await self.flush()

    async def flush(self) -> None:
        if not self._buffer:
            return
        batch, self._buffer = self._buffer, []
        try:
            await asyncio.to_thread(self.storage.insert_samples, batch)
        except Exception:
            log.exception("Failed to store %d samples", len(batch))
            self._buffer = batch + self._buffer

    async def _maintenance_loop(self) -> None:
        last_retention = 0.0
        while True:
            # Run a few seconds after each minute boundary.
            await asyncio.sleep(60 - (time.time() % 60) + 3)
            try:
                await self.flush()
                await asyncio.to_thread(self.storage.rollup_all, time.time())
                if time.time() - last_retention > 3600:
                    last_retention = time.time()
                    await asyncio.to_thread(
                        self.storage.apply_retention,
                        time.time(),
                        self.raw_retention_days,
                        self.minute_retention_days,
                    )
            except Exception:
                log.exception("Maintenance failed")
