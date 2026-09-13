"""Solar inverters read over Modbus TCP.

The first supported family is Growatt's single-phase string inverters (MIC / MIN TL-X),
usually connected through an RS485-to-TCP gateway. They expose the classic Growatt input
register map; one request for registers 0-94 returns everything we need.

Readings are stored every poll (`solar_samples`, kept `raw_retention_days`) and rolled up
into hourly rows (`solar_agg_1h`, kept forever). Energy comes from the inverter's lifetime
counter rather than integrated power, so time the inverter or Jouleflow was unreachable
is still counted once it answers again. Growatt inverters switch off at night; that shows
up as "no response" and is expected.
"""

from __future__ import annotations

import asyncio
import bisect
import contextlib
import logging
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Literal

from pydantic import BaseModel, Field
from pymodbus.client import AsyncModbusTcpClient

from .queries import _change
from .storage import Storage

log = logging.getLogger(__name__)

POLL_INTERVAL = 10.0
POLL_INTERVAL_INT = int(POLL_INTERVAL)
STALE_AFTER = 45.0
# A lifetime counter that jumps by more than this per hour is treated as a glitch or reset.
MAX_KWH_PER_HOUR = 50.0
# Growatt counters step in 0.1 kWh. Within that margin integrated power is used instead,
# so hourly bars are smooth while totals still follow the counter.
COUNTER_STEP_KWH = 0.15
# Samples further apart than this are not integrated (Jouleflow or the inverter was away).
MAX_GAP = 120

GROWATT_BLOCK = (0, 95)
GROWATT_STATUS = {0: "waiting", 1: "normal", 3: "fault"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS solar_samples (
    inverter_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    power REAL, pv_power REAL, voltage REAL, temperature REAL, total_kwh REAL,
    PRIMARY KEY (inverter_id, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS solar_agg_1h (
    inverter_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    n INTEGER NOT NULL,
    power_avg REAL, power_max REAL, temperature_max REAL,
    total_kwh REAL, energy REAL,
    PRIMARY KEY (inverter_id, ts)
) WITHOUT ROWID;
"""


class InverterConfig(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str = ""
    model: Literal["growatt"] = "growatt"
    host: str
    port: int = Field(502, ge=1, le=65535)
    unit_id: int = Field(1, ge=1, le=247)


class SolarSettings(BaseModel):
    inverters: list[InverterConfig] = Field(default_factory=list)


@dataclass
class InverterReading:
    status: str
    power: float  # AC output, W
    pv_power: float  # DC input, W
    pv1_voltage: float
    pv1_current: float
    pv2_voltage: float
    pv2_current: float
    grid_voltage: float
    grid_current: float
    frequency: float
    today_kwh: float
    total_kwh: float
    temperature: float


def parse_growatt(r: list[int]) -> InverterReading:
    """Decode input registers 0-94 of a Growatt MIC/MIN TL-X (classic protocol)."""

    def u32(i: int) -> int:
        return r[i] << 16 | r[i + 1]

    def s16(i: int) -> int:
        return r[i] - 65536 if r[i] >= 32768 else r[i]

    return InverterReading(
        status=GROWATT_STATUS.get(r[0], f"code {r[0]}"),
        pv_power=u32(1) / 10,
        pv1_voltage=r[3] / 10,
        pv1_current=r[4] / 10,
        pv2_voltage=r[7] / 10,
        pv2_current=r[8] / 10,
        power=u32(35) / 10,
        frequency=r[37] / 100,
        grid_voltage=r[38] / 10,
        grid_current=r[39] / 10,
        today_kwh=u32(53) / 10,
        total_kwh=u32(55) / 10,
        temperature=s16(93) / 10,
    )


def consumption(energy: dict, solar: float | None) -> float | None:
    """What the house used: imported minus exported plus what the panels produced."""
    if energy.get("import") is None:
        return None
    return round(max(energy["import"] - (energy.get("export") or 0.0) + (solar or 0.0), 0.0), 3)


class NoResponse(Exception):
    """The gateway accepted the connection but the inverter did not answer."""


async def read_growatt(client: AsyncModbusTcpClient, unit_id: int) -> InverterReading:
    start, count = GROWATT_BLOCK
    try:
        result = await client.read_input_registers(start, count=count, device_id=unit_id)
    except Exception as exc:  # pymodbus raises ModbusIOException on timeouts
        raise NoResponse(str(exc) or "No response") from exc
    if result.isError() or len(result.registers) < count:
        raise NoResponse(str(result))
    return parse_growatt(result.registers)


def _client(host: str, port: int) -> AsyncModbusTcpClient:
    # No automatic reconnects: the poll loop decides when to try again.
    return AsyncModbusTcpClient(host, port=port, timeout=3, retries=1, reconnect_delay=0)


def _error_code(exc: Exception) -> str:
    if isinstance(exc, NoResponse):
        return "no_response"
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return "timeout"
    return "connect"


async def probe(host: str, port: int, unit_id: int) -> dict:
    """Read the inverter once. Raises ConnectionError or NoResponse on failure."""
    client = _client(host, port)
    try:
        if not await client.connect():
            raise ConnectionError(f"Could not connect to {host}:{port}")
        reading = await read_growatt(client, unit_id)
        return {
            "status": reading.status,
            "power": reading.power,
            "today_kwh": reading.today_kwh,
            "total_kwh": reading.total_kwh,
        }
    finally:
        client.close()


@dataclass
class InverterState:
    id: str
    name: str
    host: str
    port: int
    unit_id: int
    model: str
    connected: bool = False
    last_update: float | None = None
    error: str | None = None
    error_code: str | None = None
    reading: InverterReading | None = None
    failures: int = 0
    next_attempt: float = 0.0

    @property
    def display_name(self) -> str:
        return self.name or f"Growatt {self.host}"


# Gaps up to this long between two readings are filled in (a missed poll or a restart),
# longer ones mean the inverter was off.
BRIDGE_GAP = 300


def bridge_gaps(points: list[tuple[int, float]], resolution: int) -> list[tuple[int, float]]:
    """Fill short gaps between readings by interpolating, so a missed poll doesn't show
    up as a moment without sun."""
    if resolution >= 3600:
        return points
    out: list[tuple[int, float]] = []
    for a, b in zip(points, points[1:], strict=False):
        out.append(a)
        gap = b[0] - a[0]
        if resolution < gap <= BRIDGE_GAP:
            steps = gap // resolution
            for k in range(1, steps):
                out.append((a[0] + k * resolution, a[1] + (b[1] - a[1]) * k / steps))
    if points:
        out.append(points[-1])
    return out


def average_into_buckets(
    points: list[tuple[int, float]],
    resolution: int,
    starts: list[int],
    bucket: int,
    since: int | None,
) -> list[float | None]:
    """Average solar power (W) for each bucket starting at `starts`.

    `points` are (timestamp, W) at `resolution` seconds, with no rows while the inverter
    sleeps. Missing slots count as zero once solar data exists (`since`); before that the
    result is None, so charts don't pretend there was no sun before the panels were
    connected. Buckets finer than the resolution take the value of the slot they fall in.
    """
    points = bridge_gaps(points, resolution)
    times = [p[0] for p in points]
    out: list[float | None] = []
    for t in starts:
        if since is None or t + bucket <= since:
            out.append(None)
        elif bucket <= resolution:
            i = bisect.bisect_right(times, t) - 1
            out.append(points[i][1] if i >= 0 and t - times[i] < resolution else 0.0)
        else:
            lo, hi = bisect.bisect_left(times, t), bisect.bisect_left(times, t + bucket)
            out.append(sum(p[1] for p in points[lo:hi]) / (bucket / resolution))
    return out


class SolarManager:
    def __init__(self, storage: Storage, raw_retention_days: int) -> None:
        self.storage = storage
        self.raw_retention_days = raw_retention_days
        with storage._lock:  # noqa: SLF001 - one-off schema setup
            storage._db.executescript(SCHEMA)  # noqa: SLF001
        self.settings = SolarSettings.model_validate(storage.get_setting("solar") or {})
        self.states: dict[str, InverterState] = {}
        self._clients: dict[str, AsyncModbusTcpClient] = {}
        self._lock = asyncio.Lock()
        self._sync_states()

    # ------------------------------------------------------------------ settings

    async def update_settings(self, settings: SolarSettings) -> None:
        self.settings = settings
        await asyncio.to_thread(self.storage.set_setting, "solar", settings.model_dump())
        async with self._lock:
            self._close_all()
            self._sync_states()

    def _sync_states(self) -> None:
        states = {}
        for inv in self.settings.inverters:
            previous = self.states.get(inv.id)
            same = previous and (previous.host, previous.port, previous.unit_id) == (
                inv.host,
                inv.port,
                inv.unit_id,
            )
            state = (
                previous
                if same
                else InverterState(inv.id, inv.name, inv.host, inv.port, inv.unit_id, inv.model)
            )
            state.name = inv.name
            state.failures, state.next_attempt = 0, 0.0
            states[inv.id] = state
        self.states = states

    # ------------------------------------------------------------------ polling

    async def run(self) -> None:
        last_rollup = 0.0
        while True:
            started = time.monotonic()
            async with self._lock:
                # One at a time: inverters often share a single RS485 gateway.
                for state in list(self.states.values()):
                    await self._poll(state)
            await self._store()
            if time.time() - last_rollup > 60:
                last_rollup = time.time()
                with contextlib.suppress(Exception):
                    await asyncio.to_thread(self.rollup, time.time())
            await asyncio.sleep(max(POLL_INTERVAL - (time.monotonic() - started), 1.0))

    async def _poll(self, state: InverterState) -> None:
        if time.time() < state.next_attempt:
            return
        try:
            client = self._clients.get(state.id)
            if client is None or not client.connected:
                client = _client(state.host, state.port)
                self._clients[state.id] = client
                if not await client.connect():
                    raise ConnectionError(f"Could not connect to {state.host}:{state.port}")
            state.reading = await read_growatt(client, state.unit_id)
            state.connected = True
            state.last_update = time.time()
            state.error = state.error_code = None
            state.failures, state.next_attempt = 0, 0.0
        except Exception as exc:  # noqa: BLE001 - keep polling
            state.connected = False
            state.error = str(exc) or exc.__class__.__name__
            state.error_code = _error_code(exc)
            state.failures += 1
            # 10 s, 20 s, 40 s ... up to 5 minutes (inverters sleep all night).
            state.next_attempt = time.time() + min(POLL_INTERVAL * 2 ** (state.failures - 1), 300)
            if state.failures == 1 or state.failures % 20 == 0:
                log.info("Inverter %s (%s): %s", state.display_name, state.host, state.error)
            client = self._clients.pop(state.id, None)
            if client is not None:
                client.close()

    async def _store(self) -> None:
        now = int(time.time())
        rows = [
            (
                s.id,
                now,
                s.reading.power,
                s.reading.pv_power,
                s.reading.grid_voltage,
                s.reading.temperature,
                s.reading.total_kwh,
            )
            for s in self.states.values()
            if s.connected and s.reading and s.last_update and now - s.last_update < STALE_AFTER
        ]
        if not rows:
            return

        def write() -> None:
            with self.storage._lock:  # noqa: SLF001
                self.storage._db.executemany(  # noqa: SLF001
                    "INSERT OR REPLACE INTO solar_samples VALUES (?, ?, ?, ?, ?, ?, ?)", rows
                )

        await asyncio.to_thread(write)

    def _close_all(self) -> None:
        for client in self._clients.values():
            client.close()
        self._clients.clear()

    async def close(self) -> None:
        self._close_all()

    # ------------------------------------------------------------------ storage

    def _baseline(self, inverter_id: str, before: int) -> float | None:
        """The lifetime counter at the end of the last rolled-up hour before `before`."""
        row = self.storage._db.execute(  # noqa: SLF001
            "SELECT total_kwh FROM solar_agg_1h WHERE inverter_id = ? AND ts < ? "
            "AND total_kwh IS NOT NULL ORDER BY ts DESC LIMIT 1",
            (inverter_id, before),
        ).fetchone()
        return row["total_kwh"] if row else None

    @staticmethod
    def _delta(baseline: float | None, first: float, last: float, hours: float) -> float:
        start = first if baseline is None else baseline
        delta = last - start
        if delta < 0 or delta > MAX_KWH_PER_HOUR * max(hours, 1):
            # Counter reset or replaced inverter: only count what happened in this window.
            delta = max(last - first, 0.0)
        return delta

    def _integrated(self, inverter_id: str, start: int, end: int) -> float:
        rows = self.storage._db.execute(  # noqa: SLF001
            "SELECT ts, power FROM solar_samples WHERE inverter_id = ? AND ts >= ? AND ts < ? "
            "ORDER BY ts",
            (inverter_id, start, end),
        ).fetchall()
        wh = sum(
            (a["power"] + b["power"]) / 2 * (b["ts"] - a["ts"]) / 3600
            for a, b in zip(rows, rows[1:], strict=False)
            if 0 < b["ts"] - a["ts"] <= MAX_GAP
            and a["power"] is not None
            and b["power"] is not None
        )
        return wh / 1000

    @staticmethod
    def _smooth(counter: float, integrated: float) -> float:
        return integrated if abs(integrated - counter) <= COUNTER_STEP_KWH else counter

    def rollup(self, now: float) -> None:
        """Roll complete hours of samples into solar_agg_1h and apply retention."""
        db = self.storage._db  # noqa: SLF001
        current_hour = int(now) // 3600 * 3600
        with self.storage._lock:  # noqa: SLF001
            ids = [r[0] for r in db.execute("SELECT DISTINCT inverter_id FROM solar_samples")]
            for inverter_id in ids:
                last = db.execute(
                    "SELECT max(ts) FROM solar_agg_1h WHERE inverter_id = ?", (inverter_id,)
                ).fetchone()[0]
                first = db.execute(
                    "SELECT min(ts) FROM solar_samples WHERE inverter_id = ? AND ts >= ?",
                    (inverter_id, 0 if last is None else last + 3600),
                ).fetchone()[0]
                if first is None:
                    continue
                for hour in range(first // 3600 * 3600, current_hour, 3600):
                    self._rollup_hour(inverter_id, hour)
            db.execute(
                "DELETE FROM solar_samples WHERE ts < ?",
                (int(now) - self.raw_retention_days * 86400,),
            )

    def _rollup_hour(self, inverter_id: str, hour: int) -> None:
        db = self.storage._db  # noqa: SLF001
        row = db.execute(
            "SELECT count(*) AS n, avg(power) AS power_avg, max(power) AS power_max, "
            "max(temperature) AS temperature_max, min(total_kwh) AS first_kwh, "
            "max(total_kwh) AS last_kwh FROM solar_samples "
            "WHERE inverter_id = ? AND ts >= ? AND ts < ?",
            (inverter_id, hour, hour + 3600),
        ).fetchone()
        if not row["n"]:
            return
        energy = None
        if row["last_kwh"] is not None:
            baseline = self._baseline(inverter_id, hour)
            prev_ts = db.execute(
                "SELECT max(ts) FROM solar_agg_1h WHERE inverter_id = ? AND ts < ?",
                (inverter_id, hour),
            ).fetchone()[0]
            hours = 1 if prev_ts is None else (hour - prev_ts) / 3600
            energy = self._delta(baseline, row["first_kwh"], row["last_kwh"], hours)
            energy = self._smooth(energy, self._integrated(inverter_id, hour, hour + 3600))
        db.execute(
            "INSERT OR REPLACE INTO solar_agg_1h VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                inverter_id,
                hour,
                row["n"],
                row["power_avg"],
                row["power_max"],
                row["temperature_max"],
                row["last_kwh"],
                energy,
            ),
        )

    def energy_between(self, start: int, end: int) -> dict[str, float]:
        """kWh per inverter between two timestamps, from hourly rollups plus recent samples."""
        db = self.storage._db  # noqa: SLF001
        with self.storage._lock:  # noqa: SLF001
            result: dict[str, float] = {}
            for row in db.execute(
                "SELECT inverter_id, sum(energy) AS e FROM solar_agg_1h "
                "WHERE ts >= ? AND ts < ? GROUP BY inverter_id",
                (start, end),
            ):
                result[row["inverter_id"]] = row["e"] or 0.0
            for inverter_id in self.states:
                rolled = db.execute(
                    "SELECT max(ts) + 3600 FROM solar_agg_1h WHERE inverter_id = ?",
                    (inverter_id,),
                ).fetchone()[0]
                since = max(start, rolled or start)
                if since >= end:
                    continue
                row = db.execute(
                    "SELECT min(total_kwh) AS first_kwh, max(total_kwh) AS last_kwh "
                    "FROM solar_samples WHERE inverter_id = ? AND ts >= ? AND ts < ?",
                    (inverter_id, since, end),
                ).fetchone()
                if row["last_kwh"] is None:
                    continue
                baseline = self._baseline(inverter_id, since)
                delta = self._delta(
                    baseline, row["first_kwh"], row["last_kwh"], (end - since) / 3600
                )
                delta = self._smooth(delta, self._integrated(inverter_id, since, end))
                result[inverter_id] = result.get(inverter_id, 0.0) + delta
        return result

    def first_data(self) -> int | None:
        row = self.storage.query_one(
            "SELECT min(t) AS t FROM (SELECT min(ts) AS t FROM solar_samples "
            "UNION ALL SELECT min(ts) FROM solar_agg_1h)"
        )
        return row["t"] if row else None

    def power_points(
        self, start: int, end: int, bucket: int
    ) -> tuple[list[tuple[int, float]], int]:
        """Total solar power over time, from raw samples when they still cover the window,
        otherwise from hourly rollups. Returns (points, resolution in seconds)."""
        oldest = self.storage.query_one("SELECT min(ts) AS t FROM solar_samples")["t"]
        if oldest is not None and oldest <= max(start, self.first_data() or start):
            res = max(POLL_INTERVAL_INT, bucket if bucket < 3600 else 60)
            rows = self.storage.query(
                "SELECT t, sum(p) AS w FROM (SELECT ts / ? * ? AS t, avg(power) AS p "
                "FROM solar_samples WHERE ts >= ? AND ts < ? GROUP BY t, inverter_id) "
                "GROUP BY t ORDER BY t",
                (res, res, start - res, end),
            )
        else:
            res = 3600
            rows = self.storage.query(
                "SELECT ts AS t, sum(coalesce(energy * 1000, power_avg)) AS w FROM solar_agg_1h "
                "WHERE ts >= ? AND ts < ? GROUP BY ts ORDER BY ts",
                (start - res, end),
            )
        return [(r["t"], r["w"] or 0.0) for r in rows], res

    def add_to_series(self, payload: dict) -> dict:
        """Add solar power and total home consumption to a measurement series."""
        if not self.states and self.first_data() is None:
            return payload
        fields = payload["fields"]
        imp, exp = fields.index("p_imp_avg"), fields.index("p_exp_avg")
        bucket = payload["bucket_seconds"]
        starts = [p[0] for p in payload["points"]]
        solar: list[float | None] = []
        if starts:
            points, res = self.power_points(starts[0], starts[-1] + bucket, bucket)
            solar = average_into_buckets(points, res, starts, bucket, self.first_data())
        rows = []
        for point, w in zip(payload["points"], solar, strict=True):
            home = None
            if w is not None and point[imp] is not None:
                home = max(point[imp] - (point[exp] or 0.0) + w, 0.0)
            rows.append(
                [
                    *point,
                    None if w is None else round(w, 1),
                    None if home is None else round(home, 1),
                ]
            )
        return {**payload, "fields": [*fields, "solar_avg", "home_avg"], "points": rows}

    def energy_total(self, start: int, end: int) -> float | None:
        if end <= start or (not self.states and self.first_data() is None):
            return None
        return round(sum(self.energy_between(start, end).values()), 3)

    def add_to_summary(self, summary: dict, now: int) -> dict:
        """Add today's solar production and home consumption to the live summary."""
        day_start = summary["day_start"]
        yesterday_start = self.storage.local_midnight(day_start - 1)
        same_time = min(yesterday_start + (now - day_start), day_start)
        periods = {
            "today": (day_start, now),
            "yesterday_same_time": (yesterday_start, same_time),
            "yesterday": (yesterday_start, day_start),
        }
        out = {**summary}
        for key, (start, end) in periods.items():
            solar = self.energy_total(start, end)
            out[key] = {
                **summary[key],
                "solar": solar,
                "consumption": consumption(summary[key], solar),
            }
        out["change_pct"] = {
            **summary["change_pct"],
            "solar": _change(out["today"]["solar"], out["yesterday_same_time"]["solar"]),
            "consumption": _change(
                out["today"]["consumption"], out["yesterday_same_time"]["consumption"]
            ),
        }
        return out

    def add_to_history(self, history: dict) -> dict:
        """Add solar production and consumption per bar and to the period totals.

        Bars become [ts, import, export, gas, cost, feed-in cost, solar, consumption].
        """
        bars = history["bars"]
        bounds = [b[0] for b in bars] + [history["end"]]
        now = int(time.time())
        out_bars = []
        for i, bar in enumerate(bars):
            end = min(bounds[i + 1], now)
            solar = self.energy_total(bar[0], end) if bar[0] < now else None
            if solar is not None and solar == 0 and bar[1] is None:
                solar = None
            use = None
            if solar is not None and bar[1] is not None:
                use = round(max(bar[1] - (bar[2] or 0.0) + solar, 0.0), 3)
            out_bars.append([*bar, solar, use])
        totals, previous = history["totals"], history["previous"]
        solar_total = self.energy_total(history["start"], min(history["end"], now))
        solar_prev = self.energy_total(previous["start"], min(previous["end"], now))
        return {
            **history,
            "bars": out_bars,
            "totals": {
                **totals,
                "solar": solar_total,
                "consumption": consumption(totals, solar_total),
            },
            "previous": {
                **previous,
                "solar": solar_prev,
                "consumption": consumption(previous, solar_prev),
            },
        }

    def public_states(self) -> list[dict]:
        now = time.time()
        out = []
        for state in self.states.values():
            fresh = bool(state.last_update and now - state.last_update < STALE_AFTER)
            reading = asdict(state.reading) if state.reading else {}
            out.append(
                {
                    "id": state.id,
                    "name": state.name,
                    "display_name": state.display_name,
                    "model": state.model,
                    "host": state.host,
                    "port": state.port,
                    "unit_id": state.unit_id,
                    "connected": state.connected,
                    "fresh": fresh,
                    "last_update": state.last_update,
                    "error": state.error,
                    "error_code": state.error_code,
                    **reading,
                    # A sleeping or unreachable inverter produces nothing right now.
                    "power": reading.get("power") if fresh else 0.0,
                }
            )
        return out
