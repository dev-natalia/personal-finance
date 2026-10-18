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
    PaymentMethod,
    Transaction,
)
from app.services import cards, ledger, transactions
from app.services.cards import OpeningState
from app.services.context import RequestContext
from app.services.transactions import NewCardExpense, NewCharge, NewExpense, NewRefund
from tests.support import make_account

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
        opening_date=date(2026, 10, 1),
    )


def _purchase(card: Card, **overrides: Any) -> NewCardExpense:
    fields: dict[str, Any] = {
        "amount": Decimal("38.00"),
        "occurred_on": date(2026, 10, 15),
        "description": "ifood",
        "card_id": card.id,
    }
    fields.update(overrides)
    return NewCardExpense(**fields)


def _billed(db: Session, tx: Transaction) -> list[tuple[date, Decimal, int | None, date | None]]:
    rows = db.execute(
        select(
            Invoice.reference_month,
            InvoiceItem.amount,
            InvoiceItem.installment_number,
            InvoiceItem.consumption_month,
        )
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(InvoiceItem.transaction_id == tx.id)
        .order_by(Invoice.reference_month)
    ).all()
    return [tuple(r) for r in rows]  # type: ignore[misc]


def test_card_purchase_creates_one_item_in_the_right_invoice(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    result = transactions.create_transaction(db, ctx, _purchase(card))
    tx = result.transaction
    assert (tx.account_id, tx.card_id, tx.payment_method) == (None, card.id, PaymentMethod.CREDIT)
    assert tx.category_id is not None
    assert _billed(db, tx) == [(date(2026, 11, 1), Decimal("38.00"), None, None)]


def test_installment_purchase_creates_one_item_per_invoice(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    tx = transactions.create_transaction(
        db, ctx, _purchase(card, amount=Decimal("1200.00"), description="celular", installments=6)
    ).transaction
    assert tx.installments == 6
    billed = _billed(db, tx)
    assert [b[0] for b in billed] == [
        date(2026, 11, 1),
        date(2026, 12, 1),
        date(2027, 1, 1),
        date(2027, 2, 1),
        date(2027, 3, 1),
        date(2027, 4, 1),
    ]
    assert {b[1] for b in billed} == {Decimal("200.00")}
    assert [b[2] for b in billed] == [1, 2, 3, 4, 5, 6]
    assert [b[3] for b in billed] == [
        date(2026, 10, 1),
        date(2026, 11, 1),
        date(2026, 12, 1),
        date(2027, 1, 1),
        date(2027, 2, 1),
        date(2027, 3, 1),
    ]


def test_installment_amounts_follow_a10(db: Session, ctx: RequestContext, card: Card) -> None:
    tx = transactions.create_transaction(
        db, ctx, _purchase(card, amount=Decimal("100.00"), installments=3)
    ).transaction
    assert [b[1] for b in _billed(db, tx)] == [
        Decimal("33.34"),
        Decimal("33.33"),
        Decimal("33.33"),
    ]


def test_opening_with_in_progress_installments_creates_only_the_remaining_ones(
    db: Session, ctx: RequestContext
) -> None:
    card = cards.create_card(
        db,
        ctx,
        name="Nubank",
        credit_limit=Decimal("11000.00"),
        closing_day=3,
        due_day=10,
        opening_date=TODAY,
        opening=OpeningState(open_invoice_total=Decimal("3000.00")),
    )
    tx = transactions.create_transaction(
        db,
        ctx,
        _purchase(
            card,
            amount=Decimal("1000.00"),
            occurred_on=date(2026, 7, 20),
            description="notebook",
            installments=10,
            remaining_installments=5,
        ),
    ).transaction
    billed = _billed(db, tx)
    # A parcela deste mês (a 5ª) já está no total da fatura aberta de novembro.
    assert [(b[0], b[2]) for b in billed] == [
        (date(2026, 12, 1), 6),
        (date(2027, 1, 1), 7),
        (date(2027, 2, 1), 8),
        (date(2027, 3, 1), 9),
        (date(2027, 4, 1), 10),
    ]
    assert {b[1] for b in billed} == {Decimal("100.00")}
    november = db.scalars(
        select(InvoiceItem)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(Invoice.card_id == card.id, Invoice.reference_month == date(2026, 11, 1))
    ).all()
    assert [i.kind for i in november] == [InvoiceItemKind.OPENING_BALANCE]


def test_purchase_before_card_opening_is_rejected(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    with pytest.raises(RuleViolation) as error:
        transactions.create_transaction(db, ctx, _purchase(card, occurred_on=date(2026, 9, 30)))
    assert error.value.code == "purchase_before_card_opening"
    # A mensagem leva ao lugar onde a parcelada antiga pode ser lançada.
    assert error.value.detail == (
        "Essa compra é de antes de o cartão entrar no app. Para uma parcelada que já vinha "
        "correndo, use o formulário completo: ele pergunta quantas parcelas faltam."
    )


def test_in_progress_purchase_after_opening_is_rejected(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    with pytest.raises(RuleViolation) as error:
        transactions.create_transaction(
            db, ctx, _purchase(card, installments=10, remaining_installments=5)
        )
    assert error.value.code == "in_progress_after_card_opening"


@pytest.mark.parametrize(
    ("installments", "remaining"), [(1, None), (25, None), (None, 3), (6, 6), (6, 0)]
)
def test_installments_out_of_range_are_rejected(
    db: Session, ctx: RequestContext, card: Card, installments: int | None, remaining: int | None
) -> None:
    with pytest.raises(RuleViolation) as error:
        transactions.create_transaction(
            db,
            ctx,
            _purchase(
                card,
                occurred_on=date(2026, 7, 20) if remaining else TODAY,
                installments=installments,
                remaining_installments=remaining,
            ),
        )
    assert error.value.code == "installments_out_of_range"


def test_archived_card_rejects_purchases(db: Session, ctx: RequestContext, card: Card) -> None:
    cards.archive_card(db, ctx, card.id)
    with pytest.raises(RuleViolation) as error:
        transactions.create_transaction(db, ctx, _purchase(card))
    assert error.value.code == "card_archived"


def test_card_purchase_does_not_change_account_balances(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    account = make_account(db, ctx)
    transactions.create_transaction(db, ctx, _purchase(card, amount=Decimal("500.00")))
    assert ledger.account_balances(db, ctx.user_id, TODAY)[account.id] == Decimal("1000.00")


def test_replayed_card_purchase_does_not_bill_twice(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    data = _purchase(card, amount=Decimal("600.00"), installments=3)
    first = transactions.create_transaction(db, ctx, data, idempotency_key="chave-cartao-1")
    second = transactions.create_transaction(db, ctx, data, idempotency_key="chave-cartao-1")
    assert second.replayed is True
    assert second.transaction.id == first.transaction.id
    assert len(_billed(db, first.transaction)) == 3


def test_top_payment_options_include_the_card(db: Session, ctx: RequestContext, card: Card) -> None:
    account = make_account(db, ctx)
    for _ in range(2):
        transactions.create_transaction(db, ctx, _purchase(card))
    transactions.create_transaction(
        db,
        ctx,
        NewExpense(
            amount=Decimal("10.00"),
            occurred_on=TODAY,
            description="padaria",
            account_id=account.id,
            payment_method=PaymentMethod.PIX,
        ),
    )
    options = ledger.top_payment_options(db, ctx.user_id, TODAY)
    assert [(o.name, o.card_id, o.account_id, o.payment_method) for o in options] == [
        ("Nubank", card.id, None, PaymentMethod.CREDIT),
        ("Itaú", None, account.id, PaymentMethod.PIX),
    ]


def test_changing_closing_day_moves_cash_purchases_but_never_into_a_closed_invoice(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    recent = transactions.create_transaction(
        db, ctx, _purchase(card, occurred_on=date(2026, 10, 15))
    ).transaction
    older = transactions.create_transaction(
        db, ctx, _purchase(card, occurred_on=date(2026, 10, 5))
    ).transaction
    # Fechando no dia 20: a compra de 15/10 passa para a fatura que fecha em 20/10 (outubro);
    # a de 05/10 também cairia em outubro, que segue aberta até 20/10.
    cards.update_card(db, ctx, card.id, {"closing_day": 20, "due_day": 27})
    assert _billed(db, recent)[0][0] == date(2026, 10, 1)
    assert _billed(db, older)[0][0] == date(2026, 10, 1)
    # Fechando no dia 12: outubro já fechou em 12/10; a compra de 05/10 não volta para ela.
    cards.update_card(db, ctx, card.id, {"closing_day": 12, "due_day": 19})
    assert _billed(db, older)[0][0] == date(2026, 11, 1)


def test_changing_closing_day_also_moves_charges_and_refund_credits(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    """Encargos e créditos de estorno seguem o novo ciclo como as compras à vista."""
    purchase = transactions.create_transaction(
        db, ctx, _purchase(card, occurred_on=date(2026, 10, 15))
    ).transaction
    charge = transactions.create_transaction(
        db,
        ctx,
        NewCharge(
            amount=Decimal("15.00"),
            occurred_on=date(2026, 10, 15),
            description="IOF",
            card_id=card.id,
        ),
    ).transaction
    refund = transactions.create_refund(
        db, ctx, purchase.id, NewRefund(amount=Decimal("10.00"), occurred_on=date(2026, 10, 15))
    ).transaction
    assert _billed(db, charge)[0][0] == date(2026, 11, 1)
    assert _billed(db, refund)[0][0] == date(2026, 11, 1)
    cards.update_card(db, ctx, card.id, {"closing_day": 20, "due_day": 27})
    assert _billed(db, purchase)[0][0] == date(2026, 10, 1)
    assert _billed(db, charge)[0][0] == date(2026, 10, 1)
    assert _billed(db, refund)[0][0] == date(2026, 10, 1)
