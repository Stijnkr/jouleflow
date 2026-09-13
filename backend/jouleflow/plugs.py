"""Smart plugs with energy monitoring (TP-Link Tapo P110/P115 and similar Kasa devices).

Plugs are polled locally with python-kasa. Tapo plugs authenticate with the owner's
TP-Link account, which the user enters in the web app. The password is stored encrypted
(see `SecretBox`), never returned by the API, and only ever sent to plug addresses that
were saved together with it.

Readings are stored every poll (`plug_samples`, kept `raw_retention_days`) and rolled up
into hourly rows (`plug_agg_1h`, kept forever). Energy is integrated from power, because
not every firmware exposes a reliable lifetime counter.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

from kasa import Credentials, Device, Discover, Module
from kasa.exceptions import AuthenticationError, KasaException
from pydantic import BaseModel, Field

from .security import SecretBox
from .storage import Storage

log = logging.getLogger(__name__)

POLL_INTERVAL = 10.0
STALE_AFTER = 45.0
# Readings further apart than this are not integrated into energy (the plug was offline).
MAX_GAP = 120

SCHEMA = """
CREATE TABLE IF NOT EXISTS plug_samples (
    plug_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    power REAL, voltage REAL, current REAL, is_on INTEGER,
    PRIMARY KEY (plug_id, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS plug_agg_1h (
    plug_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    n INTEGER NOT NULL,
    power_avg REAL, power_max REAL, voltage_avg REAL, current_max REAL,
    on_ratio REAL, energy REAL,
    PRIMARY KEY (plug_id, ts)
) WITHOUT ROWID;
"""


class PlugConfig(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    host: str
    name: str = ""


class PlugSettings(BaseModel):
    username: str = ""
    password: str = ""
    plugs: list[PlugConfig] = Field(default_factory=list)


class PlugSettingsUpdate(BaseModel):
    username: str = ""
    # None keeps the stored password.
    password: str | None = None
    plugs: list[PlugConfig] = Field(default_factory=list)


@dataclass
class PlugState:
    id: str
    host: str
    name: str
    connected: bool = False
    last_update: float | None = None
    error: str | None = None
    error_code: str | None = None
    model: str | None = None
    alias: str | None = None
    mac: str | None = None
    is_on: bool | None = None
    power: float | None = None
    voltage: float | None = None
    current: float | None = None
    today_kwh: float | None = None
    month_kwh: float | None = None
    rssi: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def display_name(self) -> str:
        return self.name or self.alias or self.host


def _error_code(exc: Exception) -> str:
    if isinstance(exc, AuthenticationError):
        return "auth"
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return "timeout"
    return "connect"


def _read(device: Device, state: PlugState) -> None:
    state.model = device.model
    state.alias = device.alias
    state.mac = device.mac
    state.is_on = device.is_on
    with contextlib.suppress(Exception):
        state.rssi = device.rssi
    energy = device.modules.get(Module.Energy)
    if energy is not None:
        state.power = energy.current_consumption
        state.voltage = energy.voltage
        state.current = energy.current
        state.today_kwh = energy.consumption_today
        state.month_kwh = energy.consumption_this_month


async def probe(host: str, username: str, password: str) -> dict:
    """Connect once and return what the plug reports. Raises KasaException on failure."""
    credentials = Credentials(username, password) if username else None
    device = await Discover.discover_single(host, credentials=credentials, discovery_timeout=5)
    if device is None:
        raise KasaException(f"No supported device found at {host}")
    try:
        await device.update()
        state = PlugState(id="probe", host=host, name="")
        _read(device, state)
        return {
            "alias": state.alias,
            "model": state.model,
            "is_on": state.is_on,
            "power": state.power,
            "has_energy": state.power is not None,
        }
    finally:
        await device.disconnect()


class CredentialsRequired(ValueError):
    """Raised when a change would send the stored password somewhere new."""


class PlugManager:
    def __init__(self, storage: Storage, raw_retention_days: int, secrets: SecretBox) -> None:
        self.storage = storage
        self.raw_retention_days = raw_retention_days
        self.secrets = secrets
        with storage._lock:  # noqa: SLF001 - one-off schema setup
            storage._db.executescript(SCHEMA)  # noqa: SLF001
        self.settings = self._load_settings()
        self.states: dict[str, PlugState] = {}
        self._devices: dict[str, Device] = {}
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._sync_states()

    # ------------------------------------------------------------------ settings

    def _load_settings(self) -> PlugSettings:
        stored = dict(self.storage.get_setting("plugs") or {})
        if stored.get("password"):
            # Older installs stored the password in plain text: encrypt it now.
            stored["password_enc"] = self.secrets.encrypt(stored.pop("password"))
            self.storage.set_setting("plugs", stored)
        password = self.secrets.decrypt(stored.pop("password_enc", ""))
        return PlugSettings.model_validate({**stored, "password": password})

    def _save_settings(self) -> None:
        data = self.settings.model_dump(exclude={"password"})
        data["password_enc"] = self.secrets.encrypt(self.settings.password)
        self.storage.set_setting("plugs", data)

    def saved_hosts(self) -> set[str]:
        return {p.host.strip() for p in self.settings.plugs}

    def public_settings(self) -> dict:
        return {
            "username": self.settings.username,
            "has_password": bool(self.settings.password),
            "plugs": [p.model_dump() for p in self.settings.plugs],
        }

    async def update_settings(self, update: PlugSettingsUpdate) -> None:
        if update.password is None and self.settings.password:
            new_hosts = {p.host.strip() for p in update.plugs} - self.saved_hosts()
            if new_hosts or update.username.strip() != self.settings.username:
                # Keeping the stored password is only allowed for addresses it was
                # already used with; otherwise it could be sent to any device.
                raise CredentialsRequired("password_required")
        password = self.settings.password if update.password is None else update.password
        self.settings = PlugSettings(
            username=update.username.strip(), password=password, plugs=update.plugs
        )
        await asyncio.to_thread(self._save_settings)
        async with self._lock:
            await self._disconnect_all()
            self._sync_states()

    def _sync_states(self) -> None:
        states = {}
        for plug in self.settings.plugs:
            previous = self.states.get(plug.id)
            state = (
                previous
                if previous and previous.host == plug.host
                else PlugState(plug.id, plug.host, plug.name)
            )
            state.name = plug.name
            states[plug.id] = state
        self.states = states

    # ------------------------------------------------------------------ polling

    async def run(self) -> None:
        last_rollup = 0.0
        while True:
            started = time.monotonic()
            async with self._lock:
                await asyncio.gather(*(self._poll(s) for s in list(self.states.values())))
            await self._store()
            if time.time() - last_rollup > 60:
                last_rollup = time.time()
                with contextlib.suppress(Exception):
                    await asyncio.to_thread(self.rollup, time.time())
            await asyncio.sleep(max(POLL_INTERVAL - (time.monotonic() - started), 1.0))

    async def _connect(self, state: PlugState) -> Device:
        device = self._devices.get(state.id)
        if device is not None:
            return device
        credentials = (
            Credentials(self.settings.username, self.settings.password)
            if self.settings.username
            else None
        )
        device = await Discover.discover_single(
            state.host, credentials=credentials, discovery_timeout=5
        )
        if device is None:
            raise KasaException(f"No supported device found at {state.host}")
        self._devices[state.id] = device
        return device

    async def _poll(self, state: PlugState) -> None:
        try:
            device = await self._connect(state)
            await asyncio.wait_for(device.update(), 10)
            _read(device, state)
            state.connected = True
            state.last_update = time.time()
            state.error = state.error_code = None
        except Exception as exc:  # noqa: BLE001 - keep polling the other plugs
            state.connected = False
            state.error = str(exc) or exc.__class__.__name__
            state.error_code = _error_code(exc)
            device = self._devices.pop(state.id, None)
            if device is not None:
                with contextlib.suppress(Exception):
                    await device.disconnect()

    async def _store(self) -> None:
        now = int(time.time())
        rows = [
            (s.id, now, s.power, s.voltage, s.current, None if s.is_on is None else int(s.is_on))
            for s in self.states.values()
            if s.connected and s.last_update and now - s.last_update < STALE_AFTER
        ]
        if not rows:
            return

        def write() -> None:
            with self.storage._lock:  # noqa: SLF001
                self.storage._db.executemany(  # noqa: SLF001
                    "INSERT OR REPLACE INTO plug_samples VALUES (?, ?, ?, ?, ?, ?)", rows
                )

        await asyncio.to_thread(write)

    async def _disconnect_all(self) -> None:
        for device in self._devices.values():
            with contextlib.suppress(Exception):
                await device.disconnect()
        self._devices.clear()

    async def close(self) -> None:
        await self._disconnect_all()

    async def set_power(self, plug_id: str, on: bool) -> PlugState:
        state = self.states[plug_id]
        async with self._lock:
            device = await self._connect(state)
            await (device.turn_on() if on else device.turn_off())
            await device.update()
            _read(device, state)
            state.last_update = time.time()
        return state

    # ------------------------------------------------------------------ storage

    def rollup(self, now: float) -> None:
        """Roll complete hours of samples into plug_agg_1h and apply retention."""
        db = self.storage._db  # noqa: SLF001
        current_hour = int(now) // 3600 * 3600
        with self.storage._lock:  # noqa: SLF001
            plugs = [r[0] for r in db.execute("SELECT DISTINCT plug_id FROM plug_samples")]
            for plug_id in plugs:
                last = db.execute(
                    "SELECT max(ts) FROM plug_agg_1h WHERE plug_id = ?", (plug_id,)
                ).fetchone()[0]
                first = db.execute(
                    "SELECT min(ts) FROM plug_samples WHERE plug_id = ? AND ts >= ?",
                    (plug_id, 0 if last is None else last + 3600),
                ).fetchone()[0]
                if first is None:
                    continue
                for hour in range(first // 3600 * 3600, current_hour, 3600):
                    self._rollup_hour(plug_id, hour)
            db.execute(
                "DELETE FROM plug_samples WHERE ts < ?",
                (int(now) - self.raw_retention_days * 86400,),
            )

    def _rollup_hour(self, plug_id: str, hour: int) -> None:
        db = self.storage._db  # noqa: SLF001
        rows = db.execute(
            "SELECT ts, power, voltage, current, is_on FROM plug_samples "
            "WHERE plug_id = ? AND ts >= ? AND ts < ? ORDER BY ts",
            (plug_id, hour, hour + 3600),
        ).fetchall()
        if not rows:
            return
        powers = [r["power"] for r in rows if r["power"] is not None]
        voltages = [r["voltage"] for r in rows if r["voltage"] is not None]
        currents = [r["current"] for r in rows if r["current"] is not None]
        ons = [r["is_on"] for r in rows if r["is_on"] is not None]
        energy_wh = 0.0
        for a, b in zip(rows, rows[1:], strict=False):
            gap = b["ts"] - a["ts"]
            if 0 < gap <= MAX_GAP and a["power"] is not None and b["power"] is not None:
                energy_wh += (a["power"] + b["power"]) / 2 * gap / 3600
        db.execute(
            "INSERT OR REPLACE INTO plug_agg_1h VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                plug_id,
                hour,
                len(rows),
                sum(powers) / len(powers) if powers else None,
                max(powers) if powers else None,
                sum(voltages) / len(voltages) if voltages else None,
                max(currents) if currents else None,
                sum(ons) / len(ons) if ons else None,
                energy_wh / 1000,
            ),
        )

    def energy_between(self, start: int, end: int) -> dict[str, float]:
        """kWh per plug between two timestamps, from hourly rollups plus recent samples."""
        db = self.storage._db  # noqa: SLF001
        with self.storage._lock:  # noqa: SLF001
            result: dict[str, float] = {}
            for row in db.execute(
                "SELECT plug_id, sum(energy) AS e FROM plug_agg_1h "
                "WHERE ts >= ? AND ts < ? GROUP BY plug_id",
                (start, end),
            ):
                result[row["plug_id"]] = row["e"] or 0.0
            rolled = {
                row["plug_id"]: row["t"]
                for row in db.execute(
                    "SELECT plug_id, max(ts) + 3600 AS t FROM plug_agg_1h GROUP BY plug_id"
                )
            }
            for plug_id in self.states:
                since = max(start, rolled.get(plug_id) or start)
                if since >= end:
                    continue
                rows = db.execute(
                    "SELECT ts, power FROM plug_samples WHERE plug_id = ? AND ts >= ? AND ts < ? "
                    "ORDER BY ts",
                    (plug_id, since, end),
                ).fetchall()
                wh = sum(
                    (a["power"] + b["power"]) / 2 * (b["ts"] - a["ts"]) / 3600
                    for a, b in zip(rows, rows[1:], strict=False)
                    if 0 < b["ts"] - a["ts"] <= MAX_GAP
                    and a["power"] is not None
                    and b["power"] is not None
                )
                result[plug_id] = result.get(plug_id, 0.0) + wh / 1000
        return result

    def public_states(self) -> list[dict]:
        now = time.time()
        out = []
        for state in self.states.values():
            data = asdict(state)
            data["display_name"] = state.display_name
            data["fresh"] = bool(state.last_update and now - state.last_update < STALE_AFTER)
            out.append(data)
        return out
