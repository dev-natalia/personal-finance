"""Casos de uso de escrita de lançamentos."""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, assert_never
from uuid import UUID

from sqlalchemy import func, select
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
    TransactionStatus,
    TransactionType,
)
from app.repositories import get_owned
from app.services import ledger
from app.services.accounts import get_active_account
from app.services.audit import jsonable, record, snapshot
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


def _lock_idempotency_key(session: Session, user_id: UUID, key: str) -> None:
    """Serializa requisições com a mesma chave até o fim da transação (clique duplo em paralelo).

    A segunda requisição espera a primeira confirmar e então encontra o lançamento já gravado.
    """
    session.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(f"{user_id}:{key}", 0)))
    )


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
        _lock_idempotency_key(session, ctx.user_id, idempotency_key)
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
    # Compra no cartão não tira dinheiro de conta (não tem account_id).
    outflow = [tx.account_id] if spends and tx.account_id is not None else []
    as_of = max(ctx.today(), tx.occurred_on)
    return WriteResult(tx, notices=_negative_balance_notices(session, ctx, outflow, as_of))


# --- estornos, edição e anulação ------------------------------------------------------------


@dataclass(frozen=True)
class NewRefund:
    amount: Decimal
    occurred_on: date
    account_id: UUID | None = None
    description: str | None = None


def _require_confirmed(tx: Transaction) -> None:
    if tx.status is TransactionStatus.VOIDED:
        raise RuleViolation(
            "transaction_voided", "Este lançamento foi anulado e não pode ser alterado."
        )


def _refunded_total(
    session: Session, expense_id: UUID, *, exclude_id: UUID | None = None
) -> Decimal:
    stmt = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.refund_of_id == expense_id,
        Transaction.status == TransactionStatus.CONFIRMED,
    )
    if exclude_id is not None:
        stmt = stmt.where(Transaction.id != exclude_id)
    return quantize(Decimal(session.scalar(stmt) or 0))


def create_refund(
    session: Session,
    ctx: RequestContext,
    expense_id: UUID,
    data: NewRefund,
    *,
    idempotency_key: str | None = None,
    source: TransactionSource = TransactionSource.MANUAL,
) -> WriteResult:
    digest = (
        payload_hash("NewRefund", {"expense_id": expense_id, **asdict(data)})
        if idempotency_key
        else None
    )
    if idempotency_key is not None and digest is not None:
        _lock_idempotency_key(session, ctx.user_id, idempotency_key)
        existing = _find_by_key(session, ctx.user_id, idempotency_key)
        if existing is not None:
            return _replay(existing, digest)

    _require_positive(data.amount)
    original = get_owned(
        session, Transaction, expense_id, ctx.user_id, "o lançamento", for_update=True
    )
    if original.type is not TransactionType.EXPENSE:
        raise RuleViolation("refund_requires_expense", "Só despesas podem ser estornadas.")
    _require_confirmed(original)
    remaining = original.amount - _refunded_total(session, original.id)
    if quantize(data.amount) > remaining:
        raise RuleViolation(
            "refund_exceeds_original",
            f"O estorno ultrapassa o valor ainda não estornado ({format_brl(remaining)}).",
        )
    if data.occurred_on < original.occurred_on:
        raise RuleViolation(
            "refund_before_expense", "O estorno não pode ter data anterior à despesa."
        )
    account_id = data.account_id or original.account_id
    if account_id is None:
        # Despesa no cartão: o estorno vira crédito na fatura (Tarefa 6 do plano 2).
        raise RuleViolation(
            "card_refund_not_supported", "Estorno de compra no cartão ainda não é suportado."
        )
    account = get_active_account(session, ctx, account_id)
    _check_opening(account, data.occurred_on)

    tx = Transaction(
        user_id=ctx.user_id,
        type=TransactionType.REFUND,
        amount=quantize(data.amount),
        occurred_on=data.occurred_on,
        description=(data.description or f"Estorno: {original.description}")[:200],
        account_id=account.id,
        category_id=original.category_id,
        merchant_id=original.merchant_id,
        refund_of_id=original.id,
        source=source,
    )
    raced = _insert(session, ctx, tx, idempotency_key, digest)
    return raced if raced is not None else WriteResult(tx)


_EDITABLE: dict[TransactionType, frozenset[str]] = {
    TransactionType.INCOME: frozenset(
        {"amount", "occurred_on", "description", "notes", "merchant", "category_id", "account_id"}
    ),
    TransactionType.EXPENSE: frozenset(
        {
            "amount",
            "occurred_on",
            "description",
            "notes",
            "merchant",
            "category_id",
            "account_id",
            "payment_method",
        }
    ),
    TransactionType.TRANSFER: frozenset(
        {"amount", "occurred_on", "description", "notes", "account_id", "destination_account_id"}
    ),
    TransactionType.REFUND: frozenset(
        {"amount", "occurred_on", "description", "notes", "account_id"}
    ),
}
_NULLABLE = frozenset({"notes", "merchant"})


def _involved_accounts(tx: Transaction) -> list[UUID]:
    """Contas que o lançamento movimenta (nenhuma nos lançamentos do cartão)."""
    return [a for a in (tx.account_id, tx.destination_account_id) if a is not None]


def _change_category(
    session: Session, ctx: RequestContext, tx: Transaction, category_id: UUID
) -> None:
    kind = CategoryKind.EXPENSE if tx.type is TransactionType.EXPENSE else CategoryKind.INCOME
    category = get_active_category(session, ctx, category_id, kind)
    tx.category_id = category.id
    merchant = session.get(Merchant, tx.merchant_id) if tx.merchant_id else None
    _learn(merchant, category)


def _sync_refund_categories(session: Session, ctx: RequestContext, expense: Transaction) -> None:
    """Estornos acompanham a categoria da despesa, para o consumo por categoria fechar."""
    refunds = list(
        session.scalars(
            select(Transaction).where(
                Transaction.refund_of_id == expense.id,
                Transaction.category_id != expense.category_id,
            )
        )
    )
    for refund in refunds:
        before = snapshot(refund)
        refund.category_id = expense.category_id
        record(session, ctx, refund, AuditAction.UPDATE, before)


def _validate(session: Session, tx: Transaction) -> None:
    if tx.type is TransactionType.TRANSFER and tx.account_id == tx.destination_account_id:
        raise RuleViolation(
            "transfer_same_account",
            "Origem e destino da transferência devem ser contas diferentes.",
        )
    for account_id in _involved_accounts(tx):
        _check_opening(session.get_one(Account, account_id), tx.occurred_on)
    if tx.type is TransactionType.EXPENSE:
        refunded = _refunded_total(session, tx.id)
        if tx.amount < refunded:
            raise RuleViolation(
                "amount_below_refunds",
                f"O valor não pode ser menor que o total já estornado ({format_brl(refunded)}).",
            )
        first_refund = session.scalar(
            select(func.min(Transaction.occurred_on)).where(
                Transaction.refund_of_id == tx.id,
                Transaction.status == TransactionStatus.CONFIRMED,
            )
        )
        if first_refund is not None and first_refund < tx.occurred_on:
            raise RuleViolation(
                "refund_before_expense",
                "A despesa não pode ficar com data posterior à de um estorno dela.",
            )
    if tx.type is TransactionType.REFUND and tx.refund_of_id is not None:
        original = session.get_one(Transaction, tx.refund_of_id, with_for_update=True)
        others = _refunded_total(session, original.id, exclude_id=tx.id)
        if others + tx.amount > original.amount:
            raise RuleViolation(
                "refund_exceeds_original",
                "O estorno ultrapassa o valor ainda não estornado "
                f"({format_brl(original.amount - others)}).",
            )
        if tx.occurred_on < original.occurred_on:
            raise RuleViolation(
                "refund_before_expense", "O estorno não pode ter data anterior à despesa."
            )


def update_transaction(
    session: Session, ctx: RequestContext, transaction_id: UUID, changes: Mapping[str, Any]
) -> WriteResult:
    tx = get_owned(
        session, Transaction, transaction_id, ctx.user_id, "o lançamento", for_update=True
    )
    _require_confirmed(tx)
    not_editable = set(changes) - _EDITABLE[tx.type]
    if not_editable:
        raise RuleViolation(
            "field_not_editable",
            "Campos que não podem ser alterados neste tipo de lançamento: "
            f"{', '.join(sorted(not_editable))}.",
        )
    missing = sorted(
        key for key, value in changes.items() if value is None and key not in _NULLABLE
    )
    if missing:
        raise RuleViolation(
            "field_required", f"Campos obrigatórios não podem ficar vazios: {', '.join(missing)}."
        )

    before = snapshot(tx)
    category_changed = "category_id" in changes and changes["category_id"] != tx.category_id
    # O estabelecimento é resolvido antes de qualquer mudança: resolve_merchant faz flush.
    if "merchant" in changes:
        merchant = resolve_merchant(session, ctx.user_id, changes["merchant"])
        tx.merchant_id = merchant.id if merchant else None
    # Sem autoflush: um estado intermediário inválido não pode ir ao banco antes da validação.
    with session.no_autoflush:
        if "amount" in changes:
            _require_positive(changes["amount"])
            tx.amount = quantize(changes["amount"])
        for key in ("occurred_on", "description", "notes", "payment_method"):
            if key in changes:
                setattr(tx, key, changes[key])
        # Valores reenviados sem mudança não são revalidados: arquivar uma conta ou categoria
        # não pode impedir a edição de outros campos dos lançamentos antigos dela.
        if "account_id" in changes and changes["account_id"] != tx.account_id:
            tx.account_id = get_active_account(session, ctx, changes["account_id"]).id
        destination_id = changes.get("destination_account_id", tx.destination_account_id)
        if destination_id != tx.destination_account_id:
            destination = get_active_account(session, ctx, destination_id)
            tx.destination_account_id = destination.id
        if category_changed:
            _change_category(session, ctx, tx, changes["category_id"])
        _validate(session, tx)
    record(session, ctx, tx, AuditAction.UPDATE, before)
    if tx.type is TransactionType.EXPENSE and category_changed:
        _sync_refund_categories(session, ctx, tx)
    as_of = max(ctx.today(), tx.occurred_on)
    notices = _negative_balance_notices(session, ctx, _involved_accounts(tx), as_of)
    return WriteResult(tx, notices=notices)


def void_transaction(session: Session, ctx: RequestContext, transaction_id: UUID) -> Transaction:
    tx = get_owned(
        session, Transaction, transaction_id, ctx.user_id, "o lançamento", for_update=True
    )
    if tx.status is TransactionStatus.VOIDED:
        return tx
    if tx.type is TransactionType.EXPENSE and _refunded_total(session, tx.id) > 0:
        raise RuleViolation(
            "has_active_refunds", "Anule os estornos desta despesa antes de anulá-la."
        )
    before = snapshot(tx)
    tx.status = TransactionStatus.VOIDED
    tx.voided_at = ctx.now()
    record(session, ctx, tx, AuditAction.VOID, before)
    return tx
