"""Consultas financeiras. Única fonte das definições de saldo, consumo e receita.

Nenhuma outra parte do código soma lançamentos por conta própria.
"""

import base64
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.domain.dates import month_range
from app.domain.errors import RuleViolation
from app.domain.merchants import normalize
from app.domain.money import quantize
from app.models import (
    Account,
    Category,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.repositories import owned_select

ZERO = Decimal("0.00")
DUPLICATE_WINDOW = timedelta(days=2)
PAYMENT_HISTORY = timedelta(days=90)
_CONFIRMED = Transaction.status == TransactionStatus.CONFIRMED


def account_balances(
    session: Session, user_id: UUID, as_of: date, account_ids: Sequence[UUID] | None = None
) -> dict[UUID, Decimal]:
    """Saldo de cada conta ao fim do dia `as_of`.

    saldo = abertura + receitas + estornos + transferências recebidas
            - despesas - transferências enviadas      (só lançamentos confirmados)

    O saldo de abertura vale para o início de `opening_date`; antes dessa data o saldo é zero.
    """
    accounts_stmt = owned_select(Account, user_id)
    if account_ids is not None:
        accounts_stmt = accounts_stmt.where(Account.id.in_(account_ids))
    accounts = session.scalars(accounts_stmt).all()

    signed = case(
        (
            Transaction.type.in_([TransactionType.INCOME, TransactionType.REFUND]),
            Transaction.amount,
        ),
        else_=-Transaction.amount,
    )
    base = (Transaction.user_id == user_id, _CONFIRMED, Transaction.occurred_on <= as_of)
    movements: defaultdict[UUID, Decimal] = defaultdict(lambda: ZERO)
    outgoing = (
        select(Transaction.account_id, func.sum(signed))
        .where(*base)
        .group_by(Transaction.account_id)
    )
    for account_id, total in session.execute(outgoing):
        movements[account_id] += total
    incoming = (
        select(Transaction.destination_account_id, func.sum(Transaction.amount))
        .where(*base, Transaction.type == TransactionType.TRANSFER)
        .group_by(Transaction.destination_account_id)
    )
    for account_id, total in session.execute(incoming):
        if account_id is not None:  # sempre preenchido em transferências
            movements[account_id] += total

    return {
        a.id: ZERO if a.opening_date > as_of else quantize(a.opening_balance + movements[a.id])
        for a in accounts
    }


def total_balance(session: Session, user_id: UUID, as_of: date) -> Decimal:
    return quantize(sum(account_balances(session, user_id, as_of).values(), ZERO))


@dataclass(frozen=True)
class CategoryAmount:
    category_id: UUID
    name: str
    amount: Decimal


@dataclass(frozen=True)
class MonthSummary:
    year: int
    month: int
    income: Decimal
    consumption_total: Decimal
    by_category: list[CategoryAmount]


def month_summary(session: Session, user_id: UUID, year: int, month: int) -> MonthSummary:
    """Receitas e consumo do mês. Consumo = despesas - estornos (pela data de cada lançamento).

    Transferências nunca entram em receitas nem em consumo.
    """
    start, end = month_range(year, month)
    in_month = (
        Transaction.user_id == user_id,
        _CONFIRMED,
        Transaction.occurred_on.between(start, end),
    )
    signed = case(
        (Transaction.type == TransactionType.EXPENSE, Transaction.amount),
        else_=-Transaction.amount,
    )
    total = func.sum(signed)
    rows = session.execute(
        select(Category.id, Category.name, total)
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(*in_month, Transaction.type.in_([TransactionType.EXPENSE, TransactionType.REFUND]))
        .group_by(Category.id, Category.name)
        .order_by(total.desc(), Category.name)
    ).all()
    by_category = [CategoryAmount(cid, name, quantize(amount)) for cid, name, amount in rows]
    income = session.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            *in_month, Transaction.type == TransactionType.INCOME
        )
    )
    return MonthSummary(
        year=year,
        month=month,
        income=quantize(Decimal(income or 0)),
        consumption_total=quantize(sum((c.amount for c in by_category), ZERO)),
        by_category=by_category,
    )


@dataclass(frozen=True)
class TransactionFilters:
    date_from: date | None = None
    date_to: date | None = None
    account_id: UUID | None = None
    category_id: UUID | None = None
    merchant_id: UUID | None = None
    payment_method: PaymentMethod | None = None
    type: TransactionType | None = None
    status: TransactionStatus | None = TransactionStatus.CONFIRMED  # None = todos


@dataclass(frozen=True)
class Page:
    items: list[Transaction]
    next_cursor: str | None


def encode_cursor(tx: Transaction) -> str:
    raw = f"{tx.occurred_on.isoformat()}|{tx.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[date, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        day, _, tx_id = raw.partition("|")
        return date.fromisoformat(day), UUID(tx_id)
    except ValueError as exc:
        raise RuleViolation("invalid_cursor", "Cursor de paginação inválido.") from exc


def list_transactions(
    session: Session,
    user_id: UUID,
    filters: TransactionFilters,
    *,
    cursor: str | None = None,
    limit: int = 50,
) -> Page:
    """Lista em ordem (data desc, id desc). O cursor é estável com lançamentos retroativos."""
    stmt = owned_select(Transaction, user_id)
    if filters.date_from is not None:
        stmt = stmt.where(Transaction.occurred_on >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(Transaction.occurred_on <= filters.date_to)
    if filters.account_id is not None:
        stmt = stmt.where(
            or_(
                Transaction.account_id == filters.account_id,
                Transaction.destination_account_id == filters.account_id,
            )
        )
    if filters.category_id is not None:
        stmt = stmt.where(Transaction.category_id == filters.category_id)
    if filters.merchant_id is not None:
        stmt = stmt.where(Transaction.merchant_id == filters.merchant_id)
    if filters.payment_method is not None:
        stmt = stmt.where(Transaction.payment_method == filters.payment_method)
    if filters.type is not None:
        stmt = stmt.where(Transaction.type == filters.type)
    if filters.status is not None:
        stmt = stmt.where(Transaction.status == filters.status)
    if cursor is not None:
        day, last_id = decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Transaction.occurred_on < day,
                and_(Transaction.occurred_on == day, Transaction.id < last_id),
            )
        )
    stmt = stmt.order_by(Transaction.occurred_on.desc(), Transaction.id.desc()).limit(limit + 1)
    rows = list(session.scalars(stmt))
    next_cursor = encode_cursor(rows[limit - 1]) if len(rows) > limit else None
    return Page(items=rows[:limit], next_cursor=next_cursor)


def possible_duplicates(
    session: Session, user_id: UUID, *, amount: Decimal, merchant: str | None, occurred_on: date
) -> list[Transaction]:
    """Despesas confirmadas com mesmo valor e mesmo estabelecimento em ±2 dias."""
    normalized = normalize(merchant) if merchant else ""
    if not normalized:
        return []
    stmt = (
        select(Transaction)
        .join(Merchant, Merchant.id == Transaction.merchant_id)
        .where(
            Transaction.user_id == user_id,
            _CONFIRMED,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.amount == quantize(amount),
            Merchant.normalized_name == normalized,
            Transaction.occurred_on.between(
                occurred_on - DUPLICATE_WINDOW, occurred_on + DUPLICATE_WINDOW
            ),
        )
        .order_by(Transaction.occurred_on.desc())
    )
    return list(session.scalars(stmt))


@dataclass(frozen=True)
class PaymentOption:
    account_id: UUID
    account_name: str
    payment_method: PaymentMethod


def top_payment_options(
    session: Session, user_id: UUID, today: date, limit: int = 3
) -> list[PaymentOption]:
    """Combinações conta + meio mais usadas em despesas dos últimos 90 dias."""
    uses = func.count(Transaction.id)
    rows = session.execute(
        select(Account.id, Account.name, Transaction.payment_method, uses)
        .select_from(Transaction)
        .join(Account, Account.id == Transaction.account_id)
        .where(
            Transaction.user_id == user_id,
            _CONFIRMED,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.occurred_on >= today - PAYMENT_HISTORY,
            Account.archived_at.is_(None),
        )
        .group_by(Account.id, Account.name, Transaction.payment_method)
        .order_by(uses.desc(), Account.name, Transaction.payment_method)
        .limit(limit)
    ).all()
    return [
        PaymentOption(account_id, name, method)
        for account_id, name, method, _ in rows
        if method is not None  # despesas sempre têm meio de pagamento
    ]
