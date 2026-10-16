"""Faturas e seus itens: criação, lançamento de itens, pagamento e conferência."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.domain.cards import invoice_dates
from app.domain.money import quantize
from app.models import AuditAction, Card, Invoice, InvoiceItem, InvoiceItemKind, ItemDirection
from app.services.audit import record
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
