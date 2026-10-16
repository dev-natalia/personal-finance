import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import RuleViolation
from app.models import (
    Account,
    Card,
    CategoryKind,
    Invoice,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.services import accounts, cards, ledger, transactions
from app.services.cards import OpeningState
from app.services.context import RequestContext
from app.services.transactions import NewCardExpense
from tests.support import find_category, insert_tx, make_account

INCOME, EXPENSE = TransactionType.INCOME, TransactionType.EXPENSE
TRANSFER, REFUND = TransactionType.TRANSFER, TransactionType.REFUND
PIX, DEBIT = PaymentMethod.PIX, PaymentMethod.DEBIT
AS_OF = date(2026, 10, 15)


def test_account_balance_combines_all_movement_types(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú", "1000.00")
    nubank = make_account(db, ctx, "Nubank", "0.00")
    mercado = find_category(db, ctx, "Mercado")
    salario = find_category(db, ctx, "Salário", CategoryKind.INCOME)

    insert_tx(db, ctx, type=INCOME, amount="3000.00", account=itau, category=salario)
    spent = insert_tx(
        db, ctx, type=EXPENSE, amount="200.00", account=itau, category=mercado, payment_method=PIX
    )
    insert_tx(db, ctx, type=REFUND, amount="50.00", account=itau, category=mercado, refund_of=spent)
    insert_tx(db, ctx, type=TRANSFER, amount="500.00", account=itau, destination=nubank)
    insert_tx(
        db,
        ctx,
        type=EXPENSE,
        amount="999.00",
        account=itau,
        category=mercado,
        payment_method=PIX,
        voided=True,
    )
    insert_tx(
        db,
        ctx,
        type=EXPENSE,
        amount="10.00",
        account=itau,
        category=mercado,
        payment_method=PIX,
        occurred_on=date(2026, 10, 20),
    )

    balances = ledger.account_balances(db, ctx.user_id, AS_OF)
    assert balances[itau.id] == Decimal("3350.00")  # 1000 + 3000 - 200 + 50 - 500
    assert balances[nubank.id] == Decimal("500.00")


def test_transfers_do_not_change_total(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú", "1000.00")
    nubank = make_account(db, ctx, "Nubank", "200.00")
    before = ledger.total_balance(db, ctx.user_id, AS_OF)
    insert_tx(db, ctx, type=TRANSFER, amount="300.00", account=itau, destination=nubank)
    assert ledger.total_balance(db, ctx.user_id, AS_OF) == before == Decimal("1200.00")


def test_account_opened_after_as_of_has_zero_balance(db: Session, ctx: RequestContext) -> None:
    future = make_account(db, ctx, "Nova", "500.00", opening_date=date(2026, 11, 1))
    assert ledger.account_balances(db, ctx.user_id, AS_OF)[future.id] == Decimal("0.00")


def test_month_summary_nets_refunds_and_ignores_other_types(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx, "Itaú", "1000.00")
    nubank = make_account(db, ctx, "Nubank", "0.00")
    mercado = find_category(db, ctx, "Mercado")
    saude = find_category(db, ctx, "Saúde")
    salario = find_category(db, ctx, "Salário", CategoryKind.INCOME)

    spent = insert_tx(
        db, ctx, type=EXPENSE, amount="200.00", account=itau, category=mercado, payment_method=PIX
    )
    insert_tx(db, ctx, type=REFUND, amount="50.00", account=itau, category=mercado, refund_of=spent)
    insert_tx(
        db, ctx, type=EXPENSE, amount="80.00", account=itau, category=saude, payment_method=DEBIT
    )
    insert_tx(db, ctx, type=TRANSFER, amount="500.00", account=itau, destination=nubank)
    insert_tx(db, ctx, type=INCOME, amount="3000.00", account=itau, category=salario)
    insert_tx(
        db,
        ctx,
        type=EXPENSE,
        amount="999.00",
        account=itau,
        category=mercado,
        payment_method=PIX,
        voided=True,
    )
    insert_tx(
        db,
        ctx,
        type=EXPENSE,
        amount="70.00",
        account=itau,
        category=mercado,
        payment_method=PIX,
        occurred_on=date(2026, 11, 2),
    )

    summary = ledger.month_summary(db, ctx.user_id, 2026, 10)
    assert {c.name: c.amount for c in summary.by_category} == {
        "Mercado": Decimal("150.00"),
        "Saúde": Decimal("80.00"),
    }
    assert summary.consumption_total == Decimal("230.00")
    assert summary.income == Decimal("3000.00")


def test_list_transactions_paginates_with_stable_cursor(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    mercado = find_category(db, ctx, "Mercado")
    created = [
        insert_tx(
            db,
            ctx,
            type=EXPENSE,
            amount="10.00",
            account=itau,
            category=mercado,
            payment_method=PIX,
            occurred_on=date(2026, 10, day),
        )
        for day in (1, 2, 3, 4, 5)
    ]
    seen = []
    cursor = None
    while True:
        page = ledger.list_transactions(
            db, ctx.user_id, ledger.TransactionFilters(), cursor=cursor, limit=2
        )
        seen += [t.id for t in page.items]
        if page.next_cursor is None:
            break
        cursor = page.next_cursor
    assert seen == [t.id for t in reversed(created)]


def test_list_filter_by_account_includes_incoming_transfers(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx, "Itaú")
    nubank = make_account(db, ctx, "Nubank")
    transfer = insert_tx(db, ctx, type=TRANSFER, amount="10.00", account=itau, destination=nubank)
    page = ledger.list_transactions(
        db, ctx.user_id, ledger.TransactionFilters(account_id=nubank.id)
    )
    assert [t.id for t in page.items] == [transfer.id]


def test_list_excludes_voided_by_default(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    mercado = find_category(db, ctx, "Mercado")
    insert_tx(
        db,
        ctx,
        type=EXPENSE,
        amount="10.00",
        account=itau,
        category=mercado,
        payment_method=PIX,
        voided=True,
    )
    assert ledger.list_transactions(db, ctx.user_id, ledger.TransactionFilters()).items == []
    everything = ledger.TransactionFilters(status=None)
    assert len(ledger.list_transactions(db, ctx.user_id, everything).items) == 1
    voided = ledger.TransactionFilters(status=TransactionStatus.VOIDED)
    assert len(ledger.list_transactions(db, ctx.user_id, voided).items) == 1


def test_invalid_cursor(db: Session, ctx: RequestContext) -> None:
    with pytest.raises(RuleViolation) as exc:
        ledger.list_transactions(db, ctx.user_id, ledger.TransactionFilters(), cursor="lixo!")
    assert exc.value.code == "invalid_cursor"


def test_possible_duplicates_window(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    saude = find_category(db, ctx, "Saúde")
    drogasil = Merchant(user_id=ctx.user_id, name="Drogasil", normalized_name="drogasil")
    db.add(drogasil)
    db.flush()
    original = insert_tx(
        db,
        ctx,
        type=EXPENSE,
        amount="42.00",
        account=itau,
        category=saude,
        payment_method=PIX,
        merchant=drogasil,
        occurred_on=date(2026, 10, 10),
    )

    def find(amount: str, day: int) -> list[Transaction]:
        return ledger.possible_duplicates(
            db,
            ctx.user_id,
            amount=Decimal(amount),
            merchant="DROGASIL",
            occurred_on=date(2026, 10, day),
        )

    assert [t.id for t in find("42.00", 12)] == [original.id]
    assert find("42.00", 13) == []
    assert find("43.00", 10) == []


def test_top_payment_options(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú")
    nubank = make_account(db, ctx, "Nubank")
    mercado = find_category(db, ctx, "Mercado")

    def spend(
        account: Account, method: PaymentMethod, times: int, day: date = date(2026, 10, 10)
    ) -> None:
        for _ in range(times):
            insert_tx(
                db,
                ctx,
                type=EXPENSE,
                amount="1.00",
                account=account,
                category=mercado,
                payment_method=method,
                occurred_on=day,
            )

    spend(itau, PIX, 3)
    spend(itau, DEBIT, 2)
    spend(nubank, DEBIT, 1)
    spend(nubank, PIX, 5, day=date(2026, 6, 1))  # fora da janela de 90 dias

    options = ledger.top_payment_options(db, ctx.user_id, AS_OF)
    assert [(o.account_name, o.payment_method) for o in options] == [
        ("Itaú", PIX),
        ("Itaú", DEBIT),
        ("Nubank", DEBIT),
    ]


def test_other_users_data_is_invisible(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    mine = make_account(db, ctx, "Itaú")
    theirs = make_account(db, other_ctx, "Itaú")
    salario = find_category(db, other_ctx, "Salário", CategoryKind.INCOME)
    insert_tx(db, other_ctx, type=INCOME, amount="100.00", account=theirs, category=salario)
    assert set(ledger.account_balances(db, ctx.user_id, AS_OF)) == {mine.id}
    assert ledger.list_transactions(db, ctx.user_id, ledger.TransactionFilters()).items == []


def test_archive_account_warns_when_balance_not_zero(db: Session, ctx: RequestContext) -> None:
    with_money = make_account(db, ctx, "Itaú", "100.00")
    empty = make_account(db, ctx, "Vazia", "0.00")
    [notice] = accounts.archive_account(db, ctx, with_money.id).notices
    assert notice.code == "archived_with_balance"
    assert "R$ 100,00" in notice.detail
    assert accounts.archive_account(db, ctx, empty.id).notices == []


# --- cartão no consumo e no caixa (subprojeto 2) ------------------------------------------------


def _nubank(db: Session, ctx: RequestContext, **extra: object) -> Card:
    return cards.create_card(
        db,
        ctx,
        name="Nubank",
        credit_limit=Decimal("11000.00"),
        closing_day=3,
        due_day=10,
        opening_date=date(2026, 9, 1),
        **extra,  # type: ignore[arg-type]
    )


def _card_buy(
    db: Session, ctx: RequestContext, card: Card, amount: str, on: date, **extra: object
) -> Transaction:
    data = NewCardExpense(
        amount=Decimal(amount),
        occurred_on=on,
        description="compra",
        card_id=card.id,
        category_id=find_category(db, ctx, "Mercado").id,
        **extra,  # type: ignore[arg-type]
    )
    return transactions.create_transaction(db, ctx, data).transaction


def _consumption(
    db: Session, ctx: RequestContext, month: int, year: int = 2026
) -> dict[str, Decimal]:
    summary = ledger.month_summary(db, ctx.user_id, year, month)
    return {c.name: c.amount for c in summary.by_category}


def test_card_purchase_counts_as_consumption_on_purchase_date(
    db: Session, ctx: RequestContext
) -> None:
    card = _nubank(db, ctx)
    _card_buy(db, ctx, card, "38.00", date(2026, 10, 15))
    assert _consumption(db, ctx, 10) == {"Mercado": Decimal("38.00")}
    assert _consumption(db, ctx, 11) == {}


def test_installment_counts_one_installment_per_month(db: Session, ctx: RequestContext) -> None:
    card = _nubank(db, ctx)
    _card_buy(db, ctx, card, "1200.00", date(2026, 10, 15), installments=6)
    assert _consumption(db, ctx, 10) == {"Mercado": Decimal("200.00")}
    assert _consumption(db, ctx, 11) == {"Mercado": Decimal("200.00")}
    assert _consumption(db, ctx, 3, 2027) == {"Mercado": Decimal("200.00")}
    assert _consumption(db, ctx, 4, 2027) == {}


def test_charge_counts_as_financial_charges(db: Session, ctx: RequestContext) -> None:
    card = _nubank(db, ctx)
    db.add(
        Transaction(
            user_id=ctx.user_id,
            type=TransactionType.CHARGE,
            amount=Decimal("15.00"),
            occurred_on=date(2026, 10, 12),
            description="IOF",
            card_id=card.id,
            category_id=find_category(db, ctx, "Encargos financeiros").id,
        )
    )
    db.flush()
    assert _consumption(db, ctx, 10) == {"Encargos financeiros": Decimal("15.00")}


def test_golden_rule_card_purchase_plus_invoice_payment_counts_once(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx, "Itaú", "1000.00", opening_date=date(2026, 9, 1))
    card = _nubank(db, ctx)
    _card_buy(db, ctx, card, "300.00", date(2026, 10, 15))
    november = db.scalars(select(Invoice).where(Invoice.card_id == card.id)).one()
    db.add(
        Transaction(
            user_id=ctx.user_id,
            type=TransactionType.INVOICE_PAYMENT,
            amount=Decimal("300.00"),
            occurred_on=date(2026, 11, 10),
            description="Pagamento da fatura de novembro",
            account_id=itau.id,
            invoice_id=november.id,
            payment_group_id=uuid.uuid7(),
        )
    )
    db.flush()
    assert ledger.month_summary(db, ctx.user_id, 2026, 10).consumption_total == Decimal("300.00")
    assert ledger.month_summary(db, ctx.user_id, 2026, 11).consumption_total == Decimal("0.00")
    balances = ledger.account_balances(db, ctx.user_id, date(2026, 11, 30))
    assert balances[itau.id] == Decimal("700.00")
    assert ledger.account_balances(db, ctx.user_id, date(2026, 10, 31))[itau.id] == Decimal(
        "1000.00"
    )


def test_opening_balance_is_not_consumption(db: Session, ctx: RequestContext) -> None:
    _nubank(
        db,
        ctx,
        opening=OpeningState(
            open_invoice_total=Decimal("1240.00"), closed_invoice_total=Decimal("2380.00")
        ),
    )
    assert _consumption(db, ctx, 9) == {}
    assert _consumption(db, ctx, 10) == {}
