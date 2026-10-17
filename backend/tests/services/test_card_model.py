"""Regras de forma no banco para cartões, faturas e os lançamentos novos (rede de segurança)."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Card,
    Category,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
    PaymentMethod,
    Transaction,
    TransactionType,
)
from app.services.context import RequestContext
from tests.support import find_category, make_account, make_card


@pytest.fixture
def account(db: Session, ctx: RequestContext) -> Account:
    return make_account(db, ctx)


@pytest.fixture
def card(db: Session, ctx: RequestContext) -> Card:
    return make_card(db, ctx)


@pytest.fixture
def groceries(db: Session, ctx: RequestContext) -> Category:
    return find_category(db, ctx, "Mercado")


@pytest.fixture
def charges(db: Session, ctx: RequestContext) -> Category:
    return find_category(db, ctx, "Encargos financeiros")


def _invoice(db: Session, ctx: RequestContext, card: Card, **overrides: Any) -> Invoice:
    fields: dict[str, Any] = {
        "user_id": ctx.user_id,
        "card_id": card.id,
        "reference_month": date(2026, 11, 1),
        "closing_date": date(2026, 11, 3),
        "due_date": date(2026, 11, 10),
    }
    fields.update(overrides)
    invoice = Invoice(**fields)
    db.add(invoice)
    db.flush()
    return invoice


def _tx(db: Session, ctx: RequestContext, **fields: Any) -> Transaction:
    tx = Transaction(
        user_id=ctx.user_id,
        amount=Decimal("42.00"),
        occurred_on=date(2026, 10, 15),
        description="teste",
        **fields,
    )
    db.add(tx)
    db.flush()
    return tx


def _rejected(db: Session, constraint: str, build: Any) -> None:
    with pytest.raises(IntegrityError, match=constraint), db.begin_nested():
        build()


def test_expense_on_card_without_account_is_accepted(
    db: Session, ctx: RequestContext, card: Card, groceries: Category
) -> None:
    tx = _tx(
        db,
        ctx,
        type=TransactionType.EXPENSE,
        card_id=card.id,
        category_id=groceries.id,
        payment_method=PaymentMethod.CREDIT,
        installments=6,
    )
    assert tx.account_id is None


def test_expense_with_both_account_and_card_is_rejected(
    db: Session, ctx: RequestContext, account: Account, card: Card, groceries: Category
) -> None:
    _rejected(
        db,
        "ck_transactions_shape_by_type",
        lambda: _tx(
            db,
            ctx,
            type=TransactionType.EXPENSE,
            account_id=account.id,
            card_id=card.id,
            category_id=groceries.id,
            payment_method=PaymentMethod.CREDIT,
        ),
    )


def test_card_expense_with_pix_is_rejected(
    db: Session, ctx: RequestContext, card: Card, groceries: Category
) -> None:
    _rejected(
        db,
        "ck_transactions_shape_by_type",
        lambda: _tx(
            db,
            ctx,
            type=TransactionType.EXPENSE,
            card_id=card.id,
            category_id=groceries.id,
            payment_method=PaymentMethod.PIX,
        ),
    )


def test_account_expense_with_credit_is_rejected(
    db: Session, ctx: RequestContext, account: Account, groceries: Category
) -> None:
    _rejected(
        db,
        "ck_transactions_shape_by_type",
        lambda: _tx(
            db,
            ctx,
            type=TransactionType.EXPENSE,
            account_id=account.id,
            category_id=groceries.id,
            payment_method=PaymentMethod.CREDIT,
        ),
    )


def test_invoice_payment_requires_invoice_and_group(
    db: Session, ctx: RequestContext, account: Account, card: Card
) -> None:
    invoice = _invoice(db, ctx, card)
    _rejected(
        db,
        "ck_transactions_shape_by_type",
        lambda: _tx(db, ctx, type=TransactionType.INVOICE_PAYMENT, account_id=account.id),
    )
    tx = _tx(
        db,
        ctx,
        type=TransactionType.INVOICE_PAYMENT,
        account_id=account.id,
        invoice_id=invoice.id,
        payment_group_id=uuid.uuid7(),
    )
    assert tx.card_id is None


def test_charge_requires_card_and_category(
    db: Session, ctx: RequestContext, account: Account, card: Card, charges: Category
) -> None:
    _rejected(
        db,
        "ck_transactions_shape_by_type",
        lambda: _tx(db, ctx, type=TransactionType.CHARGE, card_id=card.id),
    )
    _rejected(
        db,
        "ck_transactions_shape_by_type",
        lambda: _tx(
            db, ctx, type=TransactionType.CHARGE, account_id=account.id, category_id=charges.id
        ),
    )
    tx = _tx(db, ctx, type=TransactionType.CHARGE, card_id=card.id, category_id=charges.id)
    assert tx.account_id is None


def test_income_still_requires_account(
    db: Session, ctx: RequestContext, card: Card, groceries: Category
) -> None:
    _rejected(
        db,
        "ck_transactions_shape_by_type",
        lambda: _tx(
            db, ctx, type=TransactionType.INCOME, card_id=card.id, category_id=groceries.id
        ),
    )


@pytest.mark.parametrize("installments", [1, 25])
def test_installments_out_of_range_is_rejected(
    db: Session, ctx: RequestContext, card: Card, groceries: Category, installments: int
) -> None:
    _rejected(
        db,
        "ck_transactions_installments_range",
        lambda: _tx(
            db,
            ctx,
            type=TransactionType.EXPENSE,
            card_id=card.id,
            category_id=groceries.id,
            payment_method=PaymentMethod.CREDIT,
            installments=installments,
        ),
    )


def test_remaining_installments_must_be_below_installments(
    db: Session, ctx: RequestContext, card: Card, groceries: Category
) -> None:
    _rejected(
        db,
        "ck_transactions_remaining_installments_range",
        lambda: _tx(
            db,
            ctx,
            type=TransactionType.EXPENSE,
            card_id=card.id,
            category_id=groceries.id,
            payment_method=PaymentMethod.CREDIT,
            installments=6,
            remaining_installments=6,
        ),
    )


def test_invoice_reference_month_must_be_first_day(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    _rejected(
        db,
        "ck_invoices_reference_month_first_day",
        lambda: _invoice(db, ctx, card, reference_month=date(2026, 11, 2)),
    )


def test_two_invoices_for_the_same_month_are_rejected(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    _invoice(db, ctx, card)
    _rejected(db, "uq_invoices_card_id_reference_month", lambda: _invoice(db, ctx, card))


def test_invoice_item_amount_must_be_positive(db: Session, ctx: RequestContext, card: Card) -> None:
    invoice = _invoice(db, ctx, card)

    def build() -> None:
        db.add(
            InvoiceItem(
                user_id=ctx.user_id,
                invoice_id=invoice.id,
                kind=InvoiceItemKind.OPENING_BALANCE,
                direction=ItemDirection.DEBIT,
                amount=Decimal("0.00"),
            )
        )
        db.flush()

    _rejected(db, "ck_invoice_items_amount_positive", build)


def test_card_limit_and_days_are_checked(db: Session, ctx: RequestContext) -> None:
    _rejected(db, "ck_cards_closing_day_range", lambda: make_card(db, ctx, closing_day=32))
    _rejected(db, "ck_cards_credit_limit_positive", lambda: make_card(db, ctx, credit_limit="0.00"))
