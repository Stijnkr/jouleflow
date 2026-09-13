"""SQLite storage for meter data.

Data is kept at several resolutions so that recent data is detailed and long-term
history stays small and fast to query:

    samples   raw readings, ~1 per second      kept `raw_retention_days`
    agg_1m    1-minute rollups                 kept `minute_retention_days`
    agg_1h    1-hour rollups                   kept forever
    agg_1d    1-day rollups (local calendar)   kept forever

Energy is derived from the meter's cumulative counters, never by integrating power.
Each rollup row stores the counters at the end of its bucket (`e_*`) and the energy
consumed during the bucket (`d_*`), so totals over any range are a simple SUM and
stay exact even across gaps in the data.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .drivers.base import MeterReading

SCHEMA_VERSION = 1

COUNTERS = ("e_imp_t1", "e_imp_t2", "e_exp_t1", "e_exp_t2", "gas")
DELTAS = ("d_imp_t1", "d_imp_t2", "d_exp_t1", "d_exp_t2", "d_gas")

SAMPLE_COLUMNS = (
    "ts", "p_imp", "p_exp", "p_l1", "p_l2", "p_l3",
    "v_l1", "v_l2", "v_l3", "i_l1", "i_l2", "i_l3", *COUNTERS,
)  # fmt: skip

AGG_COLUMNS = (
    "ts", "n", "p_imp_avg", "p_imp_max", "p_exp_avg", "p_exp_max",
    "p_l1_avg", "p_l2_avg", "p_l3_avg", "v_l1_avg", "v_l2_avg", "v_l3_avg",
    "v_min", "v_max", *COUNTERS, *DELTAS,
)  # fmt: skip

_AGG_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS {name} (
    ts INTEGER PRIMARY KEY,
    n INTEGER NOT NULL,
    p_imp_avg REAL, p_imp_max REAL, p_exp_avg REAL, p_exp_max REAL,
    p_l1_avg REAL, p_l2_avg REAL, p_l3_avg REAL,
    v_l1_avg REAL, v_l2_avg REAL, v_l3_avg REAL, v_min REAL, v_max REAL,
    e_imp_t1 REAL, e_imp_t2 REAL, e_exp_t1 REAL, e_exp_t2 REAL, gas REAL,
    d_imp_t1 REAL, d_imp_t2 REAL, d_exp_t1 REAL, d_exp_t2 REAL, d_gas REAL
)
"""

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS samples (
    ts INTEGER PRIMARY KEY,
    p_imp REAL NOT NULL, p_exp REAL NOT NULL,
    p_l1 REAL, p_l2 REAL, p_l3 REAL,
    v_l1 REAL, v_l2 REAL, v_l3 REAL,
    i_l1 REAL, i_l2 REAL, i_l3 REAL,
    e_imp_t1 REAL, e_imp_t2 REAL, e_exp_t1 REAL, e_exp_t2 REAL, gas REAL
);
{_AGG_TABLE_SQL.format(name="agg_1m")};
{_AGG_TABLE_SQL.format(name="agg_1h")};
{_AGG_TABLE_SQL.format(name="agg_1d")};
"""

# Aggregate expressions used when rolling raw samples up into minutes.
_SAMPLE_AGG_SQL = """
    count(*), avg(p_imp), max(p_imp), avg(p_exp), max(p_exp),
    avg(p_l1), avg(p_l2), avg(p_l3), avg(v_l1), avg(v_l2), avg(v_l3),
    min(min(coalesce(v_l1, 1e9), coalesce(v_l2, 1e9), coalesce(v_l3, 1e9))),
    max(max(coalesce(v_l1, 0), coalesce(v_l2, 0), coalesce(v_l3, 0)))
"""


def _weighted(col: str) -> str:
    return f"sum({col} * n) / sum(CASE WHEN {col} IS NOT NULL THEN n END)"


# Aggregate expressions used when rolling rollups up into larger rollups.
_ROLLUP_AGG_SQL = f"""
    sum(n), {_weighted("p_imp_avg")}, max(p_imp_max), {_weighted("p_exp_avg")}, max(p_exp_max),
    {_weighted("p_l1_avg")}, {_weighted("p_l2_avg")}, {_weighted("p_l3_avg")},
    {_weighted("v_l1_avg")}, {_weighted("v_l2_avg")}, {_weighted("v_l3_avg")},
    min(v_min), max(v_max),
    sum(d_imp_t1), sum(d_imp_t2), sum(d_exp_t1), sum(d_exp_t2), sum(d_gas)
"""


def _delta(end: float | None, start: float | None) -> float | None:
    if end is None:
        return None
    if start is None or end < start:
        # No previous value, or the meter was replaced/reset.
        return 0.0
    return end - start


class Storage:
    def __init__(self, path: Path, timezone: str = "Europe/Amsterdam") -> None:
        self.path = path
        self.tz = ZoneInfo(timezone)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(
            """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -16000;
            """
        )
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.execute(
                "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ------------------------------------------------------------------ settings

    def get_setting(self, key: str) -> Any:
        with self._lock:
            row = self._db.execute(
                "SELECT value FROM meta WHERE key = ?", (f"setting:{key}",)
            ).fetchone()
        return None if row is None else json.loads(row[0])

    def set_setting(self, key: str, value: Any) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                (f"setting:{key}", json.dumps(value)),
            )

    # ------------------------------------------------------------------ time helpers

    def local_midnight(self, ts: float) -> int:
        dt = datetime.fromtimestamp(ts, self.tz)
        return int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())

    def next_local_midnight(self, ts: float) -> int:
        dt = datetime.fromtimestamp(self.local_midnight(ts), self.tz)
        nxt = (dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        # Re-attach the zone so DST transitions give 23 or 25 hour days.
        return int(nxt.replace(tzinfo=self.tz).timestamp())

    # ------------------------------------------------------------------ writes

    def insert_samples(self, readings: Sequence[MeterReading]) -> None:
        if not readings:
            return
        rows = [
            (
                r.ts,
                r.power_import,
                r.power_export,
                r.power_l1,
                r.power_l2,
                r.power_l3,
                r.voltage_l1,
                r.voltage_l2,
                r.voltage_l3,
                r.current_l1,
                r.current_l2,
                r.current_l3,
                r.energy_import_t1,
                r.energy_import_t2,
                r.energy_export_t1,
                r.energy_export_t2,
                r.gas,
            )  # fmt: skip
            for r in readings
        ]
        placeholders = ", ".join("?" * len(SAMPLE_COLUMNS))
        with self._lock:
            self._db.execute("BEGIN")
            self._db.executemany(
                f"INSERT OR REPLACE INTO samples ({', '.join(SAMPLE_COLUMNS)}) "
                f"VALUES ({placeholders})",
                rows,
            )
            self._db.execute("COMMIT")

    def rollup(self, now: float) -> int:
        """Roll complete minutes into agg_1m, then refresh the affected hours and days.

        Safe to call repeatedly; returns the number of minutes written.
        """
        current_minute = int(now) // 60 * 60
        with self._lock:
            last = self._db.execute("SELECT max(ts) FROM agg_1m").fetchone()[0]
            # Skip over gaps: start at the first sample after the last rolled minute.
            first = self._db.execute(
                "SELECT min(ts) FROM samples WHERE ts >= ?", (0 if last is None else last + 60,)
            ).fetchone()[0]
            if first is None:
                return 0
            start = first // 60 * 60
            if start >= current_minute:
                return 0
            # Catch up at most one day per call to keep each transaction short.
            end = min(current_minute, start + 86400)
            self._db.execute("BEGIN")
            try:
                written = self._rollup_minutes(start, end)
                if written:
                    self._refresh_rollups(start, end)
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise
        return written

    def rollup_all(self, now: float) -> None:
        while self.rollup(now):
            pass

    def _rollup_minutes(self, start: int, end: int) -> int:
        db = self._db
        aggregates = db.execute(
            f"SELECT ts / 60 * 60 AS m, {_SAMPLE_AGG_SQL} FROM samples "
            "WHERE ts >= ? AND ts < ? GROUP BY m ORDER BY m",
            (start, end),
        ).fetchall()
        if not aggregates:
            return 0

        counters = ", ".join(COUNTERS)
        last_rows = {
            row[0] // 60 * 60: row[1:]
            for row in db.execute(
                f"SELECT ts, {counters} FROM samples WHERE ts IN ("
                "SELECT max(ts) FROM samples WHERE ts >= ? AND ts < ? GROUP BY ts / 60)",
                (start, end),
            )
        }
        first_rows = {
            row[0] // 60 * 60: row[1:]
            for row in db.execute(
                f"SELECT ts, {counters} FROM samples WHERE ts IN ("
                "SELECT min(ts) FROM samples WHERE ts >= ? AND ts < ? GROUP BY ts / 60)",
                (start, end),
            )
        }
        prev_row = db.execute(
            f"SELECT {counters} FROM agg_1m WHERE ts < ? ORDER BY ts DESC LIMIT 1", (start,)
        ).fetchone()
        prev = tuple(prev_row) if prev_row else None

        rows = []
        for agg in aggregates:
            minute = agg[0]
            v_min = agg[12] if agg[12] < 1e9 else None
            v_max = agg[13] if agg[13] > 0 else None
            end_counters = last_rows[minute]
            start_counters = [
                p if p is not None else f
                for p, f in zip(prev or (None,) * len(COUNTERS), first_rows[minute], strict=True)
            ]
            deltas = [_delta(e, s) for e, s in zip(end_counters, start_counters, strict=True)]
            rows.append((*agg[:12], v_min, v_max, *end_counters, *deltas))
            # Carry counters forward, keeping the previous value where this minute has none.
            prev = tuple(
                e if e is not None else p
                for e, p in zip(end_counters, prev or (None,) * len(COUNTERS), strict=True)
            )

        placeholders = ", ".join("?" * len(AGG_COLUMNS))
        db.executemany(
            f"INSERT OR REPLACE INTO agg_1m ({', '.join(AGG_COLUMNS)}) VALUES ({placeholders})",
            rows,
        )
        return len(rows)

    def _refresh_rollups(self, start: int, end: int) -> None:
        hours = range(start // 3600 * 3600, end, 3600)
        self._write_buckets("agg_1m", "agg_1h", ((h, h + 3600) for h in hours))

        days = []
        day = self.local_midnight(start)
        while day < end:
            nxt = self.next_local_midnight(day)
            days.append((day, nxt))
            day = nxt
        self._write_buckets("agg_1h", "agg_1d", days)

    def _write_buckets(self, src: str, dst: str, buckets: Iterable[tuple[int, int]]) -> None:
        db = self._db
        counters = ", ".join(COUNTERS)
        insert_cols = ", ".join(c for c in AGG_COLUMNS if c not in COUNTERS)
        for bucket_start, bucket_end in buckets:
            agg = db.execute(
                f"SELECT {_ROLLUP_AGG_SQL} FROM {src} WHERE ts >= ? AND ts < ?",
                (bucket_start, bucket_end),
            ).fetchone()
            if not agg[0]:
                continue
            last = db.execute(
                f"SELECT {counters} FROM {src} WHERE ts >= ? AND ts < ? ORDER BY ts DESC LIMIT 1",
                (bucket_start, bucket_end),
            ).fetchone()
            db.execute(
                f"INSERT OR REPLACE INTO {dst} ({insert_cols}, {counters}) "
                f"VALUES ({', '.join('?' * (len(AGG_COLUMNS)))})",
                (bucket_start, *agg, *last),
            )

    def apply_retention(self, now: float, raw_days: int, minute_days: int) -> None:
        with self._lock:
            self._db.execute("DELETE FROM samples WHERE ts < ?", (int(now) - raw_days * 86400,))
            self._db.execute("DELETE FROM agg_1m WHERE ts < ?", (int(now) - minute_days * 86400,))
            self._db.execute("PRAGMA optimize")

    # ------------------------------------------------------------------ reads

    def query(self, sql: str, params: Sequence = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: Sequence = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._db.execute(sql, params).fetchone()
