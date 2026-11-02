"""Tariff catalog: regulated flat tariff, Taoz time-of-use, supplier plans.

All numbers come from data/tariffs.json, which records source URLs and
verification dates so a tariff update is a one-file data edit.

Israeli conventions: workdays are Sunday-Thursday; Friday and Saturday are
the weekend. Taoz day types follow the Electricity Authority schedule:
weekdays, Friday/holiday-eve, Saturday/holiday.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

log = logging.getLogger(__name__)

DATA_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "tariffs.json"

SUN_THU = (6, 0, 1, 2, 3)  # datetime.weekday(): Sun=6, Mon=0 .. Thu=3
FRI_SAT = (4, 5)


def _hhmm(value: str) -> int:
    h, m = (int(x) for x in value.split(":"))
    return h * 60 + m


def is_workday(d: date, holidays: frozenset[date] = frozenset()) -> bool:
    """Sunday-Thursday that is not a holiday or holiday eve (both count as weekend)."""
    return d.weekday() in SUN_THU and d not in holidays


@dataclass(frozen=True)
class Window:
    """A discount/peak window: day rule plus [start, end) minutes, possibly wrapping midnight."""

    days: str  # "all" or "sun-thu"
    start: int  # minutes from midnight
    end: int

    @classmethod
    def from_dict(cls, d: dict) -> Window:
        return cls(days=d["days"], start=_hhmm(d["start"]), end=_hhmm(d["end"]))

    def contains(self, when: datetime) -> bool:
        minutes = when.hour * 60 + when.minute
        duration = (self.end - self.start) % 1440 or 1440
        if minutes >= self.start:
            anchor, offset = when.date(), minutes - self.start
        else:
            anchor = when.date() - timedelta(days=1)
            offset = minutes + 1440 - self.start
        if offset >= duration:
            return False
        if self.days == "all":
            return True
        return anchor.weekday() in SUN_THU


@dataclass(frozen=True)
class SupplierPlan:
    supplier: str
    plan: str
    discount: float  # fraction off the regulated flat rate, e.g. 0.065
    window: Window | None  # None = all hours
    meter: str  # "any" or "smart"
    eligibility: str
    source: str
    verified: str

    def applies(self, when: datetime) -> bool:
        return self.window is None or self.window.contains(when)

    @property
    def label(self) -> str:
        return f"{self.supplier} - {self.plan}"


@dataclass(frozen=True)
class TaozSeason:
    name: str
    months: frozenset[int]
    peak_window: Window
    peak_rate: float
    off_peak_rate: float


@dataclass(frozen=True)
class Taoz:
    seasons: tuple[TaozSeason, ...]
    holidays: frozenset[date] = field(default=frozenset)
    requires_smart_meter: bool = True
    voluntary_below_annual_kwh: int = 40000

    def rate(self, when: datetime) -> float:
        season = next(s for s in self.seasons if when.month in s.months)
        # Peak windows (17:00-22:00/23:00) never wrap midnight, and each
        # season's window already encodes its day rule ("all" in winter,
        # "sun-thu" in summer/transition). Holidays are off-peak all day.
        peak = season.peak_window.contains(when) and when.date() not in self.holidays
        return season.peak_rate if peak else season.off_peak_rate


@dataclass(frozen=True)
class Catalog:
    flat_rate: float
    fixed_fees_bimonthly: dict
    taoz: Taoz
    plans: tuple[SupplierPlan, ...]
    sources: tuple[dict, ...]
    retrieved: str


def load_catalog(path: str | Path | None = None) -> Catalog:
    p = Path(path) if path else DATA_FILE
    raw = json.loads(p.read_text(encoding="utf-8"))
    reg = raw["regulated"]
    holidays = frozenset(date.fromisoformat(d) for d in raw["taoz"].get("holidays", []))
    seasons = tuple(
        TaozSeason(
            name=name,
            months=frozenset(s["months"]),
            peak_window=Window.from_dict(s["peak"]),
            peak_rate=s["rates"]["peak"],
            off_peak_rate=s["rates"]["off_peak"],
        )
        for name, s in raw["taoz"]["seasons"].items()
    )
    plans = tuple(
        SupplierPlan(
            supplier=sp["supplier"],
            plan=sp["plan"],
            discount=sp["discount"],
            window=Window.from_dict(sp["window"]) if sp.get("window") else None,
            meter=sp.get("meter", "any"),
            eligibility=sp.get("eligibility", ""),
            source=sp["source"],
            verified=sp["verified"],
        )
        for sp in raw["supplier_plans"]
    )
    log.debug("catalog %s: %d supplier plans, flat rate %.4f", p.name, len(plans), reg["flat_rate_per_kwh"])
    return Catalog(
        flat_rate=reg["flat_rate_per_kwh"],
        fixed_fees_bimonthly=reg.get("fixed_fees_bimonthly", {}),
        taoz=Taoz(seasons=seasons, holidays=holidays),
        plans=plans,
        sources=tuple(raw.get("sources", [])),
        retrieved=raw.get("retrieved", ""),
    )
