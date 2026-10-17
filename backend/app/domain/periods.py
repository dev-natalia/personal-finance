"""Períodos da análise: mês, semana (segunda a domingo) e ano.

Mês e semana vão do primeiro ao último dia, mesmo no período atual: mostram tudo o que já está
registrado para eles. O ano atual vai só até o fim do mês atual (parcelas de meses seguintes
ainda não pesaram).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum

from app.domain.cards import add_months
from app.domain.dates import month_range


class PeriodKind(StrEnum):
    MONTH = "month"
    WEEK = "week"
    YEAR = "year"


@dataclass(frozen=True)
class Period:
    kind: PeriodKind
    start: date  # inclusivo
    end: date  # inclusivo


def period_containing(kind: PeriodKind, day: date, today: date) -> Period:
    """O período do tipo pedido que contém `day`."""
    match kind:
        case PeriodKind.MONTH:
            start, end = month_range(day.year, day.month)
        case PeriodKind.WEEK:
            start = day - timedelta(days=day.weekday())
            end = start + timedelta(days=6)
        case PeriodKind.YEAR:
            start, end = date(day.year, 1, 1), date(day.year, 12, 31)
            if day.year == today.year:
                end = month_range(today.year, today.month)[1]
    return Period(kind, start, end)


def shift_period(period: Period, steps: int, today: date) -> Period:
    """O período `steps` antes (negativo) ou depois (positivo) deste."""
    match period.kind:
        case PeriodKind.MONTH:
            anchor = add_months(period.start, steps)
        case PeriodKind.WEEK:
            anchor = period.start + timedelta(weeks=steps)
        case PeriodKind.YEAR:
            anchor = date(period.start.year + steps, 1, 1)
    return period_containing(period.kind, anchor, today)


def has_next(period: Period, today: date) -> bool:
    """Há período seguinte a mostrar: só enquanto o período não contém hoje."""
    return period.end < today
