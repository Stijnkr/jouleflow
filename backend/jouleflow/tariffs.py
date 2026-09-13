"""Energy contracts and cost calculation.

All prices include VAT. The P1 meter keeps separate counters for the low (tariff 1)
and normal (tariff 2) rate, so historical costs use those counters directly; the
normal-rate hours are only needed to show the price that applies right now.

Net metering ("salderen") settles yearly: exported kWh are offset against imported
kWh at the full variable price. Per day or month Jouleflow approximates this by
valuing exported kWh at the import price of the same rate. Without net metering,
exported kWh earn the feed-in compensation. Feed-in costs apply to all exported kWh.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, model_validator


class FeedInPeriod(BaseModel):
    start: date
    compensation: float = Field(0.0, description="€/kWh paid for exported energy (no netting)")
    cost: float = Field(0.0, description="€/kWh charged for exported energy")


class Contract(BaseModel):
    name: str = ""
    start: date
    end: date | None = None

    meter: Literal["single", "dual"] = "dual"
    # Variable supply price per kWh, excluding energy tax.
    supply_single: float = 0.0
    supply_normal: float = 0.0
    supply_low: float = 0.0
    energy_tax: float = 0.0
    surcharge: float = 0.0

    # Hours during which the normal rate applies on weekdays; low rate otherwise.
    normal_start_hour: int = Field(7, ge=0, le=23)
    normal_end_hour: int = Field(23, ge=1, le=24)

    netting_until: date | None = None
    feed_in: list[FeedInPeriod] = Field(default_factory=list)

    fixed_supply_month: float = 0.0
    grid_day: float = 0.0
    tax_reduction_day: float = 0.0

    gas_enabled: bool = False
    gas_price: float = 0.0
    gas_fixed_month: float = 0.0
    gas_grid_day: float = 0.0

    @model_validator(mode="after")
    def _check(self) -> Contract:
        if self.end and self.end < self.start:
            raise ValueError("The end date must be after the start date")
        self.feed_in.sort(key=lambda p: p.start)
        return self

    # ------------------------------------------------------------------ prices

    def price_normal(self) -> float:
        base = self.supply_single if self.meter == "single" else self.supply_normal
        return base + self.energy_tax + self.surcharge

    def price_low(self) -> float:
        base = self.supply_single if self.meter == "single" else self.supply_low
        return base + self.energy_tax + self.surcharge

    def feed_in_on(self, day: date) -> FeedInPeriod:
        current = FeedInPeriod(start=self.start)
        for period in self.feed_in:
            if period.start <= day:
                current = period
        return current

    def netting_on(self, day: date) -> bool:
        return self.netting_until is None or day < self.netting_until

    def fixed_per_day(self) -> float:
        electricity = self.fixed_supply_month * 12 / 365 + self.grid_day + self.tax_reduction_day
        gas = (self.gas_fixed_month * 12 / 365 + self.gas_grid_day) if self.gas_enabled else 0.0
        return electricity + gas

    def is_normal_rate(self, moment: datetime) -> bool:
        if self.meter == "single" or moment.weekday() >= 5:
            return False
        return self.normal_start_hour <= moment.hour < self.normal_end_hour


class TariffSettings(BaseModel):
    contracts: list[Contract] = Field(default_factory=list)

    @model_validator(mode="after")
    def _sort(self) -> TariffSettings:
        self.contracts.sort(key=lambda c: c.start)
        return self

    def contract_on(self, day: date) -> Contract | None:
        """The contract that applies on `day`: the latest one that has started.

        After a fixed-price contract ends, its prices keep being used until a new
        contract is added, since suppliers usually continue at similar variable rates.
        """
        current = None
        for contract in self.contracts:
            if contract.start <= day:
                current = contract
        return current


def _v(value: float | None) -> float:
    return value or 0.0


def bucket_cost(
    contract: Contract,
    day: date,
    *,
    imp_low: float | None,
    imp_normal: float | None,
    exp_low: float | None,
    exp_normal: float | None,
    gas: float | None,
    fixed_days: float,
) -> dict:
    """Cost for one bucket of meter deltas. `fixed_days` is the bucket length in days."""
    import_cost = _v(imp_low) * contract.price_low() + _v(imp_normal) * contract.price_normal()

    exported = _v(exp_low) + _v(exp_normal)
    feed_in = contract.feed_in_on(day)
    if contract.netting_on(day):
        export_credit = (
            _v(exp_low) * contract.price_low() + _v(exp_normal) * contract.price_normal()
        )
    else:
        export_credit = exported * feed_in.compensation
    export_cost = exported * feed_in.cost

    gas_cost = _v(gas) * contract.gas_price if contract.gas_enabled else 0.0
    fixed = contract.fixed_per_day() * fixed_days
    energy = import_cost - export_credit + export_cost
    return {
        "import": round(import_cost, 4),
        "export_credit": round(export_credit, 4),
        "export_cost": round(export_cost, 4),
        "gas": round(gas_cost, 4),
        "fixed": round(fixed, 4),
        "total": round(energy + gas_cost + fixed, 4),
    }


def sum_costs(costs: list[dict]) -> dict | None:
    if not costs:
        return None
    keys = ("import", "export_credit", "export_cost", "gas", "fixed", "total")
    return {k: round(sum(c[k] for c in costs), 2) for k in keys}


def current_rate(settings: TariffSettings, now: float, tz: ZoneInfo) -> dict | None:
    moment = datetime.fromtimestamp(now, tz)
    contract = settings.contract_on(moment.date())
    if contract is None:
        return None
    normal = contract.is_normal_rate(moment)
    price = contract.price_normal() if normal else contract.price_low()
    feed_in = contract.feed_in_on(moment.date())
    netting = contract.netting_on(moment.date())
    return {
        "rate": "single" if contract.meter == "single" else ("normal" if normal else "low"),
        "import_price": round(price, 6),
        "export_value": round((price if netting else feed_in.compensation) - feed_in.cost, 6),
        "netting": netting,
        "contract": contract.name,
        "contract_end": contract.end.isoformat() if contract.end else None,
    }


def day_of(ts: int, tz: ZoneInfo) -> date:
    return datetime.fromtimestamp(ts, tz).date()
