from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import (
    Account,
    Actor,
    AuditAction,
    AuditLog,
    CategoryKind,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionSource,
    TransactionType,
)
from app.services import accounts, categories, transactions
from app.services.context import RequestContext
from app.services.transactions import NewExpense, NewIncome, NewTransfer
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)


def _expense(account: Account, **overrides: Any) -> NewExpense:
    data: dict[str, Any] = {
        "amount": Decimal("42.00"),
        "occurred_on": TODAY,
        "description": "Mercado",
        "account_id": account.id,
        "payment_method": PaymentMethod.PIX,
    }
    data.update(overrides)
    return NewExpense(**data)


def _audit_actions(db: Session, entity_id: UUID) -> list[AuditAction]:
    return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity_id)))


def test_expense_without_category_goes_to_unclassified_and_creates_merchant(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    result = transactions.create_transaction(db, ctx, _expense(itau, description="Padaria do Zé"))
    tx = result.transaction
    assert not result.replayed
    assert tx.type is TransactionType.EXPENSE
    assert tx.amount == Decimal("42.00")
    assert tx.payment_method is PaymentMethod.PIX
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    assert tx.category_id == unclassified.id
    assert tx.merchant_id is not None
    merchant = db.get(Merchant, tx.merchant_id)
    assert merchant is not None and merchant.normalized_name == "padaria do ze"
    assert _audit_actions(db, tx.id) == [AuditAction.CREATE]


def test_explicit_category_is_learned_for_merchant(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    saude = find_category(db, ctx, "Saúde")
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Drogasil", category_id=saude.id)
    )
    second = transactions.create_transaction(
        db, ctx, _expense(itau, description="DROGASIL", amount=Decimal("10.00"))
    )
    assert second.transaction.category_id == saude.id
    merchants = db.scalar(
        select(func.count()).select_from(Merchant).where(Merchant.user_id == ctx.user_id)
    )
    assert merchants == 1


def test_system_category_is_not_learned(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Feira", category_id=unclassified.id)
    )
    merchant = db.scalars(select(Merchant).where(Merchant.normalized_name == "feira")).one()
    assert merchant.default_category_id is None


def test_archived_default_category_falls_back_to_unclassified(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    trips = categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Hotel X", category_id=trips.id)
    )
    categories.archive_category(db, ctx, trips.id)
    later = transactions.create_transaction(db, ctx, _expense(itau, description="Hotel X"))
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    assert later.transaction.category_id == unclassified.id


def test_income_ignores_expense_default_of_merchant(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    lazer = find_category(db, ctx, "Lazer")
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Empresa X", category_id=lazer.id)
    )
    income = transactions.create_transaction(
        db,
        ctx,
        NewIncome(
            amount=Decimal("100.00"),
            occurred_on=TODAY,
            description="Empresa X",
            account_id=itau.id,
        ),
    )
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.INCOME)
    assert income.transaction.category_id == unclassified.id


def test_income_rejects_expense_category(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    lazer = find_category(db, ctx, "Lazer")
    data = NewIncome(
        amount=Decimal("1.00"),
        occurred_on=TODAY,
        description="x",
        account_id=itau.id,
        category_id=lazer.id,
    )
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, data)
    assert exc.value.code == "category_kind_mismatch"


def test_transfer_moves_between_accounts(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú")
    nubank = make_account(db, ctx, "Nubank")
    transfer = transactions.create_transaction(
        db,
        ctx,
        NewTransfer(
            amount=Decimal("300.00"),
            occurred_on=TODAY,
            description="Reserva",
            account_id=itau.id,
            destination_account_id=nubank.id,
        ),
    ).transaction
    assert transfer.category_id is None
    assert transfer.merchant_id is None
    assert transfer.destination_account_id == nubank.id


def test_transfer_same_account_rejected(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    data = NewTransfer(
        amount=Decimal("1.00"),
        occurred_on=TODAY,
        description="x",
        account_id=itau.id,
        destination_account_id=itau.id,
    )
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, data)
    assert exc.value.code == "transfer_same_account"


def test_date_before_opening_rejected(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú", opening_date=date(2026, 10, 1))
    later = make_account(db, ctx, "Nova", opening_date=date(2026, 10, 20))
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, _expense(itau, occurred_on=date(2026, 9, 30)))
    assert exc.value.code == "date_before_account_opening"
    transfer = NewTransfer(
        amount=Decimal("1.00"),
        occurred_on=TODAY,
        description="x",
        account_id=itau.id,
        destination_account_id=later.id,
    )
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, transfer)
    assert exc.value.code == "date_before_account_opening"


def test_archived_account_rejected(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    accounts.archive_account(db, ctx, itau.id)
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, _expense(itau))
    assert exc.value.code == "account_archived"


def test_other_users_account_not_found(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    with pytest.raises(NotFound):
        transactions.create_transaction(db, ctx, _expense(foreign))


def test_amount_must_be_positive(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, _expense(itau, amount=Decimal("0")))
    assert exc.value.code == "amount_not_positive"


def test_idempotent_replay_returns_same_transaction(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    data = _expense(itau)
    first = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0001")
    second = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0001")
    assert second.replayed
    assert second.transaction.id == first.transaction.id
    stored = db.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.idempotency_key == "chave-0001")
    )
    assert stored == 1
    assert _audit_actions(db, first.transaction.id) == [AuditAction.CREATE]


def test_idempotency_key_reuse_with_different_payload_conflicts(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    transactions.create_transaction(db, ctx, _expense(itau), idempotency_key="chave-0001")
    with pytest.raises(Conflict) as exc:
        transactions.create_transaction(
            db, ctx, _expense(itau, amount=Decimal("43.00")), idempotency_key="chave-0001"
        )
    assert exc.value.code == "idempotency_key_reused"


def test_idempotency_race_returns_existing(
    db: Session, ctx: RequestContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simula duas requisições simultâneas: a segunda não vê a primeira na checagem inicial."""
    itau = make_account(db, ctx)
    data = _expense(itau)
    first = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0002")

    real_find = transactions._find_by_key
    calls = {"n": 0}

    def flaky_find(session: Session, user_id: UUID, key: str) -> Transaction | None:
        calls["n"] += 1
        return None if calls["n"] == 1 else real_find(session, user_id, key)

    monkeypatch.setattr(transactions, "_find_by_key", flaky_find)
    again = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0002")
    assert again.replayed
    assert again.transaction.id == first.transaction.id


def test_negative_balance_notice(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, opening_balance="10.00")
    [notice] = transactions.create_transaction(db, ctx, _expense(itau)).notices
    assert notice.code == "negative_balance"
    assert "-R$ 32,00" in notice.detail


def test_source_and_actor_recorded(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    ai_ctx = replace(ctx, actor=Actor.AI)
    tx = transactions.create_transaction(
        db, ai_ctx, _expense(itau), source=TransactionSource.AI
    ).transaction
    assert tx.source is TransactionSource.AI
    log = db.scalars(select(AuditLog).where(AuditLog.entity_id == tx.id)).one()
    assert log.actor is Actor.AI


def test_account_opening_date_cannot_move_after_existing_transactions(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    transactions.create_transaction(db, ctx, _expense(itau, occurred_on=date(2026, 10, 5)))
    with pytest.raises(RuleViolation) as exc:
        accounts.update_account(db, ctx, itau.id, opening_date=date(2026, 10, 10))
    assert exc.value.code == "date_before_account_opening"
    accounts.update_account(db, ctx, itau.id, opening_date=date(2026, 10, 5))
