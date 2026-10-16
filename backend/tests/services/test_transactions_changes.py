from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import RuleViolation
from app.models import (
    Account,
    AuditAction,
    AuditLog,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionStatus,
)
from app.services import ledger, transactions
from app.services.context import RequestContext
from app.services.transactions import NewExpense, NewIncome, NewRefund, NewTransfer, WriteResult
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)


@pytest.fixture
def itau(db: Session, ctx: RequestContext) -> Account:
    return make_account(db, ctx, "Itaú", "1000.00")


@pytest.fixture
def expense(db: Session, ctx: RequestContext, itau: Account) -> Transaction:
    mercado = find_category(db, ctx, "Mercado")
    data = NewExpense(
        amount=Decimal("42.00"),
        occurred_on=date(2026, 10, 10),
        description="Mercado",
        account_id=itau.id,
        payment_method=PaymentMethod.PIX,
        category_id=mercado.id,
    )
    return transactions.create_transaction(db, ctx, data).transaction


def _refund(
    db: Session,
    ctx: RequestContext,
    expense: Transaction,
    amount: str = "10.00",
    occurred_on: date = TODAY,
    key: str | None = None,
) -> WriteResult:
    data = NewRefund(amount=Decimal(amount), occurred_on=occurred_on)
    return transactions.create_refund(db, ctx, expense.id, data, idempotency_key=key)


def _code(exc: pytest.ExceptionInfo[RuleViolation]) -> str:
    return exc.value.code


def _audits(db: Session, entity_id: UUID) -> list[AuditLog]:
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.id))
    )


def test_refund_copies_category_and_defaults(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    refund = _refund(db, ctx, expense).transaction
    assert refund.refund_of_id == expense.id
    assert refund.category_id == expense.category_id
    assert refund.account_id == expense.account_id
    assert refund.merchant_id == expense.merchant_id
    assert refund.description == "Estorno: Mercado"


def test_refunds_cannot_exceed_original(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, "30.00")
    _refund(db, ctx, expense, "12.00")
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, expense, "0.01")
    assert _code(exc) == "refund_exceeds_original"


def test_refund_requires_confirmed_expense(
    db: Session, ctx: RequestContext, itau: Account, expense: Transaction
) -> None:
    income = transactions.create_transaction(
        db,
        ctx,
        NewIncome(amount=Decimal("5.00"), occurred_on=TODAY, description="Pix", account_id=itau.id),
    ).transaction
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, income, "1.00")
    assert _code(exc) == "refund_requires_expense"

    transactions.void_transaction(db, ctx, expense.id)
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, expense)
    assert _code(exc) == "transaction_voided"


def test_refund_date_cannot_precede_expense(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, expense, occurred_on=date(2026, 10, 9))
    assert _code(exc) == "refund_before_expense"


def test_refund_is_idempotent(db: Session, ctx: RequestContext, expense: Transaction) -> None:
    first = _refund(db, ctx, expense, key="estorno-0001")
    second = _refund(db, ctx, expense, key="estorno-0001")
    assert second.replayed and second.transaction.id == first.transaction.id


def test_refund_reduces_consumption(db: Session, ctx: RequestContext, expense: Transaction) -> None:
    _refund(db, ctx, expense)
    summary = ledger.month_summary(db, ctx.user_id, 2026, 10)
    assert {c.name: c.amount for c in summary.by_category} == {"Mercado": Decimal("32.00")}


def test_update_amount_audits_before_and_after(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    updated = transactions.update_transaction(
        db, ctx, expense.id, {"amount": Decimal("50.00")}
    ).transaction
    assert updated.amount == Decimal("50.00")
    log = _audits(db, expense.id)[-1]
    assert log.action is AuditAction.UPDATE
    assert log.before is not None and log.before["amount"] == "42.00"
    assert log.after is not None and log.after["amount"] == "50.00"


def test_update_rejects_fields_not_editable_for_type(
    db: Session, ctx: RequestContext, itau: Account, expense: Transaction
) -> None:
    income = transactions.create_transaction(
        db,
        ctx,
        NewIncome(amount=Decimal("5.00"), occurred_on=TODAY, description="Pix", account_id=itau.id),
    ).transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, income.id, {"payment_method": PaymentMethod.PIX})
    assert _code(exc) == "field_not_editable"
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"destination_account_id": itau.id})
    assert _code(exc) == "field_not_editable"


def test_update_rejects_null_required_field(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"amount": None})
    assert _code(exc) == "field_required"


def test_update_amount_cannot_go_below_refunds(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, "30.00")
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"amount": Decimal("20.00")})
    assert _code(exc) == "amount_below_refunds"


def test_update_refund_amount_respects_original(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, "30.00")
    second = _refund(db, ctx, expense, "10.00").transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, second.id, {"amount": Decimal("13.00")})
    assert _code(exc) == "refund_exceeds_original"
    transactions.update_transaction(db, ctx, second.id, {"amount": Decimal("12.00")})


def test_update_voided_rejected(db: Session, ctx: RequestContext, expense: Transaction) -> None:
    transactions.void_transaction(db, ctx, expense.id)
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"description": "x"})
    assert _code(exc) == "transaction_voided"


def test_update_transfer_same_account_rejected(
    db: Session, ctx: RequestContext, itau: Account
) -> None:
    nubank = make_account(db, ctx, "Nubank")
    transfer = transactions.create_transaction(
        db,
        ctx,
        NewTransfer(
            amount=Decimal("10.00"),
            occurred_on=TODAY,
            description="Reserva",
            account_id=itau.id,
            destination_account_id=nubank.id,
        ),
    ).transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, transfer.id, {"destination_account_id": itau.id})
    assert _code(exc) == "transfer_same_account"


def test_update_date_before_opening_rejected(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"occurred_on": date(2026, 9, 30)})
    assert _code(exc) == "date_before_account_opening"


def test_update_expense_date_after_refund_rejected(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, occurred_on=date(2026, 10, 12))
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"occurred_on": date(2026, 10, 13)})
    assert _code(exc) == "refund_before_expense"


def test_update_category_propagates_to_refunds_and_teaches_merchant(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    refund = _refund(db, ctx, expense).transaction
    alimentacao = find_category(db, ctx, "Alimentação")
    transactions.update_transaction(db, ctx, expense.id, {"category_id": alimentacao.id})
    assert refund.category_id == alimentacao.id
    assert _audits(db, refund.id)[-1].action is AuditAction.UPDATE
    summary = ledger.month_summary(db, ctx.user_id, 2026, 10)
    assert {c.name: c.amount for c in summary.by_category} == {"Alimentação": Decimal("32.00")}
    assert expense.merchant_id is not None
    merchant = db.get(Merchant, expense.merchant_id)
    assert merchant is not None and merchant.default_category_id == alimentacao.id


def test_update_returns_negative_balance_notice(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    result = transactions.update_transaction(db, ctx, expense.id, {"amount": Decimal("2000.00")})
    assert [n.code for n in result.notices] == ["negative_balance"]


def test_void_excludes_from_balance_and_is_idempotent(
    db: Session, ctx: RequestContext, itau: Account, expense: Transaction
) -> None:
    assert ledger.account_balances(db, ctx.user_id, TODAY)[itau.id] == Decimal("958.00")
    voided = transactions.void_transaction(db, ctx, expense.id)
    assert voided.status is TransactionStatus.VOIDED and voided.voided_at is not None
    transactions.void_transaction(db, ctx, expense.id)
    assert ledger.account_balances(db, ctx.user_id, TODAY)[itau.id] == Decimal("1000.00")
    assert [a.action for a in _audits(db, expense.id)].count(AuditAction.VOID) == 1


def test_void_blocked_by_active_refunds(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    refund = _refund(db, ctx, expense).transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.void_transaction(db, ctx, expense.id)
    assert _code(exc) == "has_active_refunds"
    transactions.void_transaction(db, ctx, refund.id)
    transactions.void_transaction(db, ctx, expense.id)
