from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from jouleflow.tariffs import Contract, FeedInPeriod, TariffSettings, bucket_cost, current_rate

TZ = ZoneInfo("Europe/Amsterdam")


def contract(**overrides) -> Contract:
    base = dict(
        start=date(2026, 5, 10),
        end=date(2027, 5, 9),
        meter="dual",
        supply_normal=0.132132,
        supply_low=0.116523,
        supply_single=0.124751,
        energy_tax=0.110848,
        normal_start_hour=7,
        normal_end_hour=21,
        netting_until=date(2027, 1, 1),
        feed_in=[
            FeedInPeriod(start=date(2026, 5, 10), compensation=0.12, cost=0.11495),
            FeedInPeriod(start=date(2027, 1, 1), compensation=0.07, cost=0.064977),
        ],
        fixed_supply_month=9.489909,
        grid_day=1.303654,
        tax_reduction_day=-1.723173,
    )
    return Contract(**(base | overrides))


def test_prices_include_energy_tax():
    c = contract()
    assert c.price_normal() == pytest.approx(0.24298)
    assert c.price_low() == pytest.approx(0.227371)
    assert contract(meter="single").price_normal() == pytest.approx(0.235599)


def test_cost_with_netting_values_export_at_import_price():
    c = contract()
    cost = bucket_cost(
        c, date(2026, 9, 13), imp_low=2, imp_normal=3, exp_low=0, exp_normal=4, gas=None,
        fixed_days=1,
    )  # fmt: skip
    assert cost["import"] == pytest.approx(2 * 0.227371 + 3 * 0.24298, abs=1e-4)
    assert cost["export_credit"] == pytest.approx(4 * 0.24298, abs=1e-4)
    assert cost["export_cost"] == pytest.approx(4 * 0.11495, abs=1e-4)
    fixed = 9.489909 * 12 / 365 + 1.303654 - 1.723173
    assert cost["fixed"] == pytest.approx(fixed, abs=1e-4)


def test_cost_after_netting_uses_feed_in_compensation():
    c = contract()
    cost = bucket_cost(
        c, date(2027, 2, 1), imp_low=0, imp_normal=0, exp_low=1, exp_normal=1, gas=None,
        fixed_days=0,
    )  # fmt: skip
    assert cost["export_credit"] == pytest.approx(2 * 0.07)
    assert cost["export_cost"] == pytest.approx(2 * 0.064977, abs=1e-4)


def test_current_rate_follows_normal_hours_and_weekends():
    settings = TariffSettings(contracts=[contract()])
    weekday_day = datetime(2026, 9, 14, 12, tzinfo=TZ).timestamp()  # Monday
    weekday_evening = datetime(2026, 9, 14, 22, tzinfo=TZ).timestamp()
    weekend = datetime(2026, 9, 13, 12, tzinfo=TZ).timestamp()  # Sunday
    assert current_rate(settings, weekday_day, TZ)["rate"] == "normal"
    assert current_rate(settings, weekday_evening, TZ)["rate"] == "low"
    assert current_rate(settings, weekend, TZ)["rate"] == "low"


def test_contract_selection_by_date():
    older = contract(start=date(2025, 5, 10), end=date(2026, 5, 9), supply_normal=0.2)
    settings = TariffSettings(contracts=[contract(), older])
    assert settings.contract_on(date(2025, 12, 1)).supply_normal == 0.2
    assert settings.contract_on(date(2026, 9, 1)).supply_normal == 0.132132
    assert settings.contract_on(date(2024, 1, 1)) is None


def test_end_before_start_is_rejected():
    with pytest.raises(ValueError):
        contract(end=date(2026, 1, 1))
