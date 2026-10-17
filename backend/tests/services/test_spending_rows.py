"""A consulta única de gasto (`ledger.spending_rows`): modos parcelas e compra, filtros."""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, Card, PaymentMethod, Transaction
from app.services import card_ledger, cards, invoice_payments, ledger, transactions
from app.services.context import RequestContext
from app.services.invoice_payments import NewInvoicePayment, PaymentSource
from app.services.ledger import Source, SpendingMode
from app.services.transactions import (
    NewCardExpense,
    NewExpense,
    NewIncome,
    NewRefund,
    NewTransfer,
)
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)
OCTOBER = (date(2026, 10, 1), date(2026, 10, 31))
NOVEMBER = (date(2026, 11, 1), date(2026, 11, 30))
WHOLE = (date(2026, 9, 1), date(2027, 6, 30))


@pytest.fixture
def itau(db: Session, ctx: RequestContext) -> Account:
    return make_account(db, ctx, "Itaú", "5000.00", opening_date=date(2026, 9, 1))


@pytest.fixture
def nubank(db: Session, ctx: RequestContext) -> Card:
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
        amount=Decimal(amount), occurred_on=on, description="compra", card_id=card.id, **extra
    )
    return transactions.create_transaction(db, ctx, data).transaction


def _spend(
    db: Session, ctx: RequestContext, account: Account, amount: str, **extra: Any
) -> Transaction:
    fields: dict[str, Any] = {
        "amount": Decimal(amount),
        "occurred_on": TODAY,
        "description": "mercado",
        "account_id": account.id,
        "payment_method": PaymentMethod.PIX,
    }
    fields.update(extra)
    return transactions.create_transaction(db, ctx, NewExpense(**fields)).transaction


def _total(db: Session, ctx: RequestContext, period: tuple[date, date], **kw: Any) -> Decimal:
    rows = ledger.spending_rows(ctx.user_id, *period, **kw)
    return Decimal(db.scalar(select(func.coalesce(func.sum(rows.c.amount), 0))))


def _by_day(
    db: Session, ctx: RequestContext, period: tuple[date, date], **kw: Any
) -> dict[date, Decimal]:
    rows = ledger.spending_rows(ctx.user_id, *period, **kw)
    result = db.execute(select(rows.c.day, func.sum(rows.c.amount)).group_by(rows.c.day)).all()
    return {day: Decimal(amount) for day, amount in result}


def test_installments_mode_matches_month_summary(
    db: Session, ctx: RequestContext, itau: Account, nubank: Card
) -> None:
    _spend(db, ctx, itau, "42.00")
    cash = _buy(db, ctx, nubank, "38.00")
    _buy(db, ctx, nubank, "1200.00", installments=6)
    invoice_payments.add_charge(
        db, ctx, nubank.id, amount=Decimal("15.00"), occurred_on=TODAY, description="IOF"
    )
    transactions.create_refund(
        db, ctx, cash.id, NewRefund(amount=Decimal("10.00"), occurred_on=TODAY)
    )
    for year, month, period in ((2026, 10, OCTOBER), (2026, 11, NOVEMBER)):
        summary = ledger.month_summary(db, ctx.user_id, year, month)
        assert _total(db, ctx, period) == summary.consumption_total
    assert _total(db, ctx, OCTOBER) == Decimal("42.00") + 38 + 200 + 15 - 10


def test_purchase_mode_counts_the_whole_purchase_on_its_date(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    _buy(db, ctx, nubank, "1200.00", installments=6)
    assert _by_day(db, ctx, OCTOBER, mode=SpendingMode.PURCHASE) == {TODAY: Decimal("1200.00")}
    assert _by_day(db, ctx, NOVEMBER, mode=SpendingMode.PURCHASE) == {}
    assert _by_day(db, ctx, OCTOBER) == {TODAY: Decimal("200.00")}
    assert _by_day(db, ctx, NOVEMBER) == {date(2026, 11, 15): Decimal("200.00")}


def test_installment_day_falls_on_last_day_of_shorter_month(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    _buy(db, ctx, nubank, "100.00", on=date(2026, 10, 31), installments=2)
    assert _by_day(db, ctx, NOVEMBER) == {date(2026, 11, 30): Decimal("50.00")}
    assert _total(db, ctx, WHOLE) == Decimal("100.00")


def test_refund_that_cancelled_installments_counts_once_in_each_mode(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    tx = _buy(db, ctx, nubank, "600.00", installments=3)
    transactions.create_refund(
        db, ctx, tx.id, NewRefund(amount=Decimal("200.00"), occurred_on=TODAY)
    )
    assert _total(db, ctx, WHOLE) == Decimal("400.00")
    assert _total(db, ctx, WHOLE, mode=SpendingMode.PURCHASE) == Decimal("400.00")


def test_source_filter_keeps_only_that_card_or_account(
    db: Session, ctx: RequestContext, itau: Account, nubank: Card
) -> None:
    _spend(db, ctx, itau, "42.00")
    _buy(db, ctx, nubank, "38.00")
    assert _total(db, ctx, OCTOBER, source=Source("card", nubank.id)) == Decimal("38.00")
    assert _total(db, ctx, OCTOBER, source=Source("account", itau.id)) == Decimal("42.00")


def test_category_filter(db: Session, ctx: RequestContext, itau: Account) -> None:
    health = find_category(db, ctx, "Saúde")
    _spend(db, ctx, itau, "42.00")
    _spend(db, ctx, itau, "80.00", description="farmácia", category_id=health.id)
    assert _total(db, ctx, OCTOBER, category_id=health.id) == Decimal("80.00")


def test_place_columns_use_merchant_or_description(
    db: Session, ctx: RequestContext, itau: Account, nubank: Card
) -> None:
    _spend(db, ctx, itau, "42.00", description="iFood")
    invoice_payments.add_charge(
        db, ctx, nubank.id, amount=Decimal("15.00"), occurred_on=TODAY, description="IOF"
    )
    rows = ledger.spending_rows(ctx.user_id, *OCTOBER)
    places = {
        (key[:2], name, counts)
        for key, name, counts in db.execute(
            select(rows.c.place_key, rows.c.place_name, rows.c.counts_as_purchase)
        )
    }
    assert places == {("m:", "iFood", True), ("d:", "IOF", True)}


def test_voided_transfers_income_and_invoice_payments_never_appear(
    db: Session, ctx: RequestContext, itau: Account, nubank: Card
) -> None:
    savings = make_account(db, ctx, "Poupança", "0.00", opening_date=date(2026, 9, 1))
    voided = _spend(db, ctx, itau, "99.00")
    transactions.void_transaction(db, ctx, voided.id)
    transactions.create_transaction(
        db,
        ctx,
        NewTransfer(
            amount=Decimal("100.00"),
            occurred_on=TODAY,
            description="guardar",
            account_id=itau.id,
            destination_account_id=savings.id,
        ),
    )
    transactions.create_transaction(
        db,
        ctx,
        NewIncome(
            amount=Decimal("3000.00"), occurred_on=TODAY, description="salário", account_id=itau.id
        ),
    )
    _buy(db, ctx, nubank, "50.00", on=date(2026, 9, 20))
    october_invoice = next(
        t.invoice
        for t in card_ledger.invoice_totals(db, nubank, TODAY)
        if t.invoice.reference_month == date(2026, 10, 1)
    )
    invoice_payments.pay_invoice(
        db,
        ctx,
        october_invoice.id,
        NewInvoicePayment(
            occurred_on=TODAY, sources=(PaymentSource(itau.id, Decimal("50.00")),), remainder="NONE"
        ),
    )
    assert _total(db, ctx, OCTOBER) == Decimal("0.00")
    assert _total(db, ctx, OCTOBER, mode=SpendingMode.PURCHASE) == Decimal("0.00")
