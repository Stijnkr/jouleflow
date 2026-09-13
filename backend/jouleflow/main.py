from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from collections.abc import AsyncIterator
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, queries
from .collector import Collector
from .config import Settings, settings
from .drivers import EspHomeP1Driver, MeterReading
from .storage import Storage

log = logging.getLogger("jouleflow")


def reading_to_dict(r: MeterReading) -> dict:
    return {
        "ts": r.ts,
        "power_import": r.power_import,
        "power_export": r.power_export,
        "power_net": r.power_net,
        "phases": [
            {"power": p, "voltage": v, "current": c}
            for p, v, c in (
                (r.power_l1, r.voltage_l1, r.current_l1),
                (r.power_l2, r.voltage_l2, r.current_l2),
                (r.power_l3, r.voltage_l3, r.current_l3),
            )
        ],
        "gas": r.gas,
    }


def system_info(storage_path: Path) -> dict:
    info: dict = {"version": __version__}
    with contextlib.suppress(OSError):
        info["db_size_bytes"] = sum(
            p.stat().st_size for p in storage_path.parent.glob(storage_path.name + "*")
        )
    with contextlib.suppress(OSError, ValueError):
        info["cpu_temp_c"] = round(
            int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000, 1
        )
    with contextlib.suppress(OSError):
        st = os.statvfs(storage_path.parent)
        info["disk_free_bytes"] = st.f_bavail * st.f_frsize
        info["disk_total_bytes"] = st.f_blocks * st.f_frsize
    with contextlib.suppress(OSError, ValueError):
        info["uptime_s"] = int(float(Path("/proc/uptime").read_text().split()[0]))
    with contextlib.suppress(OSError):
        info["model"] = Path("/proc/device-tree/model").read_text().strip("\x00").strip()
    return info


def create_app(cfg: Settings = settings) -> FastAPI:
    storage = Storage(cfg.db_path, cfg.timezone)
    driver = EspHomeP1Driver(cfg.p1_url)
    collector = Collector(
        driver,
        storage,
        flush_interval=cfg.flush_interval,
        raw_retention_days=cfg.raw_retention_days,
        minute_retention_days=cfg.minute_retention_days,
    )

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(collector.run())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            storage.close()

    app = FastAPI(title="Jouleflow", version=__version__, lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.get("/api/live")
    async def live() -> dict:
        reading = collector.latest
        fresh = reading is not None and time.time() - reading.ts < 15
        return {
            "reading": reading_to_dict(reading) if reading else None,
            "fresh": fresh,
            "device": asdict(driver.status()),
        }

    @app.get("/api/summary")
    async def summary() -> dict:
        return await asyncio.to_thread(queries.today_summary, storage, int(time.time()))

    @app.get("/api/power")
    async def power(range: queries.Range = "hour") -> dict:  # noqa: A002
        return await asyncio.to_thread(queries.power_series, storage, range, int(time.time()))

    @app.get("/api/history")
    async def history(
        period: queries.Period = "day",
        date_: str | None = Query(None, alias="date"),
    ) -> dict:
        try:
            anchor = date.fromisoformat(date_) if date_ else datetime.now(storage.tz).date()
        except ValueError as exc:
            raise HTTPException(400, "date must be YYYY-MM-DD") from exc
        return await asyncio.to_thread(queries.history, storage, period, anchor)

    @app.get("/api/devices")
    async def devices() -> list[dict]:
        return [asdict(driver.status())]

    @app.get("/api/system")
    async def system() -> dict:
        info = await asyncio.to_thread(system_info, cfg.db_path)
        counts = await asyncio.to_thread(
            storage.query_one,
            "SELECT (SELECT count(*) FROM samples) AS samples, "
            "(SELECT count(*) FROM agg_1m) AS minutes, (SELECT count(*) FROM agg_1h) AS hours, "
            "(SELECT count(*) FROM agg_1d) AS days, (SELECT min(ts) FROM agg_1d) AS since",
        )
        return {
            **info,
            "timezone": cfg.timezone,
            "retention": {
                "raw_days": cfg.raw_retention_days,
                "minute_days": cfg.minute_retention_days,
                "hourly": "forever",
                "daily": "forever",
            },
            "rows": dict(counts) if counts else {},
        }

    @app.websocket("/api/ws")
    async def ws(socket: WebSocket) -> None:
        await socket.accept()
        last_ts = None
        try:
            while True:
                reading = collector.latest
                if reading is not None and reading.ts != last_ts:
                    last_ts = reading.ts
                    await socket.send_json(reading_to_dict(reading))
                await asyncio.sleep(0.5)
        except (WebSocketDisconnect, RuntimeError):
            pass

    frontend = cfg.frontend_dir
    if frontend and (frontend / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str) -> FileResponse:
            candidate = (frontend / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(frontend.resolve()):
                return FileResponse(candidate)
            return FileResponse(frontend / "index.html")

    return app


def run() -> None:
    import uvicorn

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    uvicorn.run(create_app(), host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    run()
