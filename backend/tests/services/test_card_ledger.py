import uuid
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Card,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
    Transaction,
    TransactionType,
)
from app.services import card_ledger, cards, invoices, transactions
from app.services.card_ledger import InvoiceState
from app.services.cards import OpeningState
from app.services.context import RequestContext
from app.services.transactions import NewCardExpense
from tests.support import make_account

TODAY = date(2026, 10, 15)


def _card(db: Session, ctx: RequestContext, **overrides: Any) -> Card:
    fields: dict[str, Any] = {
        "name": "Nubank",
        "credit_limit": Decimal("11000.00"),
        "closing_day": 3,
        "due_day": 10,
        "opening_date": date(2026, 9, 1),
    }
    fields.update(overrides)
    return cards.create_card(db, ctx, **fields)


def _buy(
    db: Session, ctx: RequestContext, card: Card, amount: str, on: date, **extra: Any
) -> Transaction:
    data = NewCardExpense(
        amount=Decimal(amount), occurred_on=on, description="compra", card_id=card.id, **extra
    )
    return transactions.create_transaction(db, ctx, data).transaction


def _invoice(db: Session, card: Card, month: date) -> Invoice:
    return db.scalars(
        select(Invoice).where(Invoice.card_id == card.id, Invoice.reference_month == month)
    ).one()


def _pay(db: Session, ctx: RequestContext, account: Account, invoice: Invoice, amount: str) -> None:
    """Pagamento gravado direto (o serviço de pagamento chega na Tarefa 7)."""
    db.add(
        Transaction(
            user_id=ctx.user_id,
            type=TransactionType.INVOICE_PAYMENT,
            amount=Decimal(amount),
            occurred_on=TODAY,
            description="Pagamento da fatura",
            account_id=account.id,
            invoice_id=invoice.id,
            payment_group_id=uuid.uuid7(),
        )
    )
    db.flush()


def _by_month(totals: list[card_ledger.InvoiceTotals]) -> dict[date, card_ledger.InvoiceTotals]:
    return {t.invoice.reference_month: t for t in totals}


def test_open_invoice_total_sums_its_purchases(db: Session, ctx: RequestContext) -> None:
    card = _card(db, ctx)
    _buy(db, ctx, card, "38.00", TODAY)
    _buy(db, ctx, card, "142.30", date(2026, 10, 10))
    november = _by_month(card_ledger.invoice_totals(db, card, TODAY))[date(2026, 11, 1)]
    assert november.state is InvoiceState.OPEN
    assert november.total == Decimal("180.30")
    assert november.balance == Decimal("180.30")


def test_future_invoices_list_installments(db: Session, ctx: RequestContext) -> None:
    card = _card(db, ctx)
    _buy(db, ctx, card, "1200.00", TODAY, installments=6)
    summary = card_ledger.card_summary(db, card, TODAY)
    assert summary.open_invoice is not None
    assert summary.open_invoice.total == Decimal("200.00")
    assert [(f.invoice.reference_month, f.total) for f in summary.future] == [
        (date(2026, 12, 1), Decimal("200.00")),
        (date(2027, 1, 1), Decimal("200.00")),
        (date(2027, 2, 1), Decimal("200.00")),
        (date(2027, 3, 1), Decimal("200.00")),
        (date(2027, 4, 1), Decimal("200.00")),
    ]
    assert all(f.state is InvoiceState.FUTURE for f in summary.future)


def test_limit_counts_all_future_installments(db: Session, ctx: RequestContext) -> None:
    card = _card(db, ctx)
    _buy(db, ctx, card, "1200.00", TODAY, installments=6)
    limit = card_ledger.limit_status(db, card, TODAY)
    assert (limit.limit, limit.used, limit.available) == (
        Decimal("11000.00"),
        Decimal("1200.00"),
        Decimal("9800.00"),
    )


def test_paid_invoice_releases_limit(db: Session, ctx: RequestContext) -> None:
    card = _card(db, ctx)
    account = make_account(db, ctx)
    _buy(db, ctx, card, "500.00", date(2026, 9, 20))
    _pay(db, ctx, account, _invoice(db, card, date(2026, 10, 1)), "500.00")
    assert card_ledger.limit_status(db, card, TODAY).used == Decimal("0.00")


def test_invoice_states_by_date(db: Session, ctx: RequestContext) -> None:
    card = _card(db, ctx)
    account = make_account(db, ctx)
    _buy(db, ctx, card, "100.00", date(2026, 9, 2))  # setembro: fechou em 3/9
    _buy(db, ctx, card, "200.00", date(2026, 9, 20))  # outubro: fechou em 3/10
    _buy(db, ctx, card, "300.00", TODAY, installments=2)  # novembro (aberta) e dezembro
    _pay(db, ctx, account, _invoice(db, card, date(2026, 9, 1)), "100.00")
    states = {
        month: t.state
        for month, t in _by_month(card_ledger.invoice_totals(db, card, TODAY)).items()
    }
    assert states == {
        date(2026, 9, 1): InvoiceState.PAID,
        date(2026, 10, 1): InvoiceState.CLOSED,
        date(2026, 11, 1): InvoiceState.OPEN,
        date(2026, 12, 1): InvoiceState.FUTURE,
    }
    summary = card_ledger.card_summary(db, card, TODAY)
    assert summary.payable is not None
    assert summary.payable.invoice.reference_month == date(2026, 10, 1)
    assert summary.payable.balance == Decimal("200.00")


def test_credit_balance_carries_into_next_invoice(db: Session, ctx: RequestContext) -> None:
    card = _card(db, ctx)
    _buy(db, ctx, card, "100.00", date(2026, 9, 20))
    _buy(db, ctx, card, "38.00", TODAY)
    october = _invoice(db, card, date(2026, 10, 1))
    invoices.add_item(
        db,
        ctx,
        october,
        kind=InvoiceItemKind.REFUND_CREDIT,
        direction=ItemDirection.CREDIT,
        amount=Decimal("150.00"),
    )
    totals = _by_month(card_ledger.invoice_totals(db, card, TODAY))
    assert totals[date(2026, 10, 1)].state is InvoiceState.PAID
    assert totals[date(2026, 10, 1)].balance == Decimal("0.00")
    assert totals[date(2026, 11, 1)].credit_from_previous == Decimal("50.00")
    assert totals[date(2026, 11, 1)].balance == Decimal("-12.00")
    assert card_ledger.limit_status(db, card, TODAY).used == Decimal("0.00")


def test_preview_shows_before_and_after_for_each_affected_invoice(
    db: Session, ctx: RequestContext
) -> None:
    card = _card(
        db,
        ctx,
        opening_date=TODAY,
        opening=OpeningState(open_invoice_total=Decimal("1240.00")),
    )
    # Parcelada em andamento: a última parcela, de R$ 3.000, cai em dezembro.
    _buy(db, ctx, card, "6000.00", date(2026, 9, 1), installments=2, remaining_installments=1)
    preview = card_ledger.preview_purchase(
        db, card, amount=Decimal("1200.00"), installments=6, occurred_on=TODAY, today=TODAY
    )
    assert (preview.invoice.reference_month, preview.invoice.before, preview.invoice.after) == (
        date(2026, 11, 1),
        Decimal("1240.00"),
        Decimal("1440.00"),
    )
    assert [(i.reference_month, i.before, i.after) for i in preview.following[:2]] == [
        (date(2026, 12, 1), Decimal("3000.00"), Decimal("3200.00")),
        (date(2027, 1, 1), Decimal("0.00"), Decimal("200.00")),
    ]
    assert len(preview.following) == 5
    assert (preview.limit_before, preview.limit_after) == (Decimal("6760.00"), Decimal("5560.00"))
    # Nada foi gravado.
    assert card_ledger.limit_status(db, card, TODAY).available == Decimal("6760.00")


def test_preview_of_cash_purchase_has_no_following(db: Session, ctx: RequestContext) -> None:
    card = _card(db, ctx)
    preview = card_ledger.preview_purchase(
        db, card, amount=Decimal("38.00"), installments=None, occurred_on=TODAY, today=TODAY
    )
    assert (preview.invoice.before, preview.invoice.after) == (Decimal("0.00"), Decimal("38.00"))
    assert preview.following == []


@pytest.mark.parametrize(
    ("limit", "codes"), [("1000.00", ["credit_limit_exceeded"]), ("5000.00", [])]
)
def test_purchase_over_limit_returns_a_notice(
    db: Session, ctx: RequestContext, limit: str, codes: list[str]
) -> None:
    card = _card(db, ctx, credit_limit=Decimal(limit))
    data = NewCardExpense(
        amount=Decimal("1200.00"), occurred_on=TODAY, description="celular", card_id=card.id
    )
    result = transactions.create_transaction(db, ctx, data)
    assert [n.code for n in result.notices] == codes
    if codes:
        assert result.notices[0].detail == "O limite do cartão Nubank ficou negativo em R$ 200,00."


def _edit_dates(
    db: Session, ctx: RequestContext, card: Card, month: date, closing: date, due: date
) -> None:
    invoice = invoices.get_or_create_invoice(db, card, month)
    invoices.update_invoice(db, ctx, invoice.id, {"closing_date": closing, "due_date": due})


def test_purchase_follows_an_edited_later_closing(db: Session, ctx: RequestContext) -> None:
    """O banco adiou o fechamento de outubro para o dia 20: a compra do dia 15 ainda é dela."""
    card = _card(db, ctx)
    october = date(2026, 10, 1)
    _edit_dates(db, ctx, card, october, date(2026, 10, 20), date(2026, 10, 27))
    tx = _buy(db, ctx, card, "100.00", TODAY)
    item = db.scalars(select(InvoiceItem).where(InvoiceItem.transaction_id == tx.id)).one()
    assert item.invoice_id == _invoice(db, card, october).id
    assert card_ledger.open_invoice_month(db, card, TODAY) == october
    assert (
        _by_month(card_ledger.invoice_totals(db, card, TODAY))[october].state is InvoiceState.OPEN
    )
    preview = card_ledger.preview_purchase(
        db, card, amount=Decimal("10.00"), installments=None, occurred_on=TODAY, today=TODAY
    )
    assert preview.invoice.reference_month == october


def test_purchase_skips_an_edited_earlier_closing(db: Session, ctx: RequestContext) -> None:
    """O banco antecipou o fechamento de novembro para 14/10: a compra de 15/10 vai para dezembro."""
    card = _card(db, ctx)
    _edit_dates(db, ctx, card, date(2026, 11, 1), date(2026, 10, 14), date(2026, 11, 10))
    tx = _buy(db, ctx, card, "100.00", TODAY)
    item = db.scalars(select(InvoiceItem).where(InvoiceItem.transaction_id == tx.id)).one()
    assert item.invoice_id == _invoice(db, card, date(2026, 12, 1)).id
    assert card_ledger.open_invoice_month(db, card, TODAY) == date(2026, 12, 1)


def test_credit_reaches_the_open_invoice_even_without_purchases(
    db: Session, ctx: RequestContext
) -> None:
    """Outubro fechou com crédito de 50 e novembro ainda não tem compra: o crédito aparece nele."""
    card = _card(db, ctx)
    _buy(db, ctx, card, "100.00", date(2026, 9, 20))
    invoices.add_item(
        db,
        ctx,
        _invoice(db, card, date(2026, 10, 1)),
        kind=InvoiceItemKind.REFUND_CREDIT,
        direction=ItemDirection.CREDIT,
        amount=Decimal("150.00"),
    )
    summary = card_ledger.card_summary(db, card, TODAY)
    assert summary.open_invoice is not None
    assert summary.open_invoice.invoice.reference_month == date(2026, 11, 1)
    assert summary.open_invoice.credit_from_previous == Decimal("50.00")
    assert summary.open_invoice.total == Decimal("-50.00")
    assert summary.future == []
    assert db.scalars(select(Invoice).where(Invoice.card_id == card.id)).all() == [
        _invoice(db, card, date(2026, 10, 1))
    ]
