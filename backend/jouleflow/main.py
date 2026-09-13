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

from fastapi import FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
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
from .plugs import CredentialsRequired, PlugManager, PlugSettingsUpdate, _error_code
from .plugs import probe as probe_plug
from .security import SESSION_COOKIE, SESSION_DAYS, Auth, SecretBox
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


class Credentials(BaseModel):
    username: str
    password: str


class Setup(Credentials):
    setup_code: str


class PasswordChange(BaseModel):
    current: str
    new: str


class PlugTest(BaseModel):
    host: str
    username: str | None = None
    password: str | None = None


class PlugPower(BaseModel):
    on: bool


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

    auth = Auth(storage, cfg.data_dir)
    plugs = PlugManager(storage, cfg.raw_retention_days, SecretBox(cfg.data_dir / "secret.key"))

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        tasks = [asyncio.create_task(collector.run()), asyncio.create_task(plugs.run())]
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await plugs.close()
            storage.close()

    app = FastAPI(title="Jouleflow", version=__version__, lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # ------------------------------------------------------------------ authentication

    public_api = {"/api/auth/status", "/api/auth/login", "/api/auth/setup"}

    @app.middleware("http")
    async def require_login(request: Request, call_next):  # noqa: ANN202
        path = request.url.path
        if path.startswith("/api/"):
            # Reject cross-site requests that change something (defence in depth next to
            # the SameSite cookie).
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                origin = request.headers.get("origin")
                host = request.headers.get("host")
                if origin and host and origin.split("://", 1)[-1] != host:
                    return JSONResponse({"detail": "cross_origin"}, status_code=403)
            if path not in public_api and not auth.session_user(
                request.cookies.get(SESSION_COOKIE)
            ):
                return JSONResponse({"detail": "not_authenticated"}, status_code=401)
        return await call_next(request)

    def set_session_cookie(response: Response, request: Request, token: str) -> None:
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=SESSION_DAYS * 86400,
            httponly=True,
            samesite="strict",
            secure=request.url.scheme == "https",
            path="/",
        )

    def client_address(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def auth_error(exc: Exception) -> HTTPException:
        code = str(exc)
        status = 429 if code == "too_many_attempts" else 400 if isinstance(exc, ValueError) else 401
        return HTTPException(status, code)

    @app.get("/api/auth/status")
    async def auth_status(request: Request) -> dict:
        user = auth.session_user(request.cookies.get(SESSION_COOKIE))
        return {
            "setup_required": not auth.has_account(),
            "authenticated": user is not None,
            "username": user,
        }

    @app.post("/api/auth/setup")
    async def auth_setup(body: Setup, request: Request, response: Response) -> dict:
        try:
            await asyncio.to_thread(
                auth.create_account, body.username, body.password, body.setup_code
            )
            token = await asyncio.to_thread(
                auth.login, body.username, body.password, client_address(request)
            )
        except (PermissionError, ValueError) as exc:
            raise auth_error(exc) from exc
        set_session_cookie(response, request, token)
        return {"authenticated": True, "username": body.username.strip()}

    @app.post("/api/auth/login")
    async def auth_login(body: Credentials, request: Request, response: Response) -> dict:
        try:
            token = await asyncio.to_thread(
                auth.login, body.username, body.password, client_address(request)
            )
        except PermissionError as exc:
            raise auth_error(exc) from exc
        set_session_cookie(response, request, token)
        return {"authenticated": True, "username": body.username.strip()}

    @app.post("/api/auth/logout")
    async def auth_logout(request: Request, response: Response) -> dict:
        auth.logout(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"authenticated": False}

    @app.post("/api/auth/password")
    async def auth_password(body: PasswordChange, request: Request, response: Response) -> dict:
        try:
            await asyncio.to_thread(auth.change_password, body.current, body.new)
            token = await asyncio.to_thread(
                auth.login, auth.username() or "", body.new, client_address(request)
            )
        except (PermissionError, ValueError) as exc:
            raise auth_error(exc) from exc
        set_session_cookie(response, request, token)
        return {"ok": True}

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

    @app.get("/api/plugs")
    async def list_plugs() -> dict:
        now = int(time.time())
        day_start = storage.local_midnight(now)
        energy = await asyncio.to_thread(plugs.energy_between, day_start, now)
        return {
            "plugs": [
                {**state, "energy_today_kwh": round(energy.get(state["id"], 0.0), 3)}
                for state in plugs.public_states()
            ]
        }

    @app.get("/api/plugs/settings")
    async def plug_settings() -> dict:
        return plugs.public_settings()

    @app.put("/api/plugs/settings")
    async def save_plug_settings(update: PlugSettingsUpdate) -> dict:
        try:
            await plugs.update_settings(update)
        except CredentialsRequired as exc:
            raise HTTPException(400, "password_required") from exc
        return plugs.public_settings()

    @app.post("/api/plugs/test")
    async def test_plug(body: PlugTest) -> dict:
        host = body.host.strip()
        if body.password:
            username, password = (body.username or "").strip(), body.password
        else:
            # The stored password is only used for addresses it was saved with, so it
            # can't be sent to an arbitrary device.
            if host not in plugs.saved_hosts() or (
                body.username is not None and body.username.strip() != plugs.settings.username
            ):
                return {"ok": False, "code": "password_required", "error": "password_required"}
            username, password = plugs.settings.username, plugs.settings.password
        try:
            found = await asyncio.wait_for(probe_plug(host, username, password), 20)
        except Exception as exc:  # noqa: BLE001 - report any failure to the user
            return {
                "ok": False,
                "code": _error_code(exc),
                "error": str(exc) or exc.__class__.__name__,
            }
        return {"ok": True, **found}

    @app.post("/api/plugs/discover")
    async def discover_plugs() -> list[dict]:
        from kasa import Discover

        found = await Discover.discover(discovery_timeout=4)
        configured = {p.host for p in plugs.settings.plugs}
        return [
            {
                "host": host,
                "model": getattr(device, "model", None),
                "configured": host in configured,
            }
            for host, device in found.items()
        ]

    @app.post("/api/plugs/{plug_id}/power")
    async def plug_power(plug_id: str, body: PlugPower) -> dict:
        if plug_id not in plugs.states:
            raise HTTPException(404, "Unknown plug")
        try:
            await plugs.set_power(plug_id, body.on)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, str(exc) or "Could not switch the plug") from exc
        return next(s for s in plugs.public_states() if s["id"] == plug_id)

    @app.get("/api/plugs/history")
    async def plug_history(
        period: queries.Period = "day",
        date_: str | None = Query(None, alias="date"),
    ) -> dict:
        try:
            anchor = date.fromisoformat(date_) if date_ else datetime.now(storage.tz).date()
        except ValueError as exc:
            raise HTTPException(400, "date must be YYYY-MM-DD") from exc
        start, end = queries.period_bounds(storage, period, anchor)
        end = min(end, int(time.time()))
        energy = await asyncio.to_thread(plugs.energy_between, start, end) if end > start else {}
        return {
            "plugs": [
                {
                    "id": state.id,
                    "name": state.display_name,
                    "energy_kwh": round(energy.get(state.id, 0.0), 3),
                }
                for state in plugs.states.values()
            ]
        }

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
        if not auth.session_user(socket.cookies.get(SESSION_COOKIE)):
            await socket.close(code=4401)
            return
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

    # Files created by Jouleflow (database, WAL, keys) are private to the service user.
    os.umask(0o077)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # python-kasa logs every failed query at ERROR; our plug manager reports failures itself.
    logging.getLogger("kasa").setLevel(logging.CRITICAL)
    uvicorn.run(create_app(), host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    run()
