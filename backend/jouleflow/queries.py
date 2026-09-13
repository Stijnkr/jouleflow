"""Read-side queries that turn stored data into what the web app shows."""

from __future__ import annotations

import re
import time
from datetime import date, datetime, timedelta
from typing import Literal

from .storage import COUNTERS, STAT_COLUMNS, STATS, Storage
from .tariffs import TariffSettings, bucket_cost, current_rate, day_of, sum_costs

Range = Literal["hour", "day", "week"]
Period = Literal["day", "week", "month", "year"]

EXPORT_THRESHOLD_W = 50.0


def _sum(*values: float | None) -> float | None:
    present = [v for v in values if v is not None]
    return sum(present) if present else None


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(value, digits)


# ---------------------------------------------------------------------- counters & energy


def counters_at(storage: Storage, t: int) -> dict | None:
    """Meter counters as they were at time `t`, using the most detailed data available."""
    cols = ", ".join(COUNTERS)
    candidates = [
        storage.query_one(
            f"SELECT ts, {cols} FROM samples WHERE ts <= ? ORDER BY ts DESC LIMIT 1", (t,)
        ),
        storage.query_one(
            f"SELECT ts + 60 AS ts, {cols} FROM agg_1m WHERE ts <= ? ORDER BY ts DESC LIMIT 1",
            (t - 60,),
        ),
        storage.query_one(
            f"SELECT ts + 3600 AS ts, {cols} FROM agg_1h WHERE ts <= ? ORDER BY ts DESC LIMIT 1",
            (t - 3600,),
        ),
    ]
    rows = [r for r in candidates if r is not None and r["e_imp_t1"] is not None]
    if not rows:
        return None
    return dict(max(rows, key=lambda r: r["ts"]))


def earliest_counters(storage: Storage) -> dict | None:
    # Rollup rows hold counters at the *end* of their bucket, so date them accordingly.
    cols = ", ".join(COUNTERS)
    rows = [
        storage.query_one(f"SELECT ts + 3600 AS ts, {cols} FROM agg_1h ORDER BY ts LIMIT 1"),
        storage.query_one(f"SELECT ts + 60 AS ts, {cols} FROM agg_1m ORDER BY ts LIMIT 1"),
        storage.query_one(f"SELECT ts, {cols} FROM samples ORDER BY ts LIMIT 1"),
    ]
    rows = [r for r in rows if r is not None and r["e_imp_t1"] is not None]
    return dict(min(rows, key=lambda r: r["ts"])) if rows else None


def energy_between(storage: Storage, t0: int, t1: int) -> dict:
    end = counters_at(storage, t1)
    start = counters_at(storage, t0)
    if start is None:
        start = earliest_counters(storage)
    if end is None or start is None or start["ts"] > t1:
        return dict.fromkeys(
            (
                "import",
                "export",
                "gas",
                "import_low",
                "import_normal",
                "export_low",
                "export_normal",
            )
        )

    def diff(*keys: str) -> float | None:
        e = _sum(*(end[k] for k in keys))
        s = _sum(*(start[k] for k in keys))
        return None if e is None or s is None else max(e - s, 0.0)

    return {
        "import": _round(diff("e_imp_t1", "e_imp_t2")),
        "export": _round(diff("e_exp_t1", "e_exp_t2")),
        "gas": _round(diff("gas")),
        "import_low": _round(diff("e_imp_t1")),
        "import_normal": _round(diff("e_imp_t2")),
        "export_low": _round(diff("e_exp_t1")),
        "export_normal": _round(diff("e_exp_t2")),
    }


def _energy_cost(
    tariffs: TariffSettings | None, day: date, energy: dict, fixed_days: float
) -> dict | None:
    contract = tariffs.contract_on(day) if tariffs else None
    if contract is None or energy["import"] is None:
        return None
    cost = bucket_cost(
        contract,
        day,
        imp_low=energy["import_low"],
        imp_normal=energy["import_normal"],
        exp_low=energy["export_low"],
        exp_normal=energy["export_normal"],
        gas=energy["gas"],
        fixed_days=fixed_days,
    )
    return {k: round(v, 2) for k, v in cost.items()}


def _change(today: float | None, yesterday: float | None) -> float | None:
    if today is None or not yesterday:
        return None
    return round((today - yesterday) / yesterday * 100, 1)


# ---------------------------------------------------------------------- live summary


def today_summary(storage: Storage, now: int, tariffs: TariffSettings | None = None) -> dict:
    day_start = storage.local_midnight(now)
    yesterday_start = storage.local_midnight(day_start - 1)
    yesterday_same_time = min(yesterday_start + (now - day_start), day_start)

    today = energy_between(storage, day_start, now)
    yesterday = energy_between(storage, yesterday_start, yesterday_same_time)
    yesterday_full = energy_between(storage, yesterday_start, day_start)

    # Only count fixed costs for the part of the day Jouleflow has been measuring.
    first = storage.query_one("SELECT min(ts) AS t FROM samples")["t"] or now
    today_day = day_of(now, storage.tz)
    cost_today = _energy_cost(tariffs, today_day, today, (now - max(day_start, first)) / 86400)
    cost_yesterday = _energy_cost(
        tariffs,
        day_of(yesterday_start, storage.tz),
        yesterday,
        max(yesterday_same_time - max(yesterday_start, first), 0) / 86400,
    )

    peak_import = _peak(storage, "p_imp", day_start)
    peak_export = _peak(storage, "p_exp", day_start)

    window = storage.query_one(
        "SELECT min(ts) AS first, max(ts) + 60 AS last FROM agg_1m "
        "WHERE ts >= ? AND p_exp_avg >= ?",
        (day_start, EXPORT_THRESHOLD_W),
    )

    return {
        "day_start": day_start,
        "today": today,
        "yesterday_same_time": yesterday,
        "yesterday": yesterday_full,
        "change_pct": {
            "import": _change(today["import"], yesterday["import"]),
            "export": _change(today["export"], yesterday["export"]),
            "gas": _change(today["gas"], yesterday["gas"]),
            "cost": _change(
                cost_today["total"] if cost_today else None,
                cost_yesterday["total"] if cost_yesterday and first <= yesterday_start else None,
            ),
        },
        "cost_today": cost_today,
        "rate_now": current_rate(tariffs, now, storage.tz) if tariffs else None,
        "peak_import": peak_import,
        "peak_export": peak_export,
        "export_window": (
            {"start": window["first"], "end": window["last"]}
            if window and window["first"] is not None
            else None
        ),
    }


def _peak(storage: Storage, column: str, since: int) -> dict | None:
    minute = storage.query_one(
        f"SELECT ts, {column}_max AS w FROM agg_1m WHERE ts >= ? "
        f"ORDER BY {column}_max DESC LIMIT 1",
        (since,),
    )
    rolled_until = storage.query_one("SELECT max(ts) + 60 AS t FROM agg_1m")["t"] or since
    recent = storage.query_one(
        f"SELECT ts, {column} AS w FROM samples WHERE ts >= ? ORDER BY {column} DESC LIMIT 1",
        (max(since, rolled_until),),
    )
    rows = [r for r in (minute, recent) if r is not None and r["w"] is not None]
    if not rows:
        return None
    best = max(rows, key=lambda r: r["w"])
    return {"ts": best["ts"], "w": round(best["w"], 1)}


# ---------------------------------------------------------------------- measurement series

# Fields every series point can contain. Rollups provide min/max per bucket.
SERIES_FIELDS = (
    "p_imp_avg", "p_imp_max", "p_exp_avg", "p_exp_max",
    *(name for name in STAT_COLUMNS if re.fullmatch(r"[pvi]_l[123]_(avg|min|max)", name)),
)  # fmt: skip

_STAT_EXPR = {col: (sample_expr, rollup_expr) for col, sample_expr, rollup_expr in STATS}

# (bucket seconds, source table) per live window.
LIVE_WINDOWS: dict[str, tuple[int, int, str]] = {
    "hour": (3600, 5, "samples"),
    "day": (86400, 60, "agg_1m"),
    "week": (7 * 86400, 900, "agg_1m"),
}

# Finest resolution that keeps the number of points reasonable, with fallbacks for
# periods whose detailed data has expired.
HISTORY_SOURCES: dict[str, tuple[tuple[int, str], ...]] = {
    "day": ((60, "agg_1m"), (3600, "agg_1h")),
    "week": ((900, "agg_1m"), (3600, "agg_1h")),
    "month": ((3600, "agg_1h"), (86400, "agg_1d")),
    "year": ((86400, "agg_1d"),),
}


def _series_rows(storage: Storage, source: str, bucket: int, start: int, end: int) -> list:
    exprs = []
    for field in SERIES_FIELDS:
        sample_expr, rollup_expr = _STAT_EXPR[field]
        exprs.append(f"{sample_expr if source == 'samples' else rollup_expr} AS {field}")
    # Daily rollups are keyed by local midnight, so don't re-bucket them in UTC.
    key = "ts" if source == "agg_1d" else f"ts / {bucket} * {bucket}"
    return storage.query(
        f"SELECT {key} AS t, {', '.join(exprs)} FROM {source} "
        "WHERE ts >= ? AND ts < ? GROUP BY t ORDER BY t",
        (start, end),
    )


def _series_payload(rows: list, bucket: int, start: int, end: int) -> dict:
    def rounded(field: str, value: float | None) -> float | None:
        if value is None:
            return None
        return round(value, 2 if field.startswith("i_") else 1)

    return {
        "bucket_seconds": bucket,
        "start": start,
        "end": end,
        "fields": ["ts", *SERIES_FIELDS],
        "points": [[r["t"], *(rounded(f, r[f]) for f in SERIES_FIELDS)] for r in rows],
    }


def live_series(storage: Storage, range_: Range, now: int) -> dict:
    """All measurements over a recent window (last hour, day or week)."""
    length, bucket, source = LIVE_WINDOWS[range_]
    start = now - length
    rows = _series_rows(storage, source, bucket, start, now + 1)
    return {"range": range_, **_series_payload(rows, bucket, start, now)}


def history_series(storage: Storage, period: Period, anchor: date) -> dict:
    """All measurements over a calendar period, at the finest resolution still stored."""
    start, end = period_bounds(storage, period, anchor)
    rows: list = []
    bucket = HISTORY_SOURCES[period][0][0]
    for bucket_seconds, source in HISTORY_SOURCES[period]:
        rows = _series_rows(storage, source, bucket_seconds, start, end)
        bucket = bucket_seconds
        if rows:
            break
    return {"period": period, **_series_payload(rows, bucket, start, end)}


# ---------------------------------------------------------------------- history


def period_bounds(storage: Storage, period: Period, anchor: date) -> tuple[int, int]:
    tz = storage.tz
    if period == "day":
        start = datetime(anchor.year, anchor.month, anchor.day, tzinfo=tz)
        end = start + timedelta(days=1)
    elif period == "week":
        monday = anchor - timedelta(days=anchor.weekday())
        start = datetime(monday.year, monday.month, monday.day, tzinfo=tz)
        end = start + timedelta(days=7)
    elif period == "month":
        start = datetime(anchor.year, anchor.month, 1, tzinfo=tz)
        end = (
            datetime(anchor.year + 1, 1, 1, tzinfo=tz)
            if anchor.month == 12
            else datetime(anchor.year, anchor.month + 1, 1, tzinfo=tz)
        )
    else:
        start = datetime(anchor.year, 1, 1, tzinfo=tz)
        end = datetime(anchor.year + 1, 1, 1, tzinfo=tz)
    # Aware datetimes with ZoneInfo use wall-clock arithmetic, so DST days are 23/25 h.
    return int(start.timestamp()), int(end.timestamp())


def previous_anchor(period: Period, anchor: date) -> date:
    if period == "day":
        return anchor - timedelta(days=1)
    if period == "week":
        return anchor - timedelta(days=7)
    if period == "month":
        first = anchor.replace(day=1)
        return (first - timedelta(days=1)).replace(day=1)
    return anchor.replace(year=anchor.year - 1, month=1, day=1)


def _bucket_starts(storage: Storage, period: Period, start: int, end: int) -> list[int]:
    if period == "day":
        return list(range(start, end, 3600))
    starts = []
    t = start
    while t < end:
        starts.append(t)
        if period == "year":
            dt = datetime.fromtimestamp(t, storage.tz)
            nxt = dt.replace(year=dt.year + (dt.month == 12), month=dt.month % 12 + 1, day=1)
            t = int(nxt.timestamp())
        else:
            t = storage.next_local_midnight(t)
    return starts


def _totals(storage: Storage, start: int, end: int) -> dict:
    row = storage.query_one(
        "SELECT sum(d_imp_t1) AS i1, sum(d_imp_t2) AS i2, sum(d_exp_t1) AS e1, "
        "sum(d_exp_t2) AS e2, sum(d_gas) AS g, max(p_imp_max) AS pi, max(p_exp_max) AS pe, "
        "count(*) AS days FROM agg_1d WHERE ts >= ? AND ts < ?",
        (start, end),
    )
    imp = _sum(row["i1"], row["i2"])
    exp = _sum(row["e1"], row["e2"])
    return {
        "import": _round(imp),
        "import_low": _round(row["i1"]),
        "import_normal": _round(row["i2"]),
        "export": _round(exp),
        "export_low": _round(row["e1"]),
        "export_normal": _round(row["e2"]),
        "net": _round(None if imp is None else imp - (exp or 0.0)),
        "gas": _round(row["g"]),
        "peak_import_w": _round(row["pi"], 1),
        "peak_export_w": _round(row["pe"], 1),
    }


def _row_costs(
    storage: Storage,
    tariffs: TariffSettings | None,
    rows: list,
    source: str,
    now: int,
) -> list[dict | None]:
    """Cost per rollup row. Fixed costs cover only the measured part of each bucket."""
    if not tariffs or not tariffs.contracts:
        return [None] * len(rows)
    first = storage.query_one("SELECT min(ts) AS t FROM agg_1m")["t"] or now
    costs: list[dict | None] = []
    for r in rows:
        day = day_of(r["ts"], storage.tz)
        contract = tariffs.contract_on(day)
        if contract is None:
            costs.append(None)
            continue
        bucket_end = r["ts"] + 3600 if source == "agg_1h" else storage.next_local_midnight(r["ts"])
        measured = max(min(bucket_end, now) - max(r["ts"], first), 0)
        costs.append(
            bucket_cost(
                contract,
                day,
                imp_low=r["d_imp_t1"],
                imp_normal=r["d_imp_t2"],
                exp_low=r["d_exp_t1"],
                exp_normal=r["d_exp_t2"],
                gas=r["d_gas"],
                fixed_days=measured / 86400,
            )
        )
    return costs


def _period_cost(
    storage: Storage, tariffs: TariffSettings | None, start: int, end: int, now: int
) -> dict | None:
    rows = storage.query(
        "SELECT ts, d_imp_t1, d_imp_t2, d_exp_t1, d_exp_t2, d_gas FROM agg_1d "
        "WHERE ts >= ? AND ts < ? ORDER BY ts",
        (start, end),
    )
    return sum_costs([c for c in _row_costs(storage, tariffs, rows, "agg_1d", now) if c])


def history(
    storage: Storage,
    period: Period,
    anchor: date,
    tariffs: TariffSettings | None = None,
    now: int | None = None,
) -> dict:
    now = int(time.time()) if now is None else now
    start, end = period_bounds(storage, period, anchor)
    prev_start, prev_end = period_bounds(storage, period, previous_anchor(period, anchor))

    source = "agg_1h" if period == "day" else "agg_1d"
    rows = storage.query(
        f"SELECT ts, d_imp_t1, d_imp_t2, d_exp_t1, d_exp_t2, d_gas FROM {source} "
        "WHERE ts >= ? AND ts < ? ORDER BY ts",
        (start, end),
    )
    row_costs = _row_costs(storage, tariffs, rows, source, now)

    starts = _bucket_starts(storage, period, start, end)
    buckets: dict[int, list] = {s: [s, None, None, None, None] for s in starts}
    for r, cost in zip(rows, row_costs, strict=True):
        key = r["ts"]
        if period == "year":
            key = max(s for s in starts if s <= r["ts"])
        if key not in buckets:
            continue
        b = buckets[key]
        b[1] = _sum(b[1], r["d_imp_t1"], r["d_imp_t2"])
        b[2] = _sum(b[2], r["d_exp_t1"], r["d_exp_t2"])
        b[3] = _sum(b[3], r["d_gas"])
        b[4] = _sum(b[4], cost["total"] if cost else None)
    bars = [
        [b[0], _round(b[1]), _round(b[2]), _round(b[3]), _round(b[4], 2)] for b in buckets.values()
    ]

    first = storage.query_one("SELECT min(ts) AS t FROM agg_1d")["t"]

    return {
        "period": period,
        "anchor": anchor.isoformat(),
        "start": start,
        "end": end,
        "bars": bars,
        "totals": {
            **_totals(storage, start, end),
            "cost": sum_costs([c for c in row_costs if c]),
        },
        "previous": {
            "start": prev_start,
            "end": prev_end,
            **_totals(storage, prev_start, prev_end),
            "cost": _period_cost(storage, tariffs, prev_start, prev_end, now),
        },
        "first_data": first,
    }
