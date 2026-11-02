"""Interval-exact plan cost computation and ranking."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .parser import Interval
from .tariffs import Catalog, SupplierPlan

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PlanCost:
    label: str
    kind: str  # "flat" | "taoz" | "supplier"
    period_cost: float
    annual_cost: float
    savings_vs_flat_annual: float
    detail: str = ""


def _annualize(period_cost: float, days: int) -> float:
    return period_cost / days * 365


def flat_cost(intervals: list[Interval], rate: float) -> float:
    return sum(i.kwh for i in intervals) * rate


def supplier_cost(intervals: list[Interval], plan: SupplierPlan, flat_rate: float) -> float:
    return sum(
        i.kwh * flat_rate * (1 - plan.discount if plan.applies(i.start) else 1)
        for i in intervals
    )


def taoz_cost(intervals: list[Interval], catalog: Catalog) -> float:
    return sum(i.kwh * catalog.taoz.rate(i.start) for i in intervals)


def rank_plans(intervals: list[Interval], catalog: Catalog, days: int) -> list[PlanCost]:
    """Annual cost for every plan, cheapest first. Flat regulated tariff included."""
    base = flat_cost(intervals, catalog.flat_rate)
    out = [
        PlanCost(
            label='חברת החשמל - תעריף אחיד מפוקח',
            kind="flat",
            period_cost=base,
            annual_cost=_annualize(base, days),
            savings_vs_flat_annual=0.0,
            detail=f"{catalog.flat_rate:.4f} NIS/kWh, all hours",
        ),
        PlanCost(
            label='תעו"ז מפוקח (מונה חכם)',
            kind="taoz",
            period_cost=(tc := taoz_cost(intervals, catalog)),
            annual_cost=_annualize(tc, days),
            savings_vs_flat_annual=_annualize(base - tc, days),
            detail="season x peak/off-peak, measured period only",
        ),
    ]
    for plan in catalog.plans:
        c = supplier_cost(intervals, plan, catalog.flat_rate)
        out.append(
            PlanCost(
                label=plan.label,
                kind="supplier",
                period_cost=c,
                annual_cost=_annualize(c, days),
                savings_vs_flat_annual=_annualize(base - c, days),
                detail=f"{plan.discount:.1%} off, {plan.meter} meter, verified {plan.verified}",
            )
        )
    out.sort(key=lambda pc: pc.annual_cost)
    for pc in out:
        log.debug("plan %-45s annual %.0f NIS", pc.label, pc.annual_cost)
    return out
