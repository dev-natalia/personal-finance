"""Faturas e seus itens: criação, lançamento de itens, pagamento e conferência."""

import uuid
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
from app.domain.money import quantize
from app.models import (
    AuditAction,
    Card,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
    Transaction,
)
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
