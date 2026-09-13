"""SQLite storage for meter data.

Data is kept at several resolutions so that recent data is detailed and long-term
history stays small and fast to query:

    samples   raw readings, ~1 per second      kept `raw_retention_days`
    agg_1m    1-minute rollups                 kept `minute_retention_days`
    agg_1h    1-hour rollups                   kept forever
    agg_1d    1-day rollups (local calendar)   kept forever

Every rollup keeps averages, minimums and maximums of power, voltage and current per
phase (see `STATS`), so phase history stays available after raw samples expire.

Energy is derived from the meter's cumulative counters, never by integrating power.
Each rollup row stores the counters at the end of its bucket (`e_*`) and the energy
consumed during the bucket (`d_*`), so totals over any range are a simple SUM and
stay exact even across gaps in the data.
"""

from __future__ import annotations

import contextlib
import json
import logging
import sqlite3
import threading
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .drivers.base import MeterReading

log = logging.getLogger(__name__)

SCHEMA_VERSION = 2

PHASES = (1, 2, 3)

# Cumulative energy counters: stored at the end of each bucket, with deltas per bucket.
COUNTERS = ("e_imp_t1", "e_imp_t2", "e_exp_t1", "e_exp_t2", "gas")
DELTAS = ("d_imp_t1", "d_imp_t2", "d_exp_t1", "d_exp_t2", "d_gas")
# Other counters where only the latest value matters.
EVENT_COUNTERS = ("fail_short", "fail_long")
LAST_VALUES = (*COUNTERS, *EVENT_COUNTERS)

SAMPLE_COLUMNS: dict[str, str] = {
    "p_imp": "REAL NOT NULL",
    "p_exp": "REAL NOT NULL",
    **{f"{q}_l{ph}": "REAL" for q in ("p", "v", "i") for ph in PHASES},
    **dict.fromkeys(COUNTERS, "REAL"),
    **dict.fromkeys(EVENT_COUNTERS, "INTEGER"),
}


def _weighted(col: str) -> str:
    return f"sum({col} * n) / sum(CASE WHEN {col} IS NOT NULL THEN n END)"


def _stat(col: str, fn: str, source: str) -> tuple[str, str, str]:
    """A rollup statistic: (column, expression over samples, expression over rollups)."""
    if fn == "avg":
        return col, f"avg({source})", _weighted(col)
    return col, f"{fn}({source})", f"{fn}({col})"


STATS: tuple[tuple[str, str, str], ...] = (
    _stat("p_imp_avg", "avg", "p_imp"),
    _stat("p_imp_max", "max", "p_imp"),
    _stat("p_exp_avg", "avg", "p_exp"),
    _stat("p_exp_max", "max", "p_exp"),
    *(
        _stat(f"{q}_l{ph}_{fn}", fn, f"{q}_l{ph}")
        for ph in PHASES
        for q, fns in (
            ("p", ("avg", "min", "max")),
            ("v", ("avg", "min", "max")),
            ("i", ("avg", "max")),
        )
        for fn in fns
    ),
    # Lowest and highest voltage across all phases.
    (
        "v_min",
        "min(min(coalesce(v_l1, 1e9), coalesce(v_l2, 1e9), coalesce(v_l3, 1e9)))",
        "min(v_min)",
    ),
    ("v_max", "max(max(coalesce(v_l1, 0), coalesce(v_l2, 0), coalesce(v_l3, 0)))", "max(v_max)"),
)
STAT_COLUMNS = tuple(s[0] for s in STATS)

AGG_COLUMNS: dict[str, str] = {
    "n": "INTEGER NOT NULL DEFAULT 0",
    **dict.fromkeys(STAT_COLUMNS, "REAL"),
    **dict.fromkeys(COUNTERS, "REAL"),
    **dict.fromkeys(DELTAS, "REAL"),
    **dict.fromkeys(EVENT_COUNTERS, "INTEGER"),
}

AGG_TABLES = ("agg_1m", "agg_1h", "agg_1d")


def _create_table(name: str, columns: dict[str, str]) -> str:
    cols = ",\n    ".join(f"{c} {t}" for c, t in columns.items())
    return f"CREATE TABLE IF NOT EXISTS {name} (\n    ts INTEGER PRIMARY KEY,\n    {cols}\n)"


def _delta(end: float | None, start: float | None) -> float | None:
    if end is None:
        return None
    if start is None or end < start:
        # No previous value, or the meter was replaced/reset.
        return 0.0
    return end - start


def _clean_voltage(column: str, value: float | None) -> float | None:
    # The cross-phase min/max use sentinels for missing phases.
    if value is None:
        return None
    if column == "v_min" and value >= 1e9:
        return None
    if column == "v_max" and value <= 0:
        return None
    return value


class Storage:
    def __init__(self, path: Path, timezone: str = "Europe/Amsterdam") -> None:
        self.path = path
        self.tz = ZoneInfo(timezone)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        # The database holds settings and encrypted secrets: keep it private to this user.
        for private in (path.parent, path):
            with contextlib.suppress(OSError):
                private.chmod(0o700 if private.is_dir() else 0o600)
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
            self._migrate()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ------------------------------------------------------------------ schema

    def _migrate(self) -> None:
        db = self._db
        db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        row = db.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        version = int(row[0]) if row else 0

        tables = {"samples": SAMPLE_COLUMNS, **dict.fromkeys(AGG_TABLES, AGG_COLUMNS)}
        for name, columns in tables.items():
            db.execute(_create_table(name, columns))
            existing = {r[1] for r in db.execute(f"PRAGMA table_info({name})")}
            for column, ctype in columns.items():
                if column not in existing:
                    # SQLite can't add NOT NULL columns without a default.
                    db.execute(
                        f"ALTER TABLE {name} ADD COLUMN {column} {ctype.replace(' NOT NULL', '')}"
                    )

        if 0 < version < 2:
            # Version 2 added per-phase statistics. Rebuild rollups wherever raw samples
            # still exist; the next rollup fills them in again.
            first = db.execute("SELECT min(ts) FROM samples").fetchone()[0]
            if first is not None:
                log.info("Migrating rollups to schema 2 from %s", first)
                db.execute("DELETE FROM agg_1m WHERE ts >= ?", (first // 60 * 60,))

        db.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )

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
                r.power_failures,
                r.long_power_failures,
            )  # fmt: skip
            for r in readings
        ]
        columns = ("ts", *SAMPLE_COLUMNS)
        with self._lock:
            self._db.execute("BEGIN")
            self._db.executemany(
                f"INSERT OR REPLACE INTO samples ({', '.join(columns)}) "
                f"VALUES ({', '.join('?' * len(columns))})",
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
        stats_sql = ", ".join(f"{expr} AS {col}" for col, expr, _ in STATS)
        aggregates = db.execute(
            f"SELECT ts / 60 * 60 AS m, count(*) AS n, {stats_sql} FROM samples "
            "WHERE ts >= ? AND ts < ? GROUP BY m ORDER BY m",
            (start, end),
        ).fetchall()
        if not aggregates:
            return 0

        last_cols = ", ".join(LAST_VALUES)

        def edge_rows(fn: str) -> dict[int, sqlite3.Row]:
            return {
                row["ts"] // 60 * 60: row
                for row in db.execute(
                    f"SELECT ts, {last_cols} FROM samples WHERE ts IN ("
                    f"SELECT {fn}(ts) FROM samples WHERE ts >= ? AND ts < ? GROUP BY ts / 60)",
                    (start, end),
                )
            }

        last_rows, first_rows = edge_rows("max"), edge_rows("min")
        prev_row = db.execute(
            f"SELECT {', '.join(COUNTERS)} FROM agg_1m WHERE ts < ? ORDER BY ts DESC LIMIT 1",
            (start,),
        ).fetchone()
        prev: dict[str, float | None] = dict(prev_row) if prev_row else dict.fromkeys(COUNTERS)

        columns = ("ts", "n", *STAT_COLUMNS, *LAST_VALUES, *DELTAS)
        rows = []
        for agg in aggregates:
            minute = agg["m"]
            last, first = last_rows[minute], first_rows[minute]
            deltas = []
            for counter in COUNTERS:
                begin = prev[counter] if prev[counter] is not None else first[counter]
                deltas.append(_delta(last[counter], begin))
                # Carry counters forward, keeping the previous value where this minute has none.
                if last[counter] is not None:
                    prev[counter] = last[counter]
            stats = [_clean_voltage(c, agg[c]) for c in STAT_COLUMNS]
            rows.append((minute, agg["n"], *stats, *(last[c] for c in LAST_VALUES), *deltas))

        db.executemany(
            f"INSERT OR REPLACE INTO agg_1m ({', '.join(columns)}) "
            f"VALUES ({', '.join('?' * len(columns))})",
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
        stats_sql = ", ".join(f"{expr} AS {col}" for col, _, expr in STATS)
        deltas_sql = ", ".join(f"sum({d}) AS {d}" for d in DELTAS)
        columns = ("ts", "n", *STAT_COLUMNS, *DELTAS, *LAST_VALUES)
        insert = (
            f"INSERT OR REPLACE INTO {dst} ({', '.join(columns)}) "
            f"VALUES ({', '.join('?' * len(columns))})"
        )
        for bucket_start, bucket_end in buckets:
            agg = db.execute(
                f"SELECT sum(n) AS n, {stats_sql}, {deltas_sql} FROM {src} "
                "WHERE ts >= ? AND ts < ?",
                (bucket_start, bucket_end),
            ).fetchone()
            if not agg["n"]:
                continue
            last = db.execute(
                f"SELECT {', '.join(LAST_VALUES)} FROM {src} WHERE ts >= ? AND ts < ? "
                "ORDER BY ts DESC LIMIT 1",
                (bucket_start, bucket_end),
            ).fetchone()
            db.execute(insert, (bucket_start, *agg, *last))

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
