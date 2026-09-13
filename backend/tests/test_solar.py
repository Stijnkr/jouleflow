import asyncio

import pytest

from jouleflow.solar import InverterConfig, SolarManager, SolarSettings, parse_growatt
from jouleflow.storage import Storage

# Input registers 0-94 read from a Growatt MIC 2500TL-X in the evening (non-zero values only).
MIC_REGISTERS = dict.fromkeys(range(95), 0) | {
    0: 1, 2: 465, 3: 1775, 4: 2, 6: 465, 36: 455, 37: 5004, 38: 2343, 39: 3, 41: 472,
    50: 2343, 54: 37, 56: 20216, 57: 311, 58: 6081, 60: 32, 62: 17900, 92: 17900, 93: 351,
    94: 351,
}  # fmt: skip


@pytest.fixture
def manager(tmp_path):
    storage = Storage(tmp_path / "solar.db")
    manager = SolarManager(storage, raw_retention_days=7)
    manager.settings.inverters = [InverterConfig(id="mic", host="192.168.1.100")]
    manager._sync_states()
    yield manager
    storage.close()


def insert(manager, start, seconds, power, total_from, total_to, step=10):
    n = seconds // step
    with manager.storage._lock:
        manager.storage._db.executemany(
            "INSERT OR REPLACE INTO solar_samples VALUES ('mic', ?, ?, ?, 230, 35, ?)",
            [
                (
                    start + i * step,
                    power,
                    power,
                    round(total_from + (total_to - total_from) * i / n, 1),
                )
                for i in range(n + 1)
            ],
        )


def test_growatt_registers_are_decoded():
    r = parse_growatt([MIC_REGISTERS[i] for i in range(95)])
    assert r.status == "normal"
    assert r.pv_power == 46.5
    assert r.pv1_voltage == 177.5
    assert r.power == 45.5
    assert r.frequency == 50.04
    assert r.grid_voltage == 234.3
    assert r.today_kwh == 3.7
    assert r.total_kwh == 2021.6
    assert r.temperature == 35.1


def test_energy_comes_from_the_lifetime_counter(manager):
    hour = 1_789_300_800
    insert(manager, hour, 3599, power=1500, total_from=2000.0, total_to=2001.5)
    insert(manager, hour + 3600, 1800, power=800, total_from=2001.5, total_to=2001.9)
    manager.rollup(hour + 7200)
    rows = manager.storage._db.execute("SELECT energy FROM solar_agg_1h ORDER BY ts").fetchall()
    assert [round(r["energy"], 2) for r in rows] == [1.5, 0.4]
    assert manager.energy_between(hour, hour + 7200)["mic"] == pytest.approx(1.9, abs=0.01)


def test_energy_produced_while_unreachable_is_not_lost(manager):
    hour = 1_789_300_800
    insert(manager, hour, 600, power=500, total_from=2000.0, total_to=2000.1)
    # Nothing stored for two hours, then the counter has moved on by 3 kWh.
    insert(manager, hour + 3 * 3600, 600, power=1000, total_from=2003.1, total_to=2003.2)
    manager.rollup(hour + 4 * 3600)
    assert manager.energy_between(hour, hour + 4 * 3600)["mic"] == pytest.approx(3.2, abs=0.02)


def test_recent_samples_count_before_they_are_rolled_up(manager):
    hour = 1_789_300_800
    insert(manager, hour, 3599, power=1000, total_from=2000.0, total_to=2001.0)
    manager.rollup(hour + 3600)
    insert(manager, hour + 3600, 900, power=1000, total_from=2001.0, total_to=2001.25)
    assert manager.energy_between(hour, hour + 4500)["mic"] == pytest.approx(1.25, abs=0.01)


def test_hourly_energy_follows_power_within_one_counter_step(manager):
    hour = 1_789_300_800
    # 1234 W for an hour; the 0.1 kWh counter only shows 1.2.
    insert(manager, hour, 3599, power=1234, total_from=2000.0, total_to=2001.2)
    manager.rollup(hour + 3600)
    energy = manager.storage.query_one("SELECT energy FROM solar_agg_1h")["energy"]
    assert energy == pytest.approx(1.234, abs=0.005)


def test_counter_reset_does_not_create_negative_or_huge_energy(manager):
    hour = 1_789_300_800
    insert(manager, hour, 3599, power=1000, total_from=2000.0, total_to=2001.0)
    manager.rollup(hour + 3600)
    insert(manager, hour + 3600, 3599, power=1000, total_from=0.0, total_to=0.8)
    manager.rollup(hour + 7200)
    assert manager.energy_between(hour + 3600, hour + 7200)["mic"] == pytest.approx(0.8)


def test_settings_are_stored_and_reload(tmp_path):
    storage = Storage(tmp_path / "s.db")
    manager = SolarManager(storage, 7)
    inverter = InverterConfig(name="Zonnepanelen", host="192.168.1.100", unit_id=1)
    asyncio.run(manager.update_settings(SolarSettings(inverters=[inverter])))
    again = SolarManager(storage, 7)
    assert again.settings.inverters == [inverter]
    assert again.public_states()[0]["display_name"] == "Zonnepanelen"
    storage.close()


def test_average_into_buckets_counts_missing_slots_as_zero_after_solar_started():
    from jouleflow.solar import average_into_buckets

    points = [(1000, 600.0), (1010, 1200.0)]  # two 10 s slots, then the inverter sleeps
    # A 60 s bucket: (600 + 1200) / 6 slots.
    assert average_into_buckets(points, 10, [1000], 60, since=1000) == [300.0]
    # 5 s buckets take the value of the slot they fall in, and 0 outside any slot.
    assert average_into_buckets(points, 10, [1005, 1015, 1025], 5, since=1000) == [
        600.0,
        1200.0,
        0.0,
    ]
    # A short gap between readings is bridged; a long one (night) is not.
    bridged = [(1000, 1000.0), (1060, 1600.0)]
    assert average_into_buckets(bridged, 10, [1030], 5, since=1000) == [1300.0]
    night = [(1000, 1000.0), (5000, 0.0)]
    assert average_into_buckets(night, 10, [3000], 5, since=1000) == [0.0]
    # Before the panels were connected there is no solar value at all.
    assert average_into_buckets(points, 10, [900], 60, since=1000) == [None]


def test_series_summary_and_history_gain_solar_and_consumption(manager):
    from datetime import date

    from jouleflow import queries
    from tests.test_storage import local_ts, make_readings

    storage = manager.storage
    day = local_ts(2026, 9, 13)
    noon = day + 12 * 3600
    # The house draws 300 W from the grid while the panels make 1200 W.
    storage.insert_samples(make_readings(noon, 600, import_w=300, counters=(100.0, 50.0)))
    insert(manager, noon, 590, power=1200, total_from=2000.0, total_to=2000.2)
    now = noon + 600
    storage.rollup_all(now)

    series = manager.add_to_series(queries.live_series(storage, "hour", now))
    fields = series["fields"]
    point = series["points"][10]
    assert point[fields.index("solar_avg")] == 1200
    assert point[fields.index("home_avg")] == 1500

    summary = manager.add_to_summary(queries.today_summary(storage, now), now)
    assert summary["today"]["solar"] == pytest.approx(0.2, abs=0.01)
    assert summary["today"]["consumption"] == pytest.approx(
        summary["today"]["import"] + summary["today"]["solar"], abs=1e-3
    )

    history = manager.add_to_history(queries.history(storage, "day", date(2026, 9, 13), now=now))
    assert history["totals"]["solar"] == pytest.approx(0.2, abs=0.01)
    noon_bar = history["bars"][12]
    assert noon_bar[6] == pytest.approx(0.2, abs=0.01)
    assert noon_bar[7] == pytest.approx(noon_bar[1] + noon_bar[6], abs=1e-3)
    assert history["bars"][3][6] is None
