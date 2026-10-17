from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import (
    AuditAction,
    AuditLog,
    Card,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
)
from app.services import card_ledger, cards, invoices
from app.services.cards import OpeningState
from app.services.context import RequestContext
from tests.support import make_account

TODAY = date(2026, 10, 15)


def _create(db: Session, ctx: RequestContext, **overrides: object) -> Card:
    fields: dict[str, object] = {
        "name": "Nubank",
        "credit_limit": Decimal("11000.00"),
        "closing_day": 3,
        "due_day": 10,
        "opening_date": TODAY,
    }
    fields.update(overrides)
    return cards.create_card(db, ctx, **fields)  # type: ignore[arg-type]


def _invoices(db: Session, card: Card) -> list[Invoice]:
    return list(
        db.scalars(
            select(Invoice).where(Invoice.card_id == card.id).order_by(Invoice.reference_month)
        )
    )


def _items(db: Session, invoice: Invoice) -> list[InvoiceItem]:
    return list(db.scalars(select(InvoiceItem).where(InvoiceItem.invoice_id == invoice.id)))


def test_create_card_without_opening_state_creates_no_invoice(
    db: Session, ctx: RequestContext
) -> None:
    card = _create(db, ctx)
    assert card.credit_limit == Decimal("11000.00")
    assert _invoices(db, card) == []
    audit = db.scalars(select(AuditLog).where(AuditLog.entity_id == card.id)).one()
    assert audit.action is AuditAction.CREATE


def test_opening_open_invoice_total_becomes_an_opening_item(
    db: Session, ctx: RequestContext
) -> None:
    card = _create(db, ctx, opening=OpeningState(open_invoice_total=Decimal("1240.00")))
    [invoice] = _invoices(db, card)
    assert invoice.reference_month == date(2026, 11, 1)
    assert (invoice.closing_date, invoice.due_date) == (date(2026, 11, 3), date(2026, 11, 10))
    [item] = _items(db, invoice)
    assert item.kind is InvoiceItemKind.OPENING_BALANCE
    assert item.direction is ItemDirection.DEBIT
    assert item.amount == Decimal("1240.00")


def test_opening_closed_invoice_uses_the_previous_month(db: Session, ctx: RequestContext) -> None:
    card = _create(
        db,
        ctx,
        opening=OpeningState(
            open_invoice_total=Decimal("1240.00"), closed_invoice_total=Decimal("2380.00")
        ),
    )
    closed, opened = _invoices(db, card)
    assert closed.reference_month == date(2026, 10, 1)
    assert closed.closing_date == date(2026, 10, 3)
    assert [i.amount for i in _items(db, closed)] == [Decimal("2380.00")]
    assert opened.reference_month == date(2026, 11, 1)


def test_closed_invoice_due_date_informed_is_kept(db: Session, ctx: RequestContext) -> None:
    card = _create(
        db,
        ctx,
        opening=OpeningState(
            closed_invoice_total=Decimal("2380.00"), closed_invoice_due_date=date(2026, 10, 13)
        ),
    )
    [closed] = _invoices(db, card)
    assert closed.due_date == date(2026, 10, 13)
    assert closed.dates_edited is True


def test_same_name_as_an_account_is_allowed(db: Session, ctx: RequestContext) -> None:
    make_account(db, ctx, name="Nubank")
    assert _create(db, ctx).name == "Nubank"


def test_duplicate_card_name_is_rejected(db: Session, ctx: RequestContext) -> None:
    _create(db, ctx)
    with pytest.raises(Conflict) as error:
        _create(db, ctx)
    assert error.value.code == "name_already_exists"


def test_changing_closing_day_moves_open_invoice_dates_but_not_closed_ones(
    db: Session, ctx: RequestContext
) -> None:
    card = _create(
        db,
        ctx,
        opening=OpeningState(
            open_invoice_total=Decimal("100.00"), closed_invoice_total=Decimal("200.00")
        ),
    )
    cards.update_card(db, ctx, card.id, {"closing_day": 5, "due_day": 12})
    closed, opened = _invoices(db, card)
    assert (closed.closing_date, closed.due_date) == (date(2026, 10, 3), date(2026, 10, 10))
    assert (opened.closing_date, opened.due_date) == (date(2026, 11, 5), date(2026, 11, 12))
    assert (card.closing_day, card.due_day) == (5, 12)


def test_edited_invoice_dates_survive_a_change_of_closing_day(
    db: Session, ctx: RequestContext
) -> None:
    card = _create(db, ctx, opening=OpeningState(open_invoice_total=Decimal("100.00")))
    [opened] = _invoices(db, card)
    opened.closing_date, opened.due_date, opened.dates_edited = (
        date(2026, 11, 4),
        date(2026, 11, 11),
        True,
    )
    cards.update_card(db, ctx, card.id, {"closing_day": 5})
    assert (opened.closing_date, opened.due_date) == (date(2026, 11, 4), date(2026, 11, 11))


def test_update_card_rejects_duplicate_name(db: Session, ctx: RequestContext) -> None:
    _create(db, ctx)
    other = _create(db, ctx, name="Inter")
    with pytest.raises(Conflict):
        cards.update_card(db, ctx, other.id, {"name": "Nubank"})


def test_get_or_create_invoice_is_idempotent(db: Session, ctx: RequestContext) -> None:
    card = _create(db, ctx)
    first = invoices.get_or_create_invoice(db, card, date(2026, 12, 1))
    second = invoices.get_or_create_invoice(db, card, date(2026, 12, 1))
    assert first.id == second.id
    assert (first.closing_date, first.due_date) == (date(2026, 12, 3), date(2026, 12, 10))


def test_archive_with_balance_returns_a_notice(db: Session, ctx: RequestContext) -> None:
    card = _create(db, ctx, opening=OpeningState(open_invoice_total=Decimal("1240.00")))
    result = cards.archive_card(db, ctx, card.id)
    assert card.archived_at is not None
    assert [n.code for n in result.notices] == ["archived_with_balance"]
    assert "R$ 1.240,00" in result.notices[0].detail


def test_archive_without_balance_has_no_notice(db: Session, ctx: RequestContext) -> None:
    card = _create(db, ctx)
    assert cards.archive_card(db, ctx, card.id).notices == []


def test_archived_card_is_not_active(db: Session, ctx: RequestContext) -> None:
    card = _create(db, ctx)
    cards.archive_card(db, ctx, card.id)
    with pytest.raises(RuleViolation) as error:
        cards.get_active_card(db, ctx, card.id)
    assert error.value.code == "card_archived"
    assert cards.list_cards(db, ctx) == []
    assert cards.list_cards(db, ctx, include_archived=True) == [card]


def test_other_user_cannot_see_the_card(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    card = _create(db, ctx)
    with pytest.raises(NotFound):
        cards.get_active_card(db, other_ctx, card.id)
    assert cards.list_cards(db, other_ctx) == []


def test_archived_card_name_can_be_reused(db: Session, ctx: RequestContext) -> None:
    """Trocou de cartão: arquiva o Nubank antigo e cadastra o novo com o mesmo nome."""
    old = _create(db, ctx)
    cards.archive_card(db, ctx, old.id)
    new = _create(db, ctx)
    db.flush()
    assert new.id != old.id
    with pytest.raises(Conflict):
        _create(db, ctx)


def _open_total(db: Session, card: Card) -> Decimal:
    summary = card_ledger.card_summary(db, card, TODAY)
    return summary.open_invoice.total if summary.open_invoice else Decimal("0.00")


def test_opening_total_can_be_informed_later_and_corrected(
    db: Session, ctx: RequestContext
) -> None:
    """Pulou o início no cadastro: informa depois; errou o valor: corrige sem somar duas vezes."""
    card = _create(db, ctx)
    cards.set_opening_total(db, ctx, card.id, Decimal("1240.00"))
    assert _open_total(db, card) == Decimal("1240.00")
    cards.set_opening_total(db, ctx, card.id, Decimal("1300.00"))
    assert _open_total(db, card) == Decimal("1300.00")
    cards.set_opening_total(db, ctx, card.id, Decimal("0.00"))
    assert _open_total(db, card) == Decimal("0.00")


def test_opening_total_is_fixed_once_its_invoice_closed(db: Session, ctx: RequestContext) -> None:
    card = _create(db, ctx, opening_date=date(2026, 9, 1))
    with pytest.raises(RuleViolation) as error:
        cards.set_opening_total(db, ctx, card.id, Decimal("100.00"))
    assert error.value.code == "opening_invoice_closed"


def test_unarchive_restores_the_card(db: Session, ctx: RequestContext) -> None:
    card = _create(db, ctx)
    cards.archive_card(db, ctx, card.id)
    assert cards.unarchive_card(db, ctx, card.id).archived_at is None
    assert [c.id for c in cards.list_cards(db, ctx)] == [card.id]


def test_unarchive_refuses_a_name_already_in_use(db: Session, ctx: RequestContext) -> None:
    """Arquivou o Nubank antigo e criou outro Nubank: o antigo não volta com o mesmo nome."""
    old = _create(db, ctx)
    cards.archive_card(db, ctx, old.id)
    _create(db, ctx)
    with pytest.raises(Conflict) as error:
        cards.unarchive_card(db, ctx, old.id)
    assert error.value.code == "name_already_exists"
