"""Faturas e seus itens: criação, lançamento de itens, pagamento e conferência."""

import uuid
from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.domain.cards import (
    add_months,
    consumption_month,
    invoice_dates,
    invoice_month_for,
    split_installments,
)
from app.domain.errors import RuleViolation
from app.domain.money import quantize
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
from app.repositories import get_owned
from app.services.audit import record, snapshot
from app.services.context import RequestContext


def get_or_create_invoice(session: Session, card: Card, reference_month: date) -> Invoice:
    """A fatura do mês, criada com as datas do ciclo do cartão se ainda não existe.

    ON CONFLICT: duas compras simultâneas no mesmo mês reaproveitam a mesma fatura.
    """
    by_month = select(Invoice).where(
        Invoice.card_id == card.id, Invoice.reference_month == reference_month
    )
    invoice = session.scalar(by_month)
    if invoice is None:
        closing, due = invoice_dates(reference_month, card.closing_day, card.due_day)
        session.execute(
            insert(Invoice)
            .values(
                id=uuid.uuid7(),
                user_id=card.user_id,
                card_id=card.id,
                reference_month=reference_month,
                closing_date=closing,
                due_date=due,
                dates_edited=False,
            )
            .on_conflict_do_nothing(index_elements=["card_id", "reference_month"])
        )
        invoice = session.scalars(by_month).one()
    return invoice


def add_item(
    session: Session,
    ctx: RequestContext,
    invoice: Invoice,
    *,
    kind: InvoiceItemKind,
    direction: ItemDirection,
    amount: Decimal,
    **links: Any,
) -> InvoiceItem:
    """Grava e audita um item da fatura (`links`: transação, parcela, origem, operação)."""
    item = InvoiceItem(
        user_id=ctx.user_id,
        invoice_id=invoice.id,
        kind=kind,
        direction=direction,
        amount=quantize(amount),
        **links,
    )
    session.add(item)
    session.flush()
    record(session, ctx, item, AuditAction.CREATE, before=None)
    return item


def bill_purchase(
    session: Session, ctx: RequestContext, tx: Transaction, card: Card
) -> list[InvoiceItem]:
    """Lança a compra nas faturas: um item à vista, ou uma parcela por fatura (A6, A10, A3)."""
    first_month = invoice_month_for(tx.occurred_on, card.closing_day, card.due_day)
    if tx.installments is None:
        invoice = get_or_create_invoice(session, card, first_month)
        item = add_item(
            session,
            ctx,
            invoice,
            kind=InvoiceItemKind.PURCHASE,
            direction=ItemDirection.DEBIT,
            amount=tx.amount,
            transaction_id=tx.id,
        )
        return [item]

    count = tx.installments
    parts = split_installments(tx.amount, count)
    numbers = range(1, count + 1)
    if tx.remaining_installments is not None:
        # Parcelada em andamento: só as que faltam, a partir da fatura seguinte à aberta no
        # início do cartão (a parcela daquele mês já está no total informado da fatura).
        numbers = range(count - tx.remaining_installments + 1, count + 1)
        opening_month = invoice_month_for(card.opening_date, card.closing_day, card.due_day)
        # A parcela `numbers[0]` cai na fatura seguinte à do início; a parcela k fica em
        # first_month + (k − 1), então first_month recua o que for preciso.
        first_month = add_months(opening_month, 1 - (numbers[0] - 1))
    items = []
    for number in numbers:
        invoice = get_or_create_invoice(session, card, add_months(first_month, number - 1))
        items.append(
            add_item(
                session,
                ctx,
                invoice,
                kind=InvoiceItemKind.PURCHASE,
                direction=ItemDirection.DEBIT,
                amount=parts[number - 1],
                transaction_id=tx.id,
                installment_number=number,
                installment_count=count,
                consumption_month=consumption_month(tx.occurred_on, number),
            )
        )
    return items


def bill_charge(session: Session, ctx: RequestContext, tx: Transaction, card: Card) -> InvoiceItem:
    """Encargo (juros, multa, IOF) na fatura da data em que foi cobrado."""
    month = invoice_month_for(tx.occurred_on, card.closing_day, card.due_day)
    return add_item(
        session,
        ctx,
        get_or_create_invoice(session, card, month),
        kind=InvoiceItemKind.CHARGE,
        direction=ItemDirection.DEBIT,
        amount=tx.amount,
        transaction_id=tx.id,
    )


# --- mudanças em lançamentos do cartão (nada em fatura fechada muda) -----------------------

CLOSED_INVOICE_MESSAGE = "Esta compra já está em fatura fechada. Registre um estorno."


def _active_items(session: Session, where: Any) -> list[tuple[InvoiceItem, Invoice]]:
    rows = session.execute(
        select(InvoiceItem, Invoice)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(where, InvoiceItem.status == ItemStatus.ACTIVE)
        .order_by(Invoice.reference_month)
        .with_for_update(of=InvoiceItem)
    ).all()
    return [(item, invoice) for item, invoice in rows]


def _ensure_not_closed(rows: list[tuple[InvoiceItem, Invoice]], today: date) -> None:
    if any(invoice.closing_date <= today for _, invoice in rows):
        raise RuleViolation("void_blocked_by_closed_invoice", CLOSED_INVOICE_MESSAGE)


def _set_status(
    session: Session,
    ctx: RequestContext,
    item: InvoiceItem,
    status: ItemStatus,
    cancelled_by_id: uuid.UUID | None = None,
) -> None:
    before = snapshot(item)
    item.status = status
    item.cancelled_by_id = cancelled_by_id
    record(session, ctx, item, AuditAction.UPDATE, before)


def ensure_items_open(session: Session, ctx: RequestContext, tx: Transaction) -> None:
    """Recusa mudar um lançamento que já tem item em fatura fechada."""
    _ensure_not_closed(_active_items(session, InvoiceItem.transaction_id == tx.id), ctx.today())


def cancel_transaction_items(session: Session, ctx: RequestContext, tx: Transaction) -> None:
    """Cancela os itens de uma compra ou encargo (anulação ou edição que refaz os itens)."""
    rows = _active_items(session, InvoiceItem.transaction_id == tx.id)
    _ensure_not_closed(rows, ctx.today())
    for item, _ in rows:
        _set_status(session, ctx, item, ItemStatus.CANCELLED)


def cancel_group_items(session: Session, ctx: RequestContext, group_id: uuid.UUID) -> None:
    """Cancela os itens criados por uma operação de pagamento (restante levado ou parcelado)."""
    rows = _active_items(session, InvoiceItem.payment_group_id == group_id)
    _ensure_not_closed(rows, ctx.today())
    for item, _ in rows:
        _set_status(session, ctx, item, ItemStatus.CANCELLED)


def apply_card_refund(
    session: Session, ctx: RequestContext, refund: Transaction, original: Transaction, card: Card
) -> None:
    """Estorno no cartão (A13): parcelas inteiras ainda não fechadas são canceladas, da última
    para a primeira, enquanto couberem no valor; o resto vira crédito na fatura aberta hoje.

    Compra à vista não tem parcelas a cancelar: o estorno todo vira crédito. Faturas fechadas
    nunca mudam (já foram conferidas com o banco).
    """
    today = ctx.today()
    remaining = refund.amount
    if original.installments is not None:
        rows = _active_items(
            session,
            (InvoiceItem.transaction_id == original.id)
            & (InvoiceItem.kind == InvoiceItemKind.PURCHASE),
        )
        future = [item for item, invoice in rows if invoice.closing_date > today]
        for item in sorted(future, key=lambda i: i.installment_number or 0, reverse=True):
            if item.amount > remaining:
                break
            _set_status(session, ctx, item, ItemStatus.CANCELLED, cancelled_by_id=refund.id)
            remaining -= item.amount
    if remaining > 0:
        month = invoice_month_for(today, card.closing_day, card.due_day)
        add_item(
            session,
            ctx,
            get_or_create_invoice(session, card, month),
            kind=InvoiceItemKind.REFUND_CREDIT,
            direction=ItemDirection.CREDIT,
            amount=remaining,
            transaction_id=refund.id,
        )


def undo_card_refund(session: Session, ctx: RequestContext, refund: Transaction) -> None:
    """Anula um estorno no cartão: remove o crédito e devolve as parcelas que ele cancelou.

    Recusado se o crédito, ou alguma parcela a devolver, já está em fatura fechada.
    """
    today = ctx.today()
    credits = _active_items(session, InvoiceItem.transaction_id == refund.id)
    restored = session.execute(
        select(InvoiceItem, Invoice)
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(InvoiceItem.cancelled_by_id == refund.id)
        .with_for_update(of=InvoiceItem)
    ).all()
    _ensure_not_closed(credits + [(i, inv) for i, inv in restored], today)
    for item, _ in credits:
        _set_status(session, ctx, item, ItemStatus.CANCELLED)
    for item, _ in restored:
        _set_status(session, ctx, item, ItemStatus.ACTIVE)


# --- conferência com o banco e datas -------------------------------------------------------


def update_invoice(
    session: Session, ctx: RequestContext, invoice_id: uuid.UUID, changes: Mapping[str, Any]
) -> Invoice:
    """Total informado pelo banco (A9; pode voltar a vazio) e datas editadas à mão (A7).

    Datas editadas não são recalculadas se o ciclo do cartão mudar.
    """
    invoice = get_owned(session, Invoice, invoice_id, ctx.user_id, "a fatura", for_update=True)
    before = snapshot(invoice)
    if "reported_total" in changes:
        reported = changes["reported_total"]
        invoice.reported_total = None if reported is None else quantize(reported)
    closing = changes.get("closing_date") or invoice.closing_date
    due = changes.get("due_date") or invoice.due_date
    if (closing, due) != (invoice.closing_date, invoice.due_date):
        if due <= closing:
            raise RuleViolation(
                "due_before_closing", "O vencimento precisa ser depois do fechamento."
            )
        invoice.closing_date, invoice.due_date, invoice.dates_edited = closing, due, True
    record(session, ctx, invoice, AuditAction.UPDATE, before)
    return invoice
