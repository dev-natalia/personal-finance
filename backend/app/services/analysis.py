"""Análise do gasto: por categoria, por lugar e por dia, num período.

Tudo sai de `ledger.spending_rows` (a única definição de consumo); aqui só se agrupa.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, Subquery, cast, func, select
from sqlalchemy.orm import Session

from app.domain.money import quantize
from app.domain.periods import Period, PeriodKind
from app.models import Category
from app.services.ledger import Source, SpendingMode, spending_rows

ZERO = Decimal("0.00")
TOP_CATEGORIES = 5
OTHERS = "Outras"


@dataclass(frozen=True)
class CategoryTotal:
    category_id: UUID | None  # nulo só em "Outras"
    name: str
    amount: Decimal


@dataclass(frozen=True)
class PlaceTotal:
    key: str  # "m:<estabelecimento>" ou "d:<descrição em minúsculas>"
    name: str
    amount: Decimal
    purchases: int
    category_name: str | None


@dataclass(frozen=True)
class DayTotal:
    day: date  # no ano, o dia 1 de cada mês
    amount: Decimal


@dataclass(frozen=True)
class AnalysisSummary:
    period: Period
    total: Decimal
    by_category: list[CategoryTotal]
    by_place: list[PlaceTotal]
    by_day: list[DayTotal]
    busiest: DayTotal | None


def _by_category(session: Session, rows: Subquery) -> list[CategoryTotal]:
    """Maiores primeiro; da sexta em diante juntas em "Outras" (a soma vem do banco)."""
    amount = func.sum(rows.c.amount)
    ranked = (
        select(
            Category.id,
            Category.name,
            amount.label("amount"),
            func.row_number().over(order_by=(amount.desc(), Category.name)).label("rank"),
        )
        .join(rows, rows.c.category_id == Category.id)
        .group_by(Category.id, Category.name)
        .having(amount > 0)
        .subquery()
    )
    top = session.execute(
        select(ranked.c.id, ranked.c.name, ranked.c.amount)
        .where(ranked.c.rank <= TOP_CATEGORIES)
        .order_by(ranked.c.rank)
    ).all()
    others = session.scalar(select(func.sum(ranked.c.amount)).where(ranked.c.rank > TOP_CATEGORIES))
    result = [CategoryTotal(cid, name, quantize(value)) for cid, name, value in top]
    if others:
        result.append(CategoryTotal(None, OTHERS, quantize(others)))
    return result


def _by_place(session: Session, rows: Subquery) -> list[PlaceTotal]:
    """Lugares do maior para o menor, com número de compras, nome e categoria principal."""
    r = rows.c
    totals = session.execute(
        select(
            r.place_key,
            func.sum(r.amount),
            func.count().filter(r.counts_as_purchase),
        )
        .group_by(r.place_key)
        .having(func.sum(r.amount) > 0)
        .order_by(func.sum(r.amount).desc(), r.place_key)
    ).all()
    # Nome mais recente (a descrição pode variar) e categoria mais frequente (empate: maior valor).
    names: dict[str, str] = {}
    for key, name in session.execute(
        select(r.place_key, r.place_name).order_by(r.place_key, r.day.desc())
    ):
        names.setdefault(key, name)
    categories: dict[str, str] = {}
    for key, name in session.execute(
        select(r.place_key, Category.name)
        .join(Category, Category.id == r.category_id)
        .group_by(r.place_key, Category.name)
        .order_by(r.place_key, func.count().desc(), func.sum(r.amount).desc())
    ):
        categories.setdefault(key, name)
    return [
        PlaceTotal(key, names[key], quantize(amount), purchases, categories.get(key))
        for key, amount, purchases in totals
    ]


def _by_day(session: Session, rows: Subquery, by_month: bool) -> list[DayTotal]:
    r = rows.c
    bucket = cast(func.date_trunc("month", r.day), Date) if by_month else r.day
    result = session.execute(
        select(bucket, func.sum(r.amount))
        .group_by(bucket)
        .having(func.sum(r.amount) != 0)
        .order_by(bucket)
    ).all()
    return [DayTotal(day, quantize(amount)) for day, amount in result]


def summary(
    session: Session,
    user_id: UUID,
    period: Period,
    *,
    mode: SpendingMode,
    source: Source | None,
    category_id: UUID | None,
) -> AnalysisSummary:
    """Resumo do período. Total e categorias ignoram o filtro de categoria (a rosca continua
    inteira); lugares e dias o respeitam."""
    every = spending_rows(user_id, period.start, period.end, mode=mode, source=source)
    filtered = (
        every
        if category_id is None
        else spending_rows(
            user_id, period.start, period.end, mode=mode, source=source, category_id=category_id
        )
    )
    total = session.scalar(select(func.coalesce(func.sum(every.c.amount), 0)))
    by_day = _by_day(session, filtered, by_month=period.kind is PeriodKind.YEAR)
    return AnalysisSummary(
        period=period,
        total=quantize(Decimal(total or 0)),
        by_category=_by_category(session, every),
        by_place=_by_place(session, filtered),
        by_day=by_day,
        busiest=max(by_day, key=lambda d: d.amount, default=None),
    )
