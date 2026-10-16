"""Consultas do cartão. Única fonte das definições de saldo de fatura, limite e prévia.

Nenhuma outra parte do código soma itens de fatura por conta própria.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.domain.cards import add_months, invoice_dates, invoice_month_for, split_installments
from app.domain.money import quantize
from app.models import (
    Card,
    Invoice,
    InvoiceItem,
    InvoiceItemKind,
    ItemDirection,
    ItemStatus,
    Transaction,
    TransactionStatus,
    TransactionType,
)

ZERO = Decimal("0.00")
MOVED_KINDS = (InvoiceItemKind.CARRYOVER, InvoiceItemKind.INVOICE_INSTALLMENT)


def _sum(session: Session, stmt: Any) -> Decimal:
    return quantize(Decimal(session.scalar(stmt) or 0))


def outstanding(session: Session, card: Card) -> Decimal:
    """Quanto se deve no cartão, somando todas as faturas (inclusive parcelas futuras).

    devido = débitos ativos − créditos ativos − pagamentos confirmados − valor levado adiante

    O valor levado adiante (saldo para a próxima fatura ou parcelamento da fatura) aparece de
    novo como débito na fatura de destino; descontá-lo na origem evita contar duas vezes.
    """
    active_items = (
        select(func.sum(InvoiceItem.amount))
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(Invoice.card_id == card.id, InvoiceItem.status == ItemStatus.ACTIVE)
    )
    debits = _sum(session, active_items.where(InvoiceItem.direction == ItemDirection.DEBIT))
    credits = _sum(session, active_items.where(InvoiceItem.direction == ItemDirection.CREDIT))
    payments = _sum(
        session,
        select(func.sum(Transaction.amount))
        .join(Invoice, Invoice.id == Transaction.invoice_id)
        .where(
            Invoice.card_id == card.id,
            Transaction.type == TransactionType.INVOICE_PAYMENT,
            Transaction.status == TransactionStatus.CONFIRMED,
        ),
    )
    source = aliased(Invoice)
    moved_out = _sum(
        session,
        select(func.sum(InvoiceItem.amount))
        .join(source, source.id == InvoiceItem.source_invoice_id)
        .where(
            source.card_id == card.id,
            InvoiceItem.status == ItemStatus.ACTIVE,
            InvoiceItem.kind.in_(MOVED_KINDS),
        ),
    )
    return quantize(debits - credits - payments - moved_out)


# --- faturas ----------------------------------------------------------------------------------


class InvoiceState(StrEnum):
    FUTURE = "FUTURE"
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    PAID = "PAID"


@dataclass(frozen=True)
class InvoiceTotals:
    """Somas de uma fatura.

    total   = débitos − créditos − crédito vindo da fatura anterior  (o valor "da fatura")
    balance = total − pagamentos − valor levado adiante              (o que falta pagar)
    """

    invoice: Invoice
    debits: Decimal
    credits: Decimal
    payments: Decimal
    moved_out: Decimal
    credit_from_previous: Decimal
    total: Decimal
    balance: Decimal
    state: InvoiceState


def open_invoice_month(card: Card, today: date) -> date:
    """Mês da fatura aberta hoje (a que recebe uma compra feita hoje)."""
    return invoice_month_for(today, card.closing_day, card.due_day)


def _per_invoice(session: Session, stmt: Any) -> defaultdict[UUID, Decimal]:
    sums: defaultdict[UUID, Decimal] = defaultdict(lambda: ZERO)
    for invoice_id, amount in session.execute(stmt):
        sums[invoice_id] = quantize(Decimal(amount))
    return sums


def _state(invoice: Invoice, balance: Decimal, open_month: date, today: date) -> InvoiceState:
    if invoice.closing_date > today:
        return InvoiceState.OPEN if invoice.reference_month <= open_month else InvoiceState.FUTURE
    return InvoiceState.CLOSED if balance > 0 else InvoiceState.PAID


def invoice_totals(session: Session, card: Card, today: date) -> list[InvoiceTotals]:
    """Todas as faturas do cartão, em ordem de mês, com somas e estado.

    Uma fatura que fecha com mais crédito que débito fica paga, e o saldo credor abate a fatura
    seguinte (como o banco faz).
    """
    card_invoices = list(
        session.scalars(
            select(Invoice).where(Invoice.card_id == card.id).order_by(Invoice.reference_month)
        )
    )
    ids = [i.id for i in card_invoices]
    active = InvoiceItem.status == ItemStatus.ACTIVE
    by_direction = (
        select(InvoiceItem.invoice_id, func.sum(InvoiceItem.amount))
        .where(InvoiceItem.invoice_id.in_(ids), active)
        .group_by(InvoiceItem.invoice_id)
    )
    debits = _per_invoice(session, by_direction.where(InvoiceItem.direction == ItemDirection.DEBIT))
    credits = _per_invoice(
        session, by_direction.where(InvoiceItem.direction == ItemDirection.CREDIT)
    )
    payments = _per_invoice(
        session,
        select(Transaction.invoice_id, func.sum(Transaction.amount))
        .where(
            Transaction.invoice_id.in_(ids),
            Transaction.type == TransactionType.INVOICE_PAYMENT,
            Transaction.status == TransactionStatus.CONFIRMED,
        )
        .group_by(Transaction.invoice_id),
    )
    moved_out = _per_invoice(
        session,
        select(InvoiceItem.source_invoice_id, func.sum(InvoiceItem.amount))
        .where(InvoiceItem.source_invoice_id.in_(ids), active, InvoiceItem.kind.in_(MOVED_KINDS))
        .group_by(InvoiceItem.source_invoice_id),
    )

    open_month = open_invoice_month(card, today)
    result: list[InvoiceTotals] = []
    carried = ZERO
    for invoice in card_invoices:
        total = debits[invoice.id] - credits[invoice.id] - carried
        balance = total - payments[invoice.id] - moved_out[invoice.id]
        from_previous, carried = carried, ZERO
        if invoice.closing_date <= today and balance < 0:
            carried, balance = -balance, ZERO
        result.append(
            InvoiceTotals(
                invoice=invoice,
                debits=debits[invoice.id],
                credits=credits[invoice.id],
                payments=payments[invoice.id],
                moved_out=moved_out[invoice.id],
                credit_from_previous=from_previous,
                total=quantize(total),
                balance=quantize(balance),
                state=_state(invoice, balance, open_month, today),
            )
        )
    return result


# --- limite e resumo --------------------------------------------------------------------------


@dataclass(frozen=True)
class LimitStatus:
    limit: Decimal
    used: Decimal
    available: Decimal


def limit_status(session: Session, card: Card, today: date) -> LimitStatus:
    """Limite usado = tudo o que se deve no cartão, inclusive parcelas futuras (A14).

    Pode ficar negativo (o banco às vezes aprova acima do limite): o app avisa, não bloqueia.
    `today` fica na assinatura para a regra poder depender da data sem mudar quem chama.
    """
    used = max(ZERO, outstanding(session, card))
    return LimitStatus(card.credit_limit, used, quantize(card.credit_limit - used))


@dataclass(frozen=True)
class CardSummary:
    card: Card
    open_reference_month: date
    open_closing_date: date
    open_due_date: date
    open_invoice: InvoiceTotals | None  # None: nenhum item ainda na fatura aberta
    payable: InvoiceTotals | None  # a fatura fechada mais antiga com saldo a pagar
    future: list[InvoiceTotals]
    limit: LimitStatus


def card_summary(session: Session, card: Card, today: date) -> CardSummary:
    totals = invoice_totals(session, card, today)
    open_month = open_invoice_month(card, today)
    opened = next((t for t in totals if t.invoice.reference_month == open_month), None)
    closing, due = (
        (opened.invoice.closing_date, opened.invoice.due_date)
        if opened
        else invoice_dates(open_month, card.closing_day, card.due_day)
    )
    return CardSummary(
        card=card,
        open_reference_month=open_month,
        open_closing_date=closing,
        open_due_date=due,
        open_invoice=opened,
        payable=next((t for t in totals if t.state is InvoiceState.CLOSED), None),
        future=[t for t in totals if t.state is InvoiceState.FUTURE],
        limit=limit_status(session, card, today),
    )


# --- prévia de compra -------------------------------------------------------------------------


@dataclass(frozen=True)
class InvoiceImpact:
    reference_month: date
    before: Decimal
    after: Decimal


@dataclass(frozen=True)
class PurchasePreview:
    invoice: InvoiceImpact
    following: list[InvoiceImpact]
    limit_before: Decimal
    limit_after: Decimal


def preview_purchase(
    session: Session,
    card: Card,
    *,
    amount: Decimal,
    installments: int | None,
    occurred_on: date,
    today: date,
) -> PurchasePreview:
    """Como as faturas e o limite ficariam com a compra. Não grava nada."""
    amount = quantize(amount)
    parts = [amount] if installments is None else split_installments(amount, installments)
    first = invoice_month_for(occurred_on, card.closing_day, card.due_day)
    current = {t.invoice.reference_month: t.total for t in invoice_totals(session, card, today)}
    impacts = []
    for offset, part in enumerate(parts):
        month = add_months(first, offset)
        before = current.get(month, ZERO)
        impacts.append(InvoiceImpact(month, before, quantize(before + part)))
    available = limit_status(session, card, today).available
    return PurchasePreview(
        invoice=impacts[0],
        following=impacts[1:],
        limit_before=available,
        limit_after=quantize(available - amount),
    )
