from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from jouleflow import queries
from jouleflow.drivers.base import MeterReading
from jouleflow.drivers.esphome_p1 import EspHomeP1Driver
from jouleflow.storage import Storage

TZ = ZoneInfo("Europe/Amsterdam")


def local_ts(*args: int) -> int:
    return int(datetime(*args, tzinfo=TZ).timestamp())


def make_readings(
    start: int,
    seconds: int,
    import_w: float,
    export_w: float = 0.0,
    counters: tuple[float, float] = (1000.0, 500.0),
) -> list[MeterReading]:
    """Constant power for `seconds`, with counters advancing accordingly (all on tariff 1)."""
    imp, exp = counters
    readings = []
    for i in range(seconds):
        readings.append(MeterReading(
            ts=start + i, power_import=import_w, power_export=export_w,
            power_l1=import_w - export_w, voltage_l1=230.0 + (i % 3), voltage_l2=231.0,
            voltage_l3=232.0, energy_import_t1=imp + import_w * i / 3_600_000,
            energy_import_t2=0.0, energy_export_t1=exp + export_w * i / 3_600_000,
            energy_export_t2=0.0,
        ))  # fmt: skip
    return readings


@pytest.fixture
def storage(tmp_path):
    s = Storage(tmp_path / "test.db", "Europe/Amsterdam")
    yield s
    s.close()


def test_minute_rollup_averages_and_deltas(storage):
    start = local_ts(2026, 9, 13, 12, 0)
    storage.insert_samples(make_readings(start, 180, import_w=1200))
    storage.rollup_all(start + 180)

    rows = storage.query("SELECT * FROM agg_1m ORDER BY ts")
    assert len(rows) == 3
    assert rows[0]["p_imp_avg"] == pytest.approx(1200)
    assert rows[0]["v_min"] == 230.0 and rows[0]["v_max"] == 232.0
    # 3 minutes at 1.2 kW = 0.06 kWh in total (first minute measures from its first sample).
    total = sum(r["d_imp_t1"] for r in rows)
    assert total == pytest.approx(1200 * 179 / 3_600_000)


def test_rollup_is_incremental_and_idempotent(storage):
    start = local_ts(2026, 9, 13, 12, 0)
    readings = make_readings(start, 600, import_w=600)
    storage.insert_samples(readings[:300])
    storage.rollup_all(start + 300)
    storage.insert_samples(readings[300:])
    storage.rollup_all(start + 600)
    storage.rollup_all(start + 600)

    minutes = storage.query("SELECT sum(d_imp_t1) AS d, count(*) AS n FROM agg_1m")[0]
    hour = storage.query_one("SELECT * FROM agg_1h")
    day = storage.query_one("SELECT * FROM agg_1d")
    assert minutes["n"] == 10
    assert hour["d_imp_t1"] == pytest.approx(minutes["d"])
    assert day["d_imp_t1"] == pytest.approx(minutes["d"])
    assert day["ts"] == local_ts(2026, 9, 13)
    assert day["n"] == 600


def test_gap_energy_is_not_lost(storage):
    start = local_ts(2026, 9, 13, 10, 0)
    storage.insert_samples(make_readings(start, 60, 1000, counters=(1000.0, 0.0)))
    # Offline for an hour; the meter kept counting 1 kWh.
    later = start + 3600
    storage.insert_samples(make_readings(later, 60, 1000, counters=(1001.0, 0.0)))
    storage.rollup_all(later + 120)

    total = storage.query_one("SELECT sum(d_imp_t1) AS d FROM agg_1d")["d"]
    last_counter = 1001.0 + 1000 * 59 / 3_600_000
    first_counter = 1000.0
    assert total == pytest.approx(last_counter - first_counter)


def test_daily_buckets_follow_local_midnight_across_dst(storage):
    # DST ends in the Netherlands on 25 October 2026: that day has 25 hours.
    day = local_ts(2026, 10, 25)
    assert storage.next_local_midnight(day) - day == 25 * 3600
    start, end = queries.period_bounds(storage, "day", date(2026, 10, 25))
    assert end - start == 25 * 3600


def test_today_summary_and_history(storage):
    day = local_ts(2026, 9, 13)
    # Yesterday evening and this morning.
    storage.insert_samples(make_readings(day - 3600, 600, 2000, counters=(100.0, 50.0)))
    storage.insert_samples(make_readings(day + 8 * 3600, 600, 1000, 0, counters=(101.0, 50.0)))
    storage.insert_samples(make_readings(day + 12 * 3600, 600, 0, 1500, counters=(101.2, 50.0)))
    now = day + 12 * 3600 + 700
    storage.rollup_all(now)

    summary = queries.today_summary(storage, now)
    # Counters at midnight = yesterday's last sample; now = last sample today.
    expected_import = (101.2) - (100.0 + 2000 * 599 / 3_600_000)
    assert summary["today"]["import"] == pytest.approx(expected_import, abs=1e-3)
    assert summary["today"]["export"] == pytest.approx(1500 * 599 / 3_600_000, abs=1e-3)
    assert summary["peak_import"]["w"] == 1000
    assert summary["export_window"]["start"] == day + 12 * 3600

    hist = queries.history(storage, "day", date(2026, 9, 13))
    assert len(hist["bars"]) == 24
    assert hist["totals"]["export"] == pytest.approx(1500 * 599 / 3_600_000, abs=1e-3)

    month = queries.history(storage, "month", date(2026, 9, 13))
    assert len(month["bars"]) == 30
    year = queries.history(storage, "year", date(2026, 9, 13))
    assert len(year["bars"]) == 12


def test_first_day_without_earlier_data_counts_from_first_sample(storage):
    start = local_ts(2026, 9, 13, 14, 42)
    storage.insert_samples(make_readings(start, 1200, 1500, counters=(3356.0, 1023.0)))
    now = start + 1200
    storage.rollup_all(now)
    summary = queries.today_summary(storage, now)
    assert summary["today"]["import"] == pytest.approx(1500 * 1199 / 3_600_000, abs=1e-3)


def test_esphome_driver_parses_states():
    driver = EspHomeP1Driver("http://meter")
    for payload in (
        '{"id":"sensor-power_consumed","value":0.091}',
        '{"id":"sensor-power_produced","value":0.646}',
        '{"id":"sensor-power_consumed_phase_1","value":0}',
        '{"id":"sensor-power_produced_phase_1","value":0.646}',
        '{"id":"sensor-energy_consumed_tariff_1","value":1837.071}',
        '{"id":"sensor-gas_consumed","value":null}',
    ):
        driver.handle_state(payload)
    reading = driver.snapshot()
    assert reading is not None
    # Phases are netted: 91 W imported on other phases, 646 W exported on L1.
    assert reading.power_import == 0
    assert reading.power_export == pytest.approx(555)
    assert reading.power_l1 == pytest.approx(-646)
    assert reading.energy_import_t1 == 1837.071
    assert reading.gas is None
