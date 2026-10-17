from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import (
    Account,
    Card,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
    ItemStatus,
    TransactionStatus,
    TransactionType,
)
from app.services import card_ledger, cards, invoices, ledger, transactions
from app.services.card_ledger import InvoiceState
from app.services.context import RequestContext
from app.services.invoice_payments import (
    InstallmentPlan,
    NewInvoicePayment,
    PaymentSource,
    add_charge,
    pay_invoice,
    void_payment_group,
)
from app.services.transactions import NewCardExpense
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)
OCTOBER = date(2026, 10, 1)


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


@pytest.fixture
def itau(db: Session, ctx: RequestContext) -> Account:
    return make_account(db, ctx, "Itaú", "5000.00", opening_date=date(2026, 9, 1))


@pytest.fixture
def savings(db: Session, ctx: RequestContext) -> Account:
    return make_account(db, ctx, "Poupança", "1000.00", opening_date=date(2026, 9, 1))


def _buy(
    db: Session, ctx: RequestContext, card: Card, amount: str, on: date, **extra: object
) -> None:
    data = NewCardExpense(
        amount=Decimal(amount),
        occurred_on=on,
        description="compra",
        card_id=card.id,
        **extra,  # type: ignore[arg-type]
    )
    transactions.create_transaction(db, ctx, data)


def _invoice(db: Session, card: Card, month: date) -> Invoice:
    return db.scalars(
        select(Invoice).where(Invoice.card_id == card.id, Invoice.reference_month == month)
    ).one()


def _totals(db: Session, card: Card, month: date) -> card_ledger.InvoiceTotals:
    return next(
        t for t in card_ledger.invoice_totals(db, card, TODAY) if t.invoice.reference_month == month
    )


def _pay(*sources: tuple[Account, str], remainder: object = "NONE") -> NewInvoicePayment:
    return NewInvoicePayment(
        occurred_on=TODAY,
        sources=tuple(PaymentSource(a.id, Decimal(v)) for a, v in sources),
        remainder=remainder,  # type: ignore[arg-type]
    )


def _balance(db: Session, ctx: RequestContext, account: Account) -> Decimal:
    return ledger.account_balances(db, ctx.user_id, TODAY)[account.id]


def _items(db: Session, kind: InvoiceItemKind) -> list[tuple[date, Decimal, ItemStatus]]:
    rows = db.execute(
        select(Invoice.reference_month, InvoiceItem.amount, InvoiceItem.status)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(InvoiceItem.kind == kind)
        .order_by(Invoice.reference_month)
    ).all()
    return [tuple(r) for r in rows]  # type: ignore[misc]


def test_full_payment_from_one_account_marks_invoice_paid(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    result = pay_invoice(db, ctx, _invoice(db, card, OCTOBER).id, _pay((itau, "300.00")))
    [payment] = result.payments
    assert payment.type is TransactionType.INVOICE_PAYMENT
    assert payment.description == "Pagamento da fatura de outubro (Nubank)"
    assert result.charge is None
    assert _totals(db, card, OCTOBER).state is InvoiceState.PAID
    assert _balance(db, ctx, itau) == Decimal("4700.00")


def test_payment_split_between_two_accounts(
    db: Session, ctx: RequestContext, card: Card, itau: Account, savings: Account
) -> None:
    _buy(db, ctx, card, "2200.00", date(2026, 9, 20))
    result = pay_invoice(
        db,
        ctx,
        _invoice(db, card, OCTOBER).id,
        _pay((itau, "2000.00"), (savings, "200.00")),
    )
    assert len(result.payments) == 2
    assert {p.payment_group_id for p in result.payments} == {result.group_id}
    assert _totals(db, card, OCTOBER).state is InvoiceState.PAID
    assert (_balance(db, ctx, itau), _balance(db, ctx, savings)) == (
        Decimal("3000.00"),
        Decimal("800.00"),
    )


def test_payment_replay_returns_the_same_group(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    invoice_id = _invoice(db, card, OCTOBER).id
    data = _pay((itau, "300.00"))
    first = pay_invoice(db, ctx, invoice_id, data, idempotency_key="pagamento-001")
    again = pay_invoice(db, ctx, invoice_id, data, idempotency_key="pagamento-001")
    assert again.replayed is True
    assert again.group_id == first.group_id
    assert [p.id for p in again.payments] == [p.id for p in first.payments]
    assert _balance(db, ctx, itau) == Decimal("4700.00")
    with pytest.raises(Conflict) as error:
        pay_invoice(db, ctx, invoice_id, _pay((itau, "100.00")), idempotency_key="pagamento-001")
    assert error.value.code == "idempotency_key_reused"


def test_payment_above_balance_is_rejected(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    with pytest.raises(RuleViolation) as error:
        pay_invoice(db, ctx, _invoice(db, card, OCTOBER).id, _pay((itau, "300.01")))
    assert error.value.code == "invoice_payment_exceeds_balance"
    assert error.value.detail == "O pagamento passa do saldo da fatura (R$ 300,00)."


def test_partial_payment_keeps_invoice_closed_with_balance(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    pay_invoice(db, ctx, _invoice(db, card, OCTOBER).id, _pay((itau, "100.00")))
    totals = _totals(db, card, OCTOBER)
    assert (totals.state, totals.balance) == (InvoiceState.CLOSED, Decimal("200.00"))


def test_carry_over_moves_remainder_to_next_invoice(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    pay_invoice(
        db, ctx, _invoice(db, card, OCTOBER).id, _pay((itau, "120.00"), remainder="CARRY_OVER")
    )
    assert _totals(db, card, OCTOBER).state is InvoiceState.PAID
    assert _items(db, InvoiceItemKind.CARRYOVER) == [
        (date(2026, 11, 1), Decimal("180.00"), ItemStatus.ACTIVE)
    ]
    assert card_ledger.limit_status(db, card, TODAY).used == Decimal("180.00")


def test_invoice_installments_create_items_and_a_charge(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    result = pay_invoice(
        db,
        ctx,
        _invoice(db, card, OCTOBER).id,
        _pay((itau, "120.00"), remainder=InstallmentPlan(3, Decimal("65.00"))),
    )
    assert _items(db, InvoiceItemKind.INVOICE_INSTALLMENT) == [
        (date(2026, 11, 1), Decimal("65.00"), ItemStatus.ACTIVE),
        (date(2026, 12, 1), Decimal("65.00"), ItemStatus.ACTIVE),
        (date(2027, 1, 1), Decimal("65.00"), ItemStatus.ACTIVE),
    ]
    assert result.charge is not None
    assert result.charge.amount == Decimal("15.00")
    assert result.charge.description == "Juros do parcelamento da fatura de outubro"
    assert result.charge.category_id == find_category(db, ctx, "Encargos financeiros").id
    assert _items(db, InvoiceItemKind.CHARGE) == []  # os juros já estão dentro das parcelas
    assert ledger.month_summary(db, ctx.user_id, 2026, 10).consumption_total == Decimal("15.00")
    assert _totals(db, card, OCTOBER).state is InvoiceState.PAID
    # Os juros estão nas parcelas, não saíram de outubro: nada de crédito falso em novembro.
    assert _totals(db, card, date(2026, 11, 1)).credit_from_previous == Decimal("0.00")
    assert card_ledger.limit_status(db, card, TODAY).used == Decimal("195.00")


def test_installments_below_remainder_are_rejected(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    with pytest.raises(RuleViolation) as error:
        pay_invoice(
            db,
            ctx,
            _invoice(db, card, OCTOBER).id,
            _pay((itau, "120.00"), remainder=InstallmentPlan(3, Decimal("59.99"))),
        )
    assert error.value.code == "invoice_installments_below_remainder"


def test_remainder_options_need_a_closed_invoice(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", TODAY)  # novembro, aberta
    with pytest.raises(RuleViolation) as error:
        pay_invoice(
            db,
            ctx,
            _invoice(db, card, date(2026, 11, 1)).id,
            _pay((itau, "100.00"), remainder="CARRY_OVER"),
        )
    assert error.value.code == "remainder_requires_closed_invoice"


def test_open_invoice_can_be_paid_in_advance(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", TODAY)
    pay_invoice(db, ctx, _invoice(db, card, date(2026, 11, 1)).id, _pay((itau, "100.00")))
    totals = _totals(db, card, date(2026, 11, 1))
    assert (totals.state, totals.balance) == (InvoiceState.OPEN, Decimal("200.00"))


def test_future_invoice_is_not_payable(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "600.00", TODAY, installments=2)  # novembro e dezembro
    with pytest.raises(RuleViolation) as error:
        pay_invoice(db, ctx, _invoice(db, card, date(2026, 12, 1)).id, _pay((itau, "100.00")))
    assert error.value.code == "invoice_not_payable"


def test_void_payment_group_restores_the_invoice(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    result = pay_invoice(
        db, ctx, _invoice(db, card, OCTOBER).id, _pay((itau, "120.00"), remainder="CARRY_OVER")
    )
    voided = void_payment_group(db, ctx, result.group_id)
    assert {t.status for t in voided} == {TransactionStatus.VOIDED}
    totals = _totals(db, card, OCTOBER)
    assert (totals.state, totals.balance) == (InvoiceState.CLOSED, Decimal("300.00"))
    assert _items(db, InvoiceItemKind.CARRYOVER) == [
        (date(2026, 11, 1), Decimal("180.00"), ItemStatus.CANCELLED)
    ]
    assert _balance(db, ctx, itau) == Decimal("5000.00")


def test_void_blocked_when_created_items_are_in_a_closed_invoice(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "100.00", date(2026, 9, 2))  # setembro
    september = _invoice(db, card, date(2026, 9, 1))
    # O saldo levado vai para outubro, que já fechou.
    result = pay_invoice(db, ctx, september.id, _pay((itau, "40.00"), remainder="CARRY_OVER"))
    with pytest.raises(RuleViolation) as error:
        void_payment_group(db, ctx, result.group_id)
    assert error.value.code == "void_blocked_by_closed_invoice"


def test_charge_adds_a_debit_to_the_invoice_of_its_date(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    result = add_charge(
        db,
        ctx,
        card.id,
        amount=Decimal("15.00"),
        occurred_on=TODAY,
        description="IOF",
        idempotency_key="encargo-001",
    )
    charge = result.transaction
    assert (charge.type, charge.card_id, charge.account_id) == (
        TransactionType.CHARGE,
        card.id,
        None,
    )
    assert charge.category_id == find_category(db, ctx, "Encargos financeiros").id
    assert _items(db, InvoiceItemKind.CHARGE) == [
        (date(2026, 11, 1), Decimal("15.00"), ItemStatus.ACTIVE)
    ]
    again = add_charge(
        db,
        ctx,
        card.id,
        amount=Decimal("15.00"),
        occurred_on=TODAY,
        description="IOF",
        idempotency_key="encargo-001",
    )
    assert again.replayed and again.transaction.id == charge.id


def test_reported_total_is_kept(db: Session, ctx: RequestContext, card: Card) -> None:
    _buy(db, ctx, card, "2300.00", date(2026, 9, 20))
    invoice = invoices.update_invoice(
        db, ctx, _invoice(db, card, OCTOBER).id, {"reported_total": Decimal("2380.00")}
    )
    assert invoice.reported_total == Decimal("2380.00")
    assert _totals(db, card, OCTOBER).total == Decimal("2300.00")
    invoices.update_invoice(db, ctx, invoice.id, {"reported_total": None})
    assert invoice.reported_total is None


def test_edited_dates_are_kept(db: Session, ctx: RequestContext, card: Card) -> None:
    _buy(db, ctx, card, "38.00", TODAY)
    november = _invoice(db, card, date(2026, 11, 1))
    invoices.update_invoice(
        db, ctx, november.id, {"closing_date": date(2026, 11, 4), "due_date": date(2026, 11, 11)}
    )
    assert (november.closing_date, november.due_date, november.dates_edited) == (
        date(2026, 11, 4),
        date(2026, 11, 11),
        True,
    )
    with pytest.raises(RuleViolation) as error:
        invoices.update_invoice(db, ctx, november.id, {"due_date": date(2026, 11, 2)})
    assert error.value.code == "due_before_closing"


def test_other_user_cannot_pay_the_invoice(
    db: Session, ctx: RequestContext, other_ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))

    with pytest.raises(NotFound):
        pay_invoice(db, other_ctx, _invoice(db, card, OCTOBER).id, _pay((itau, "300.00")))


def _adjustments(db: Session, card: Card, month: date) -> list[tuple[str, Decimal]]:
    totals = _totals(db, card, month)
    return [(a.description, a.amount) for a in card_ledger.invoice_adjustments(db, card, totals)]


def test_paid_invoice_explains_the_carried_remainder(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    pay_invoice(
        db, ctx, _invoice(db, card, OCTOBER).id, _pay((itau, "120.00"), remainder="CARRY_OVER")
    )
    assert _adjustments(db, card, OCTOBER) == [
        ("Levado para a fatura de novembro", Decimal("180.00"))
    ]


def test_paid_invoice_explains_the_installment_plan(
    db: Session, ctx: RequestContext, card: Card, itau: Account
) -> None:
    _buy(db, ctx, card, "300.00", date(2026, 9, 20))
    pay_invoice(
        db,
        ctx,
        _invoice(db, card, OCTOBER).id,
        _pay((itau, "120.00"), remainder=InstallmentPlan(3, Decimal("65.00"))),
    )
    # Sai de outubro o restante (180), não as parcelas com juros (195).
    assert _adjustments(db, card, OCTOBER) == [("Parcelado em 3x com o Nubank", Decimal("180.00"))]


def test_invoice_explains_the_credit_from_the_previous_one(
    db: Session, ctx: RequestContext, card: Card
) -> None:
    _buy(db, ctx, card, "100.00", date(2026, 9, 20))
    _buy(db, ctx, card, "38.00", TODAY)
    invoices.add_item(
        db,
        ctx,
        _invoice(db, card, OCTOBER),
        kind=InvoiceItemKind.REFUND_CREDIT,
        direction=ItemDirection.CREDIT,
        amount=Decimal("150.00"),
    )
    assert _adjustments(db, card, date(2026, 11, 1)) == [
        ("Crédito da fatura de outubro", Decimal("50.00"))
    ]
    assert _adjustments(db, card, OCTOBER) == []
