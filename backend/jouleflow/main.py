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
from pydantic import BaseModel, Field

from . import __version__, queries
from .collector import Collector
from .config import Settings, settings
from .drivers import (
    DeviceStatus,
    EspHomeP1Driver,
    MeterDriver,
    MeterReading,
    ProbeError,
    get_driver,
    list_drivers,
)
from .storage import Storage
from .tariffs import TariffSettings

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


class P1Config(BaseModel):
    driver: str
    options: dict[str, str] = Field(default_factory=dict)


def initial_p1_config(storage: Storage, cfg: Settings) -> P1Config | None:
    """Saved settings win; otherwise fall back to JOULEFLOW_P1_URL for first-time setups."""
    saved = storage.get_setting("p1")
    if saved:
        return P1Config.model_validate(saved)
    if cfg.p1_url:
        return P1Config(driver=EspHomeP1Driver.info.id, options={"host": cfg.p1_url})
    return None


def build_driver(config: P1Config | None) -> MeterDriver | None:
    if config is None:
        return None
    try:
        return get_driver(config.driver).from_options(config.options)
    except ValueError:
        log.exception("Invalid P1 configuration %s", config)
        return None


def create_app(cfg: Settings = settings) -> FastAPI:
    storage = Storage(cfg.db_path, cfg.timezone)
    collector = Collector(
        build_driver(initial_p1_config(storage, cfg)),
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

    def p1_status() -> dict:
        if collector.driver is None:
            return asdict(
                DeviceStatus(id="p1", name="P1 meter", kind="p1_meter", connection="Not configured")
            )
        return asdict(collector.driver.status())

    @app.get("/api/live")
    async def live() -> dict:
        reading = collector.latest
        fresh = reading is not None and time.time() - reading.ts < 15
        return {
            "reading": reading_to_dict(reading) if reading else None,
            "fresh": fresh,
            "device": p1_status(),
        }

    @app.get("/api/p1/drivers")
    async def p1_drivers() -> list[dict]:
        return list_drivers()

    @app.get("/api/p1/config")
    async def p1_config() -> dict:
        driver = collector.driver
        if driver is None:
            return {"configured": False, "driver": None, "options": {}}
        status = driver.status()
        return {"configured": True, "driver": status.driver, "options": status.options}

    def resolve(config: P1Config) -> type[MeterDriver]:
        try:
            return get_driver(config.driver)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/p1/test")
    async def p1_test(config: P1Config) -> dict:
        try:
            found = await resolve(config).probe(config.options)
        except ProbeError as exc:
            url = config.options.get("host", "")
            return {"ok": False, "error": str(exc), "code": exc.code, "url": url}
        return {"ok": True, **found}

    @app.put("/api/p1/config")
    async def p1_save(config: P1Config) -> dict:
        try:
            driver = resolve(config).from_options(config.options)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        await asyncio.to_thread(storage.set_setting, "p1", config.model_dump())
        await collector.set_driver(driver)
        log.info("P1 meter reconfigured: %s", driver.status().connection)
        return p1_status()

    tariffs = TariffSettings.model_validate(storage.get_setting("tariffs") or {})

    @app.get("/api/tariffs")
    async def get_tariffs() -> TariffSettings:
        return tariffs

    @app.put("/api/tariffs")
    async def put_tariffs(new: TariffSettings) -> TariffSettings:
        nonlocal tariffs
        await asyncio.to_thread(storage.set_setting, "tariffs", new.model_dump(mode="json"))
        tariffs = new
        return tariffs

    @app.get("/api/summary")
    async def summary() -> dict:
        return await asyncio.to_thread(queries.today_summary, storage, int(time.time()), tariffs)

    @app.get("/api/series")
    async def live_series(range: queries.Range = "hour") -> dict:  # noqa: A002
        return await asyncio.to_thread(queries.live_series, storage, range, int(time.time()))

    @app.get("/api/history")
    async def history(
        period: queries.Period = "day",
        date_: str | None = Query(None, alias="date"),
    ) -> dict:
        try:
            anchor = date.fromisoformat(date_) if date_ else datetime.now(storage.tz).date()
        except ValueError as exc:
            raise HTTPException(400, "date must be YYYY-MM-DD") from exc
        return await asyncio.to_thread(queries.history, storage, period, anchor, tariffs)

    @app.get("/api/history/series")
    async def history_series(
        period: queries.Period = "day",
        date_: str | None = Query(None, alias="date"),
    ) -> dict:
        try:
            anchor = date.fromisoformat(date_) if date_ else datetime.now(storage.tz).date()
        except ValueError as exc:
            raise HTTPException(400, "date must be YYYY-MM-DD") from exc
        return await asyncio.to_thread(queries.history_series, storage, period, anchor)

    @app.get("/api/devices")
    async def devices() -> list[dict]:
        return [p1_status()]

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
