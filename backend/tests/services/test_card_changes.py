import uuid
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import RuleViolation
from app.models import (
    Card,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
    ItemStatus,
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.services import cards, invoices, ledger, transactions
from app.services.context import RequestContext
from app.services.transactions import NewCardExpense, NewExpense, NewRefund
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)


@pytest.fixture
def card(db: Session, ctx: RequestContext) -> Card:
    return cards.create_card(
        db,
        ctx,
        name="Nubank",
        credit_limit=Decimal("11000.00"),
        closing_day=3,
        due_day=10,
        opening_date=date(2026, 9, 1),
    )


def _buy(
    db: Session, ctx: RequestContext, card: Card, amount: str, on: date = TODAY, **extra: Any
) -> Transaction:
    data = NewCardExpense(
        amount=Decimal(amount),
        occurred_on=on,
        description="celular",
        card_id=card.id,
        category_id=find_category(db, ctx, "Compras diversas").id,
        **extra,
    )
    return transactions.create_transaction(db, ctx, data).transaction


def _refund(db: Session, ctx: RequestContext, tx: Transaction, amount: str) -> Transaction:
    data = NewRefund(amount=Decimal(amount), occurred_on=TODAY)
    return transactions.create_refund(db, ctx, tx.id, data).transaction


def _items(db: Session, tx: Transaction) -> list[tuple[date, int | None, ItemStatus]]:
    rows = db.execute(
        select(Invoice.reference_month, InvoiceItem.installment_number, InvoiceItem.status)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(InvoiceItem.transaction_id == tx.id)
        .order_by(Invoice.reference_month)
    ).all()
    return [tuple(r) for r in rows]  # type: ignore[misc]


def _credits(db: Session, refund: Transaction) -> list[tuple[date, Decimal]]:
    rows = db.execute(
        select(Invoice.reference_month, InvoiceItem.amount)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(
            InvoiceItem.transaction_id == refund.id,
            InvoiceItem.kind == InvoiceItemKind.REFUND_CREDIT,
            InvoiceItem.status == ItemStatus.ACTIVE,
        )
    ).all()
    return [tuple(r) for r in rows]  # type: ignore[misc]


def _cancelled(items: list[tuple[date, int | None, ItemStatus]]) -> list[int | None]:
    return [n for _, n, status in items if status is ItemStatus.CANCELLED]


ACTIVE, CANCELLED = ItemStatus.ACTIVE, ItemStatus.CANCELLED


# --- estorno ----------------------------------------------------------------------------------


def test_refund_of_cash_purchase_credits_the_open_invoice(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "38.00", on=date(2026, 10, 2))  # fatura de outubro, fechada
    refund = _refund(db, ctx, purchase, "38.00")
    assert (refund.account_id, refund.card_id) == (None, card.id)
    assert _credits(db, refund) == [(date(2026, 11, 1), Decimal("38.00"))]
    assert _items(db, purchase) == [(date(2026, 10, 1), None, ACTIVE)]


def test_refund_of_installment_cancels_whole_installments_from_the_last(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", installments=6)
    refund = _refund(db, ctx, purchase, "500.00")
    assert _cancelled(_items(db, purchase)) == [5, 6]
    assert _credits(db, refund) == [(date(2026, 11, 1), Decimal("100.00"))]


def test_small_refund_of_installment_becomes_credit_only(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", installments=6)
    refund = _refund(db, ctx, purchase, "150.00")
    assert _cancelled(_items(db, purchase)) == []
    assert _credits(db, refund) == [(date(2026, 11, 1), Decimal("150.00"))]


def test_refund_never_touches_closed_invoices(db: Session, ctx: RequestContext, card: Card) -> None:
    # Parcelas em setembro e outubro (fechadas) e de novembro a fevereiro (abertas/futuras).
    purchase = _buy(db, ctx, card, "1200.00", on=date(2026, 9, 2), installments=6)
    refund = _refund(db, ctx, purchase, "1200.00")
    items = _items(db, purchase)
    assert _cancelled(items) == [3, 4, 5, 6]
    assert [s for m, _, s in items if m <= date(2026, 10, 1)] == [ACTIVE, ACTIVE]
    assert _credits(db, refund) == [(date(2026, 11, 1), Decimal("400.00"))]


def test_refund_consumption_excludes_cancelled_installments(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", installments=6)
    _refund(db, ctx, purchase, "500.00")
    october = ledger.month_summary(db, ctx.user_id, 2026, 10)
    assert october.consumption_total == Decimal("100.00")  # parcela 1 (200) − crédito (100)
    assert ledger.month_summary(db, ctx.user_id, 2027, 2).consumption_total == Decimal("0.00")
    assert ledger.month_summary(db, ctx.user_id, 2027, 1).consumption_total == Decimal("200.00")


def test_card_refund_with_account_is_rejected(db: Session, ctx: RequestContext, card: Card) -> None:
    account = make_account(db, ctx)
    purchase = _buy(db, ctx, card, "38.00")
    data = NewRefund(amount=Decimal("38.00"), occurred_on=TODAY, account_id=account.id)
    with pytest.raises(RuleViolation) as error:
        transactions.create_refund(db, ctx, purchase.id, data)
    assert error.value.code == "refund_account_not_allowed"


# --- anulação ---------------------------------------------------------------------------------


def test_void_card_purchase_cancels_its_items(db: Session, ctx: RequestContext, card: Card) -> None:
    purchase = _buy(db, ctx, card, "1200.00", installments=6)
    transactions.void_transaction(db, ctx, purchase.id)
    assert purchase.status is TransactionStatus.VOIDED
    assert {s for _, _, s in _items(db, purchase)} == {CANCELLED}


def test_void_blocked_when_an_installment_is_in_a_closed_invoice(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", on=date(2026, 9, 2), installments=6)
    with pytest.raises(RuleViolation) as error:
        transactions.void_transaction(db, ctx, purchase.id)
    assert error.value.code == "void_blocked_by_closed_invoice"
    assert error.value.detail == "Esta compra já está em fatura fechada. Registre um estorno."
    assert purchase.status is TransactionStatus.CONFIRMED


def test_void_card_refund_restores_installments(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", installments=6)
    refund = _refund(db, ctx, purchase, "500.00")
    transactions.void_transaction(db, ctx, refund.id)
    assert _cancelled(_items(db, purchase)) == []
    assert _credits(db, refund) == []


def test_void_charge_cancels_its_item(db: Session, ctx: RequestContext, card: Card) -> None:
    # Encargo gravado direto; o serviço de encargo chega na Tarefa 7.
    charge = Transaction(
        user_id=ctx.user_id,
        type=TransactionType.CHARGE,
        amount=Decimal("15.00"),
        occurred_on=TODAY,
        description="IOF",
        card_id=card.id,
        category_id=find_category(db, ctx, "Encargos financeiros").id,
    )
    db.add(charge)
    db.flush()
    invoices.add_item(
        db,
        ctx,
        invoices.get_or_create_invoice(db, card, date(2026, 11, 1)),
        kind=InvoiceItemKind.CHARGE,
        direction=ItemDirection.DEBIT,
        amount=Decimal("15.00"),
        transaction_id=charge.id,
    )
    transactions.void_transaction(db, ctx, charge.id)
    assert {s for _, _, s in _items(db, charge)} == {CANCELLED}


def test_invoice_payment_is_voided_only_by_group(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    account = make_account(db, ctx)
    purchase = _buy(db, ctx, card, "38.00")
    invoice_id = db.scalars(
        select(InvoiceItem.invoice_id).where(InvoiceItem.transaction_id == purchase.id)
    ).one()
    payment = Transaction(
        user_id=ctx.user_id,
        type=TransactionType.INVOICE_PAYMENT,
        amount=Decimal("38.00"),
        occurred_on=TODAY,
        description="Pagamento",
        account_id=account.id,
        invoice_id=invoice_id,
        payment_group_id=uuid.uuid7(),
    )
    db.add(payment)
    db.flush()
    with pytest.raises(RuleViolation) as error:
        transactions.void_transaction(db, ctx, payment.id)
    assert error.value.code == "void_payment_group"
    with pytest.raises(RuleViolation) as edit_error:
        transactions.update_transaction(db, ctx, payment.id, {"description": "outra"})
    assert edit_error.value.code == "field_not_editable"


# --- edição -----------------------------------------------------------------------------------


def test_edit_description_and_category_of_card_purchase(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", on=date(2026, 9, 2), installments=6)
    saude = find_category(db, ctx, "Saúde")
    transactions.update_transaction(
        db, ctx, purchase.id, {"description": "celular novo", "category_id": saude.id}
    )
    assert (purchase.description, purchase.category_id) == ("celular novo", saude.id)


def test_edit_amount_of_open_card_purchase_rebuilds_installments(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", installments=6)
    transactions.update_transaction(
        db, ctx, purchase.id, {"amount": Decimal("900.00"), "installments": 3}
    )
    active = db.execute(
        select(Invoice.reference_month, InvoiceItem.amount)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(InvoiceItem.transaction_id == purchase.id, InvoiceItem.status == ItemStatus.ACTIVE)
        .order_by(Invoice.reference_month)
    ).all()
    assert [tuple(r) for r in active] == [
        (date(2026, 11, 1), Decimal("300.00")),
        (date(2026, 12, 1), Decimal("300.00")),
        (date(2027, 1, 1), Decimal("300.00")),
    ]
    assert purchase.installments == 3


def test_edit_card_moves_purchase_to_the_other_card(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    inter = cards.create_card(
        db,
        ctx,
        name="Inter",
        credit_limit=Decimal("2000.00"),
        closing_day=20,
        due_day=27,
        opening_date=date(2026, 9, 1),
    )
    purchase = _buy(db, ctx, card, "38.00")
    transactions.update_transaction(db, ctx, purchase.id, {"card_id": inter.id})
    active = db.scalars(
        select(Invoice.card_id)
        .join(InvoiceItem, InvoiceItem.invoice_id == Invoice.id)
        .where(InvoiceItem.transaction_id == purchase.id, InvoiceItem.status == ItemStatus.ACTIVE)
    ).all()
    assert active == [inter.id]
    assert purchase.card_id == inter.id


def test_edit_amount_blocked_by_closed_invoice(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    purchase = _buy(db, ctx, card, "1200.00", on=date(2026, 9, 2), installments=6)
    with pytest.raises(RuleViolation) as error:
        transactions.update_transaction(db, ctx, purchase.id, {"amount": Decimal("900.00")})
    assert error.value.code == "void_blocked_by_closed_invoice"


def test_edit_amount_blocked_by_active_refund(db: Session, ctx: RequestContext, card: Card) -> None:
    purchase = _buy(db, ctx, card, "1200.00", installments=6)
    _refund(db, ctx, purchase, "500.00")
    with pytest.raises(RuleViolation) as error:
        transactions.update_transaction(db, ctx, purchase.id, {"amount": Decimal("900.00")})
    assert error.value.code == "has_active_refunds"


def test_switching_account_and_card_is_not_an_edit(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    account = make_account(db, ctx)
    purchase = _buy(db, ctx, card, "38.00")
    with pytest.raises(RuleViolation) as error:
        transactions.update_transaction(db, ctx, purchase.id, {"account_id": account.id})
    assert error.value.code == "field_not_editable"
    pix = transactions.create_transaction(
        db,
        ctx,
        NewExpense(
            amount=Decimal("10.00"),
            occurred_on=TODAY,
            description="padaria",
            account_id=account.id,
            payment_method=PaymentMethod.PIX,
        ),
    ).transaction
    with pytest.raises(RuleViolation) as other:
        transactions.update_transaction(db, ctx, pix.id, {"card_id": card.id})
    assert other.value.code == "field_not_editable"
