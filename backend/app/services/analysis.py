"""Análise do gasto: por categoria, por lugar e por dia, num período.

Tudo sai de `ledger.spending_rows` (a única definição de consumo); aqui só se agrupa.
"""

from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Date, Subquery, and_, cast, func, select
from sqlalchemy.orm import Session

from app.domain.errors import NotFound
from app.domain.money import quantize
from app.domain.periods import Period, PeriodKind, period_containing
from app.models import Category, Merchant, Transaction, TransactionStatus, TransactionType
from app.repositories import get_owned
from app.services import ledger
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
    # Contas e cartões com gasto no período ("account:<id>", "card:<id>"), sem o filtro de origem:
    # o filtro da tela lista os ativos e só os arquivados que aparecem aqui.
    sources: list[str]


def _by_category(session: Session, rows: Subquery) -> list[CategoryTotal]:
    """Maiores primeiro; da sexta em diante juntas em "Outras" (a soma vem do banco).

    Categorias com saldo negativo (só estorno no período) também entram, por último: assim a
    soma das linhas é sempre o total do período.
    """
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
        .having(amount != 0)
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
    """Lugares do maior para o menor, com número de compras, nome e categoria principal.

    Um lugar só com estorno no período fica negativo, no fim da lista (a soma fecha com o total).
    """
    r = rows.c
    totals = session.execute(
        select(
            r.place_key,
            func.sum(r.amount),
            func.count().filter(r.counts_as_purchase),
        )
        .group_by(r.place_key)
        .having(func.sum(r.amount) != 0)
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
    unfiltered = spending_rows(user_id, period.start, period.end, mode=mode)
    sources = [
        f"account:{account_id}" if account_id else f"card:{card_id}"
        for account_id, card_id in session.execute(
            select(unfiltered.c.account_id, unfiltered.c.card_id).distinct()
        )
    ]
    by_day = _by_day(session, filtered, by_month=period.kind is PeriodKind.YEAR)
    return AnalysisSummary(
        period=period,
        total=quantize(Decimal(total or 0)),
        by_category=_by_category(session, every),
        by_place=_by_place(session, filtered),
        by_day=by_day,
        busiest=max(by_day, key=lambda d: d.amount, default=None),
        sources=sorted(sources),
    )


# --- dia e lugar ------------------------------------------------------------------------------


@dataclass(frozen=True)
class DaySpending:
    transaction: Transaction
    amount: Decimal  # o que conta no dia (a parcela, no modo parcelas)


def day_spending(
    session: Session,
    user_id: UUID,
    day: date,
    *,
    mode: SpendingMode,
    source: Source | None,
    category_id: UUID | None,
) -> list[DaySpending]:
    """O que foi gasto num dia, do maior para o menor."""
    rows = spending_rows(user_id, day, day, mode=mode, source=source, category_id=category_id)
    result = session.execute(
        select(Transaction, rows.c.amount)
        .join(rows, rows.c.transaction_id == Transaction.id)
        .order_by(rows.c.amount.desc(), Transaction.id)
    ).all()
    return [DaySpending(tx, quantize(amount)) for tx, amount in result]


@dataclass(frozen=True)
class PlaceTotals:
    amount: Decimal
    purchases: int


@dataclass(frozen=True)
class PlaceDetail:
    key: str
    name: str
    category_name: str | None
    week: PlaceTotals
    month: PlaceTotals
    year: PlaceTotals
    average: Decimal | None


def _place_filter(session: Session, user_id: UUID, key: str) -> Any:
    """Condição sobre `Transaction` para a chave do lugar; chave inválida ou de outra pessoa
    não existe para quem pergunta."""
    kind, _, value = key.partition(":")
    if kind == "m":
        try:
            merchant_id = UUID(value)
        except ValueError as exc:
            raise NotFound("o lugar") from exc
        get_owned(session, Merchant, merchant_id, user_id, "o lugar")
        return Transaction.merchant_id == merchant_id
    if kind == "d" and value:
        return and_(
            Transaction.merchant_id.is_(None),
            func.lower(func.trim(Transaction.description)) == value,
        )
    raise NotFound("o lugar")


def _place_totals(
    session: Session,
    user_id: UUID,
    key: str,
    period: Period,
    mode: SpendingMode,
    source: Source | None,
) -> PlaceTotals:
    rows = spending_rows(user_id, period.start, period.end, mode=mode, source=source)
    amount, purchases = session.execute(
        select(
            func.coalesce(func.sum(rows.c.amount), 0),
            func.count().filter(rows.c.counts_as_purchase),
        ).where(rows.c.place_key == key)
    ).one()
    return PlaceTotals(quantize(Decimal(amount)), purchases)


def place_detail(
    session: Session,
    user_id: UUID,
    key: str,
    *,
    mode: SpendingMode,
    source: Source | None,
    today: date,
) -> PlaceDetail:
    """Semana, mês e ano atuais de um lugar, e a média por compra (valor registrado, no ano)."""
    condition = _place_filter(session, user_id, key)
    spent = [
        Transaction.user_id == user_id,
        Transaction.status == TransactionStatus.CONFIRMED,
        Transaction.type.in_([TransactionType.EXPENSE, TransactionType.CHARGE]),
        condition,
    ]
    if source is not None:
        # O filtro vale para todos os números da tela, não só para as caixas.
        column = Transaction.account_id if source.kind == "account" else Transaction.card_id
        spent.append(column == source.id)
    latest = session.execute(
        select(Merchant.name, Transaction.description)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
        .where(*spent)
        .order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
        .limit(1)
    ).first()
    if latest is None:
        raise NotFound("o lugar")
    year = period_containing(PeriodKind.YEAR, today, today)
    category = session.scalar(
        select(Category.name)
        .join(Transaction, Transaction.category_id == Category.id)
        .where(*spent, Transaction.occurred_on.between(year.start, year.end))
        .group_by(Category.name)
        .order_by(func.count().desc(), func.sum(Transaction.amount).desc())
        .limit(1)
    )
    average = session.scalar(
        select(func.avg(Transaction.amount)).where(
            *spent, Transaction.occurred_on.between(year.start, year.end)
        )
    )
    periods = {
        kind: period_containing(kind, today, today)
        for kind in (PeriodKind.WEEK, PeriodKind.MONTH, PeriodKind.YEAR)
    }
    return PlaceDetail(
        key=key,
        name=latest[0] or latest[1],
        category_name=category,
        week=_place_totals(session, user_id, key, periods[PeriodKind.WEEK], mode, source),
        month=_place_totals(session, user_id, key, periods[PeriodKind.MONTH], mode, source),
        year=_place_totals(session, user_id, key, periods[PeriodKind.YEAR], mode, source),
        average=None if average is None else quantize(Decimal(average)),
    )


def place_transactions(
    session: Session,
    user_id: UUID,
    key: str,
    *,
    source: Source | None,
    cursor: str | None,
    limit: int = 50,
) -> ledger.Page:
    """Compras, encargos e estornos confirmados do lugar, do mais recente ao mais antigo."""
    kind, _, value = key.partition(":")
    filters = ledger.TransactionFilters(
        types=(TransactionType.EXPENSE, TransactionType.CHARGE, TransactionType.REFUND),
        account_id=source.id if source and source.kind == "account" else None,
        card_id=source.id if source and source.kind == "card" else None,
    )
    if kind == "m":
        _place_filter(session, user_id, key)
        filters = replace(filters, merchant_id=UUID(value))
    elif kind == "d" and value:
        filters = replace(filters, description_key=value)
    else:
        raise NotFound("o lugar")
    return ledger.list_transactions(session, user_id, filters, cursor=cursor, limit=limit)
