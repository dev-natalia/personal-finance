"""Casos de uso de escrita de lançamentos."""

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal
from typing import assert_never
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.categorization import resolve_category
from app.domain.errors import Conflict, Notice, RuleViolation
from app.domain.money import format_brl, quantize
from app.models import (
    Account,
    AuditAction,
    Category,
    CategoryKind,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionSource,
    TransactionType,
)
from app.services import ledger
from app.services.accounts import get_active_account
from app.services.audit import jsonable, record
from app.services.categories import get_active_category, get_unclassified
from app.services.context import RequestContext
from app.services.merchants import resolve_merchant


@dataclass(frozen=True)
class NewIncome:
    amount: Decimal
    occurred_on: date
    description: str
    account_id: UUID
    category_id: UUID | None = None
    merchant: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class NewExpense:
    amount: Decimal
    occurred_on: date
    description: str
    account_id: UUID
    payment_method: PaymentMethod
    category_id: UUID | None = None
    merchant: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class NewTransfer:
    amount: Decimal
    occurred_on: date
    description: str
    account_id: UUID
    destination_account_id: UUID
    notes: str | None = None


type NewTransaction = NewIncome | NewExpense | NewTransfer


@dataclass(frozen=True)
class WriteResult:
    transaction: Transaction
    replayed: bool = False
    notices: list[Notice] = field(default_factory=list)


# --- idempotência ----------------------------------------------------------------------------


def payload_hash(kind: str, fields: dict[str, object]) -> bytes:
    body = {"kind": kind, **{key: jsonable(value) for key, value in fields.items()}}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).digest()


def _find_by_key(session: Session, user_id: UUID, key: str) -> Transaction | None:
    return session.scalar(
        select(Transaction).where(
            Transaction.user_id == user_id, Transaction.idempotency_key == key
        )
    )


def _replay(existing: Transaction, digest: bytes) -> WriteResult:
    if existing.idempotency_payload_hash != digest:
        raise Conflict(
            "idempotency_key_reused", "Esta chave de idempotência já foi usada com outro conteúdo."
        )
    return WriteResult(existing, replayed=True)


def _insert(
    session: Session,
    ctx: RequestContext,
    tx: Transaction,
    key: str | None,
    digest: bytes | None,
) -> WriteResult | None:
    """Insere e audita. Se outra requisição com a mesma chave venceu a corrida, devolve a dela."""
    tx.idempotency_key = key
    tx.idempotency_payload_hash = digest
    try:
        with session.begin_nested():
            session.add(tx)
            session.flush()
    except IntegrityError:
        if key is None or digest is None:
            raise
        existing = _find_by_key(session, ctx.user_id, key)
        if existing is None:
            raise
        return _replay(existing, digest)
    record(session, ctx, tx, AuditAction.CREATE, before=None)
    return None


# --- regras compartilhadas ------------------------------------------------------------------


def _require_positive(amount: Decimal) -> None:
    if amount <= 0:
        raise RuleViolation("amount_not_positive", "O valor deve ser maior que zero.")


def _check_opening(account: Account, occurred_on: date) -> None:
    if occurred_on < account.opening_date:
        raise RuleViolation(
            "date_before_account_opening",
            f"A data é anterior à abertura da conta {account.name} "
            f"({account.opening_date:%d/%m/%Y}).",
        )


def _learn(merchant: Merchant | None, category: Category) -> None:
    """Memoriza a categoria escolhida explicitamente (categorias de sistema não contam)."""
    if merchant is not None and not category.is_system:
        merchant.default_category_id = category.id


def _usable_default(session: Session, merchant: Merchant | None, kind: CategoryKind) -> UUID | None:
    if merchant is None or merchant.default_category_id is None:
        return None
    default = session.get(Category, merchant.default_category_id)
    if default is None or default.kind is not kind or default.archived_at is not None:
        return None
    return default.id


def _resolve_category(
    session: Session,
    ctx: RequestContext,
    explicit_id: UUID | None,
    merchant: Merchant | None,
    kind: CategoryKind,
) -> Category:
    if explicit_id is not None:
        return get_active_category(session, ctx, explicit_id, kind)
    unclassified = get_unclassified(session, ctx.user_id, kind)
    chosen = resolve_category(None, _usable_default(session, merchant, kind), unclassified.id)
    return unclassified if chosen == unclassified.id else session.get_one(Category, chosen)


def _negative_balance_notices(
    session: Session, ctx: RequestContext, account_ids: list[UUID], as_of: date
) -> list[Notice]:
    if not account_ids:
        return []
    balances = ledger.account_balances(session, ctx.user_id, as_of, account_ids)
    notices = []
    for account_id, balance in balances.items():
        if balance < 0:
            name = session.get_one(Account, account_id).name
            notices.append(
                Notice(
                    "negative_balance",
                    f"A conta {name} ficou com saldo negativo ({format_brl(balance)}).",
                )
            )
    return notices


# --- criação --------------------------------------------------------------------------------


def _build_categorized(
    session: Session,
    ctx: RequestContext,
    data: NewIncome | NewExpense,
    tx_type: TransactionType,
    payment_method: PaymentMethod | None,
) -> Transaction:
    kind = CategoryKind.EXPENSE if tx_type is TransactionType.EXPENSE else CategoryKind.INCOME
    account = get_active_account(session, ctx, data.account_id)
    _check_opening(account, data.occurred_on)
    merchant = resolve_merchant(session, ctx.user_id, data.merchant or data.description)
    category = _resolve_category(session, ctx, data.category_id, merchant, kind)
    if data.category_id is not None:
        _learn(merchant, category)
    return Transaction(
        user_id=ctx.user_id,
        type=tx_type,
        amount=quantize(data.amount),
        occurred_on=data.occurred_on,
        description=data.description,
        notes=data.notes,
        merchant_id=merchant.id if merchant else None,
        category_id=category.id,
        account_id=account.id,
        payment_method=payment_method,
    )


def _build_transfer(session: Session, ctx: RequestContext, data: NewTransfer) -> Transaction:
    if data.account_id == data.destination_account_id:
        raise RuleViolation(
            "transfer_same_account",
            "Origem e destino da transferência devem ser contas diferentes.",
        )
    source = get_active_account(session, ctx, data.account_id)
    destination = get_active_account(session, ctx, data.destination_account_id)
    for account in (source, destination):
        _check_opening(account, data.occurred_on)
    return Transaction(
        user_id=ctx.user_id,
        type=TransactionType.TRANSFER,
        amount=quantize(data.amount),
        occurred_on=data.occurred_on,
        description=data.description,
        notes=data.notes,
        account_id=source.id,
        destination_account_id=destination.id,
    )


def create_transaction(
    session: Session,
    ctx: RequestContext,
    data: NewTransaction,
    *,
    idempotency_key: str | None = None,
    source: TransactionSource = TransactionSource.MANUAL,
) -> WriteResult:
    digest = payload_hash(type(data).__name__, asdict(data)) if idempotency_key else None
    if idempotency_key is not None and digest is not None:
        existing = _find_by_key(session, ctx.user_id, idempotency_key)
        if existing is not None:
            return _replay(existing, digest)

    _require_positive(data.amount)
    match data:
        case NewTransfer():
            tx = _build_transfer(session, ctx, data)
        case NewExpense():
            tx = _build_categorized(
                session, ctx, data, TransactionType.EXPENSE, data.payment_method
            )
        case NewIncome():
            tx = _build_categorized(session, ctx, data, TransactionType.INCOME, None)
        case _:
            assert_never(data)
    tx.source = source

    raced = _insert(session, ctx, tx, idempotency_key, digest)
    if raced is not None:
        return raced
    spends = tx.type in (TransactionType.EXPENSE, TransactionType.TRANSFER)
    outflow = [tx.account_id] if spends else []
    as_of = max(ctx.today(), tx.occurred_on)
    return WriteResult(tx, notices=_negative_balance_notices(session, ctx, outflow, as_of))
