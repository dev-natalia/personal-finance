"""Serviço da análise: resumo por categoria, lugar e dia."""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.domain.errors import NotFound
from app.domain.periods import PeriodKind, period_containing
from app.models import Account, Card, PaymentMethod
from app.services import analysis, card_ledger, cards, invoice_payments, transactions
from app.services.analysis import CategoryTotal, DayTotal, PlaceTotal
from app.services.context import RequestContext
from app.services.invoice_payments import NewInvoicePayment, PaymentSource
from app.services.ledger import Source, SpendingMode
from app.services.transactions import NewCardExpense, NewExpense
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)
OCTOBER = period_containing(PeriodKind.MONTH, TODAY, TODAY)
D = Decimal


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


def _spend(
    db: Session,
    ctx: RequestContext,
    account: Account,
    amount: str,
    description: str,
    category: str,
    on: date = TODAY,
) -> None:
    data = NewExpense(
        amount=Decimal(amount),
        occurred_on=on,
        description=description,
        account_id=account.id,
        payment_method=PaymentMethod.PIX,
        category_id=find_category(db, ctx, category).id,
    )
    transactions.create_transaction(db, ctx, data)


def _summary(db: Session, ctx: RequestContext, **kw: Any) -> analysis.AnalysisSummary:
    fields: dict[str, Any] = {
        "period": OCTOBER,
        "mode": SpendingMode.INSTALLMENTS,
        "source": None,
        "category_id": None,
    }
    fields.update(kw)
    return analysis.summary(db, ctx.user_id, **fields)


def _places(summary: analysis.AnalysisSummary) -> list[tuple[str, Decimal, int, str | None]]:
    return [(p.name, p.amount, p.purchases, p.category_name) for p in summary.by_place]


def test_summary_of_october_by_category_and_place(
    db: Session, ctx: RequestContext, itau: Account
) -> None:
    for amount, day in (("30.00", 3), ("40.00", 9), ("20.50", 15)):
        _spend(db, ctx, itau, amount, "iFood", "Alimentação", on=date(2026, 10, day))
    _spend(db, ctx, itau, "120.00", "Mercado Livre", "Compras diversas", on=date(2026, 10, 9))
    _spend(db, ctx, itau, "60.00", "Pão de Açúcar", "Mercado", on=date(2026, 10, 3))
    result = _summary(db, ctx)
    assert result.total == D("270.50")
    assert [(c.name, c.amount) for c in result.by_category] == [
        ("Compras diversas", D("120.00")),
        ("Alimentação", D("90.50")),
        ("Mercado", D("60.00")),
    ]
    assert _places(result) == [
        ("Mercado Livre", D("120.00"), 1, "Compras diversas"),
        ("iFood", D("90.50"), 3, "Alimentação"),
        ("Pão de Açúcar", D("60.00"), 1, "Mercado"),
    ]
    assert result.by_day == [
        DayTotal(date(2026, 10, 3), D("90.00")),
        DayTotal(date(2026, 10, 9), D("160.00")),
        DayTotal(date(2026, 10, 15), D("20.50")),
    ]
    assert result.busiest == DayTotal(date(2026, 10, 9), D("160.00"))


def test_sixth_category_goes_to_outras(db: Session, ctx: RequestContext, itau: Account) -> None:
    names = ["Alimentação", "Mercado", "Saúde", "Transporte", "Lazer", "Pets", "Educação"]
    for name, amount in zip(names, ("70", "60", "50", "40", "30", "20", "10"), strict=True):
        _spend(db, ctx, itau, amount, name.lower(), name)
    result = _summary(db, ctx)
    assert [(c.name, c.amount) for c in result.by_category] == [
        ("Alimentação", D("70.00")),
        ("Mercado", D("60.00")),
        ("Saúde", D("50.00")),
        ("Transporte", D("40.00")),
        ("Lazer", D("30.00")),
        ("Outras", D("30.00")),
    ]
    assert result.by_category[-1] == CategoryTotal(None, "Outras", D("30.00"))


def test_category_filter_keeps_the_donut_whole(
    db: Session, ctx: RequestContext, itau: Account
) -> None:
    _spend(db, ctx, itau, "30.00", "iFood", "Alimentação")
    _spend(db, ctx, itau, "60.00", "Pão de Açúcar", "Mercado", on=date(2026, 10, 3))
    food = find_category(db, ctx, "Alimentação")
    result = _summary(db, ctx, category_id=food.id)
    assert result.total == D("90.00")
    assert len(result.by_category) == 2
    assert _places(result) == [("iFood", D("30.00"), 1, "Alimentação")]
    assert result.by_day == [DayTotal(TODAY, D("30.00"))]


def test_place_without_merchant_is_grouped_by_description(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    for amount in ("5.00", "7.00"):
        invoice_payments.add_charge(
            db, ctx, nubank.id, amount=D(amount), occurred_on=TODAY, description="IOF"
        )
    [place] = _summary(db, ctx).by_place
    assert (place.key, place.name, place.amount, place.purchases) == ("d:iof", "IOF", D("12.00"), 2)


def test_installment_counts_as_a_purchase_in_each_month(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    data = NewCardExpense(
        amount=D("1200.00"),
        occurred_on=TODAY,
        description="celular",
        card_id=nubank.id,
        installments=6,
    )
    transactions.create_transaction(db, ctx, data)
    november = period_containing(PeriodKind.MONTH, date(2026, 11, 1), TODAY)
    [place] = _summary(db, ctx, period=november).by_place
    assert (place.amount, place.purchases) == (D("200.00"), 1)
    [whole] = _summary(db, ctx, mode=SpendingMode.PURCHASE).by_place
    assert (whole.amount, whole.purchases) == (D("1200.00"), 1)


def test_year_groups_by_month(db: Session, ctx: RequestContext, itau: Account) -> None:
    _spend(db, ctx, itau, "30.00", "iFood", "Alimentação", on=date(2026, 9, 20))
    _spend(db, ctx, itau, "50.00", "iFood", "Alimentação")
    year = period_containing(PeriodKind.YEAR, TODAY, TODAY)
    result = _summary(db, ctx, period=year)
    assert result.by_day == [
        DayTotal(date(2026, 9, 1), D("30.00")),
        DayTotal(date(2026, 10, 1), D("50.00")),
    ]
    assert result.busiest == DayTotal(date(2026, 10, 1), D("50.00"))


def test_empty_period_has_zero_total_and_no_rows(db: Session, ctx: RequestContext) -> None:
    result = _summary(db, ctx)
    assert (result.total, result.by_category, result.by_place, result.by_day, result.busiest) == (
        D("0.00"),
        [],
        [],
        [],
        None,
    )


def test_archived_card_spending_still_counts(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    data = NewCardExpense(
        amount=D("80.00"), occurred_on=TODAY, description="farmácia", card_id=nubank.id
    )
    transactions.create_transaction(db, ctx, data)
    cards.archive_card(db, ctx, nubank.id)
    assert _summary(db, ctx).total == D("80.00")
    assert _summary(db, ctx, source=Source("card", nubank.id)).total == D("80.00")


def test_place_list_is_ordered_and_typed(db: Session, ctx: RequestContext, itau: Account) -> None:
    _spend(db, ctx, itau, "10.00", "Uber", "Transporte")
    [place] = _summary(db, ctx).by_place
    assert isinstance(place, PlaceTotal)
    assert place.key.startswith("m:")


def _card_buy(db: Session, ctx: RequestContext, card: Card, amount: str, **extra: Any) -> Any:
    data = NewCardExpense(
        amount=D(amount), occurred_on=TODAY, description="iFood", card_id=card.id, **extra
    )
    return transactions.create_transaction(db, ctx, data).transaction


def _key(db: Session, ctx: RequestContext, name: str) -> str:
    year = period_containing(PeriodKind.YEAR, TODAY, TODAY)
    places = _summary(db, ctx, period=year).by_place
    return next(p.key for p in places if p.name == name)


def test_day_spending_shows_the_installment_amount_on_its_day(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    tx = _card_buy(db, ctx, nubank, "1200.00", installments=6)
    [item] = analysis.day_spending(
        db,
        ctx.user_id,
        date(2026, 11, 15),
        mode=SpendingMode.INSTALLMENTS,
        source=None,
        category_id=None,
    )
    assert (item.transaction.id, item.amount) == (tx.id, D("200.00"))
    [whole] = analysis.day_spending(
        db, ctx.user_id, TODAY, mode=SpendingMode.PURCHASE, source=None, category_id=None
    )
    assert whole.amount == D("1200.00")


def test_place_detail_has_current_week_month_and_year(
    db: Session, ctx: RequestContext, itau: Account
) -> None:
    _spend(db, ctx, itau, "40.00", "iFood", "Alimentação")
    _spend(db, ctx, itau, "30.00", "iFood", "Alimentação", on=date(2026, 10, 9))
    _spend(db, ctx, itau, "20.00", "iFood", "Alimentação", on=date(2026, 9, 20))
    detail = analysis.place_detail(
        db,
        ctx.user_id,
        _key(db, ctx, "iFood"),
        mode=SpendingMode.INSTALLMENTS,
        source=None,
        today=TODAY,
    )
    assert (detail.name, detail.category_name) == ("iFood", "Alimentação")
    assert (detail.week.amount, detail.week.purchases) == (D("40.00"), 1)
    assert (detail.month.amount, detail.month.purchases) == (D("70.00"), 2)
    assert (detail.year.amount, detail.year.purchases) == (D("90.00"), 3)
    assert detail.average == D("30.00")


def test_average_uses_registered_purchase_value(
    db: Session, ctx: RequestContext, nubank: Card
) -> None:
    _card_buy(db, ctx, nubank, "1200.00", installments=6)
    detail = analysis.place_detail(
        db,
        ctx.user_id,
        _key(db, ctx, "iFood"),
        mode=SpendingMode.INSTALLMENTS,
        source=None,
        today=TODAY,
    )
    assert detail.month.amount == D("200.00")
    assert detail.average == D("1200.00")


def test_unknown_place_is_not_found(db: Session, ctx: RequestContext) -> None:
    for key in ("m:01a14652-6c04-709a-80f8-0888f0e853a1", "d:nada", "x:qualquer"):
        with pytest.raises(NotFound):
            analysis.place_detail(
                db, ctx.user_id, key, mode=SpendingMode.INSTALLMENTS, source=None, today=TODAY
            )


def test_day_and_place_lists_skip_voided_and_invoice_payments(
    db: Session, ctx: RequestContext, itau: Account, nubank: Card
) -> None:
    _spend(db, ctx, itau, "40.00", "iFood", "Alimentação")
    voided = transactions.create_transaction(
        db,
        ctx,
        NewExpense(
            amount=D("99.00"),
            occurred_on=TODAY,
            description="iFood",
            account_id=itau.id,
            payment_method=PaymentMethod.PIX,
        ),
    ).transaction
    transactions.void_transaction(db, ctx, voided.id)
    _card_buy(db, ctx, nubank, "50.00")
    october = next(
        t.invoice
        for t in card_ledger.invoice_totals(db, nubank, TODAY)
        if t.invoice.reference_month == date(2026, 11, 1)
    )
    invoice_payments.pay_invoice(
        db,
        ctx,
        october.id,
        NewInvoicePayment(
            occurred_on=TODAY, sources=(PaymentSource(itau.id, D("50.00")),), remainder="NONE"
        ),
    )
    day = analysis.day_spending(
        db, ctx.user_id, TODAY, mode=SpendingMode.INSTALLMENTS, source=None, category_id=None
    )
    assert sorted(i.amount for i in day) == [D("40.00"), D("50.00")]
    page = analysis.place_transactions(
        db, ctx.user_id, _key(db, ctx, "iFood"), source=None, cursor=None
    )
    assert sorted(t.amount for t in page.items) == [D("40.00"), D("50.00")]


def test_place_transactions_filter_by_source(
    db: Session, ctx: RequestContext, itau: Account, nubank: Card
) -> None:
    _spend(db, ctx, itau, "40.00", "iFood", "Alimentação")
    card_tx = _card_buy(db, ctx, nubank, "50.00")
    key = _key(db, ctx, "iFood")
    page = analysis.place_transactions(
        db, ctx.user_id, key, source=Source("card", nubank.id), cursor=None
    )
    assert [t.id for t in page.items] == [card_tx.id]
    described = analysis.place_transactions(db, ctx.user_id, "d:iof", source=None, cursor=None)
    assert described.items == []
