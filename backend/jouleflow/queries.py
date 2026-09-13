"""Read-side queries that turn stored data into what the web app shows."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Literal

from .storage import COUNTERS, Storage

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
        return {"import": None, "export": None, "gas": None}

    def diff(*keys: str) -> float | None:
        e = _sum(*(end[k] for k in keys))
        s = _sum(*(start[k] for k in keys))
        return None if e is None or s is None else max(e - s, 0.0)

    return {
        "import": _round(diff("e_imp_t1", "e_imp_t2")),
        "export": _round(diff("e_exp_t1", "e_exp_t2")),
        "gas": _round(diff("gas")),
    }


def _change(today: float | None, yesterday: float | None) -> float | None:
    if today is None or not yesterday:
        return None
    return round((today - yesterday) / yesterday * 100, 1)


# ---------------------------------------------------------------------- live summary


def today_summary(storage: Storage, now: int) -> dict:
    day_start = storage.local_midnight(now)
    yesterday_start = storage.local_midnight(day_start - 1)
    yesterday_same_time = min(yesterday_start + (now - day_start), day_start)

    today = energy_between(storage, day_start, now)
    yesterday = energy_between(storage, yesterday_start, yesterday_same_time)
    yesterday_full = energy_between(storage, yesterday_start, day_start)

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
        },
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


# ---------------------------------------------------------------------- power series


def power_series(storage: Storage, range_: Range, now: int) -> dict:
    """Import/export power over a recent window. Points are [ts, import_w, export_w]."""
    if range_ == "hour":
        bucket, since = 5, now - 3600
        rows = storage.query(
            "SELECT ts / 5 * 5 AS t, avg(p_imp) AS i, avg(p_exp) AS e FROM samples "
            "WHERE ts >= ? GROUP BY t ORDER BY t",
            (since,),
        )
    elif range_ == "day":
        bucket, since = 60, now - 86400
        rows = storage.query(
            "SELECT ts AS t, p_imp_avg AS i, p_exp_avg AS e FROM agg_1m WHERE ts >= ? ORDER BY ts",
            (since,),
        )
    else:
        bucket, since = 900, now - 7 * 86400
        rows = storage.query(
            "SELECT ts / 900 * 900 AS t, sum(p_imp_avg * n) / sum(n) AS i, "
            "sum(p_exp_avg * n) / sum(n) AS e FROM agg_1m WHERE ts >= ? GROUP BY t ORDER BY t",
            (since,),
        )
    return {
        "range": range_,
        "bucket_seconds": bucket,
        "start": since,
        "end": now,
        "points": [[r["t"], round(r["i"], 1), round(r["e"], 1)] for r in rows],
    }


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


def history(storage: Storage, period: Period, anchor: date) -> dict:
    start, end = period_bounds(storage, period, anchor)
    prev_start, prev_end = period_bounds(storage, period, previous_anchor(period, anchor))

    source = "agg_1h" if period == "day" else "agg_1d"
    rows = storage.query(
        f"SELECT ts, d_imp_t1, d_imp_t2, d_exp_t1, d_exp_t2, d_gas FROM {source} "
        "WHERE ts >= ? AND ts < ? ORDER BY ts",
        (start, end),
    )

    starts = _bucket_starts(storage, period, start, end)
    buckets: dict[int, list] = {s: [s, None, None, None] for s in starts}
    for r in rows:
        key = r["ts"]
        if period == "year":
            key = max(s for s in starts if s <= r["ts"])
        if key not in buckets:
            continue
        b = buckets[key]
        b[1] = _sum(b[1], r["d_imp_t1"], r["d_imp_t2"])
        b[2] = _sum(b[2], r["d_exp_t1"], r["d_exp_t2"])
        b[3] = _sum(b[3], r["d_gas"])
    bars = [[b[0], _round(b[1]), _round(b[2]), _round(b[3])] for b in buckets.values()]

    power: list[list] = []
    if period == "day":
        power_rows = storage.query(
            "SELECT ts, p_imp_avg AS i, p_exp_avg AS e FROM agg_1m "
            "WHERE ts >= ? AND ts < ? ORDER BY ts",
            (start, end),
        ) or storage.query(
            "SELECT ts, p_imp_avg AS i, p_exp_avg AS e FROM agg_1h "
            "WHERE ts >= ? AND ts < ? ORDER BY ts",
            (start, end),
        )
        power = [[r["ts"], round(r["i"], 1), round(r["e"], 1)] for r in power_rows]

    first = storage.query_one("SELECT min(ts) AS t FROM agg_1d")["t"]

    return {
        "period": period,
        "anchor": anchor.isoformat(),
        "start": start,
        "end": end,
        "bars": bars,
        "power": power,
        "totals": _totals(storage, start, end),
        "previous": {
            "start": prev_start,
            "end": prev_end,
            **_totals(storage, prev_start, prev_end),
        },
        "first_data": first,
    }
