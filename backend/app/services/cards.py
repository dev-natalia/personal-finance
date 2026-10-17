"""Cartões: cadastro com o estado do primeiro dia, edição do ciclo e arquivamento."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.cards import add_months, invoice_dates
from app.domain.errors import Conflict, Notice, RuleViolation
from app.domain.money import format_brl, quantize
from app.models import (
    AuditAction,
    Card,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
    ItemStatus,
    Transaction,
)
from app.repositories import get_owned, owned_select
from app.services import card_ledger, invoices
from app.services.audit import record, snapshot
from app.services.context import RequestContext


@dataclass(frozen=True)
class OpeningState:
    """Como o cartão está no primeiro dia: totais que o banco mostra (decidido com a usuária).

    As parceladas que já corriam entram depois, uma a uma, como compras em andamento.
    """

    open_invoice_total: Decimal | None = None
    closed_invoice_total: Decimal | None = None
    closed_invoice_due_date: date | None = None


@dataclass(frozen=True)
class CardArchiveResult:
    card: Card
    notices: list[Notice] = field(default_factory=list)


def opening_invoice_month(session: Session, card: Card) -> date:
    """Mês da fatura aberta no início do cartão (a que contém `opening_date`)."""
    return invoices.invoice_month_on(session, card, card.opening_date)


def list_cards(
    session: Session, ctx: RequestContext, *, include_archived: bool = False
) -> list[Card]:
    stmt = owned_select(Card, ctx.user_id).order_by(Card.name)
    if not include_archived:
        stmt = stmt.where(Card.archived_at.is_(None))
    return list(session.scalars(stmt))


def get_active_card(session: Session, ctx: RequestContext, card_id: UUID) -> Card:
    card = get_owned(session, Card, card_id, ctx.user_id, "o cartão")
    if card.archived_at is not None:
        raise RuleViolation("card_archived", f"O cartão {card.name} está arquivado.")
    return card


def _ensure_unique_name(
    session: Session, user_id: UUID, name: str, exclude_id: UUID | None = None
) -> None:
    stmt = select(Card.id).where(
        Card.user_id == user_id, Card.name == name, Card.archived_at.is_(None)
    )
    if exclude_id is not None:
        stmt = stmt.where(Card.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise Conflict("name_already_exists", "Já existe um cartão com esse nome.")


def _opening_item(session: Session, ctx: RequestContext, invoice: Invoice, amount: Decimal) -> None:
    invoices.add_item(
        session,
        ctx,
        invoice,
        kind=InvoiceItemKind.OPENING_BALANCE,
        direction=ItemDirection.DEBIT,
        amount=amount,
    )


def create_card(
    session: Session,
    ctx: RequestContext,
    *,
    name: str,
    credit_limit: Decimal,
    closing_day: int,
    due_day: int,
    opening_date: date,
    opening: OpeningState | None = None,
) -> Card:
    _ensure_unique_name(session, ctx.user_id, name)
    card = Card(
        user_id=ctx.user_id,
        name=name,
        credit_limit=quantize(credit_limit),
        closing_day=closing_day,
        due_day=due_day,
        opening_date=opening_date,
    )
    session.add(card)
    session.flush()
    record(session, ctx, card, AuditAction.CREATE, before=None)
    if opening is None:
        return card

    open_month = opening_invoice_month(session, card)
    if opening.open_invoice_total is not None:
        opened = invoices.get_or_create_invoice(session, card, open_month)
        _opening_item(session, ctx, opened, opening.open_invoice_total)
    if opening.closed_invoice_total is not None:
        closed = invoices.get_or_create_invoice(session, card, add_months(open_month, -1))
        due = opening.closed_invoice_due_date
        if due is not None and due != closed.due_date:
            if due <= closed.closing_date:
                raise RuleViolation(
                    "due_before_closing", "O vencimento precisa ser depois do fechamento."
                )
            closed.due_date = due
            closed.dates_edited = True
        _opening_item(session, ctx, closed, opening.closed_invoice_total)
    return card


def set_opening_total(
    session: Session, ctx: RequestContext, card_id: UUID, amount: Decimal
) -> None:
    """Informa depois (ou corrige) o total da fatura aberta no início do cartão.

    Só enquanto essa fatura não fechou: depois disso, a conferência com o total do banco é o
    caminho. O valor substitui o anterior (nunca soma).
    """
    card = get_active_card(session, ctx, card_id)
    invoice = invoices.get_or_create_invoice(session, card, opening_invoice_month(session, card))
    if invoice.closing_date <= ctx.today():
        raise RuleViolation(
            "opening_invoice_closed",
            "A fatura do início já fechou. Confira pelo total do banco na tela do cartão.",
        )
    amount = quantize(amount)
    current = session.scalars(
        select(InvoiceItem)
        .where(
            InvoiceItem.invoice_id == invoice.id,
            InvoiceItem.kind == InvoiceItemKind.OPENING_BALANCE,
            InvoiceItem.status == ItemStatus.ACTIVE,
        )
        .with_for_update()
    ).first()
    if current is None:
        if amount > 0:
            _opening_item(session, ctx, invoice, amount)
        return
    before = snapshot(current)
    if amount > 0:
        current.amount = amount
    else:
        current.status = ItemStatus.CANCELLED
    record(session, ctx, current, AuditAction.UPDATE, before)


def _recalculate_cycle(session: Session, ctx: RequestContext, card: Card) -> None:
    """Novos dias de fechamento/vencimento valem para as faturas ainda não fechadas.

    Faturas fechadas e datas editadas à mão não mudam. Compras à vista, encargos e créditos de
    estorno que passarem a cair em outra fatura são movidos (pela data do lançamento), mas nunca
    para uma fatura já fechada.
    """
    today = ctx.today()
    not_closed = list(
        session.scalars(
            select(Invoice)
            .where(Invoice.card_id == card.id, Invoice.closing_date > today)
            .order_by(Invoice.reference_month)
        )
    )
    for invoice in not_closed:
        if invoice.dates_edited:
            continue
        before = snapshot(invoice)
        invoice.closing_date, invoice.due_date = invoice_dates(
            invoice.reference_month, card.closing_day, card.due_day
        )
        record(session, ctx, invoice, AuditAction.UPDATE, before)

    earliest_open = card_ledger.open_invoice_month(session, card, today)
    cash_purchase = (InvoiceItem.kind == InvoiceItemKind.PURCHASE) & (
        InvoiceItem.installment_number.is_(None)
    )
    by_date = InvoiceItem.kind.in_((InvoiceItemKind.CHARGE, InvoiceItemKind.REFUND_CREDIT))
    movable = session.execute(
        select(InvoiceItem, Transaction.occurred_on)
        .join(Transaction, Transaction.id == InvoiceItem.transaction_id)
        .where(
            InvoiceItem.invoice_id.in_([i.id for i in not_closed]),
            cash_purchase | by_date,
            InvoiceItem.status == ItemStatus.ACTIVE,
        )
    ).all()
    for item, occurred_on in movable:
        target_month = max(invoices.invoice_month_on(session, card, occurred_on), earliest_open)
        target = invoices.get_or_create_invoice(session, card, target_month)
        if target.id != item.invoice_id:
            before = snapshot(item)
            item.invoice_id = target.id
            record(session, ctx, item, AuditAction.UPDATE, before)


def update_card(
    session: Session, ctx: RequestContext, card_id: UUID, changes: Mapping[str, Any]
) -> Card:
    card = get_owned(session, Card, card_id, ctx.user_id, "o cartão", for_update=True)
    before = snapshot(card)
    name = changes.get("name")
    if name is not None and name != card.name:
        _ensure_unique_name(session, ctx.user_id, name, exclude_id=card.id)
        card.name = name
    if changes.get("credit_limit") is not None:
        card.credit_limit = quantize(changes["credit_limit"])
    cycle_changed = False
    for key in ("closing_day", "due_day"):
        value = changes.get(key)
        if value is not None and value != getattr(card, key):
            setattr(card, key, value)
            cycle_changed = True
    record(session, ctx, card, AuditAction.UPDATE, before)
    if cycle_changed:
        _recalculate_cycle(session, ctx, card)
    return card


def archive_card(session: Session, ctx: RequestContext, card_id: UUID) -> CardArchiveResult:
    card = get_owned(session, Card, card_id, ctx.user_id, "o cartão", for_update=True)
    if card.archived_at is not None:
        return CardArchiveResult(card)
    before = snapshot(card)
    card.archived_at = ctx.now()
    record(session, ctx, card, AuditAction.ARCHIVE, before)
    owed = card_ledger.outstanding(session, card)
    if owed <= 0:
        return CardArchiveResult(card)
    notice = Notice(
        "archived_with_balance", f"O cartão foi arquivado com {format_brl(owed)} a pagar."
    )
    return CardArchiveResult(card, [notice])
