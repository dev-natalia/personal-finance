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
from app.domain.dates import month_name
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


@dataclass(frozen=True)
class _Sums:
    """Somas por fatura, todas com itens ativos e lançamentos confirmados."""

    debits: defaultdict[UUID, Decimal]
    credits: defaultdict[UUID, Decimal]
    payments: defaultdict[UUID, Decimal]
    moved_out: defaultdict[UUID, Decimal]


def _per_invoice(session: Session, stmt: Any) -> defaultdict[UUID, Decimal]:
    sums: defaultdict[UUID, Decimal] = defaultdict(lambda: ZERO)
    for invoice_id, amount in session.execute(stmt):
        sums[invoice_id] = quantize(Decimal(amount))
    return sums


def _sums(session: Session, ids: list[UUID]) -> _Sums:
    """Débitos, créditos, pagamentos e valor levado adiante de cada fatura.

    Valor levado adiante = o que saiu da fatura para outras: saldo para a próxima (rotativo) ou
    parcelamento com o banco. No parcelamento as parcelas incluem juros, que não saíram da
    fatura de origem; por isso os juros do mesmo pagamento (o encargo do grupo) são
    descontados. Sem isso, a fatura de origem ficaria com saldo negativo falso.
    """
    active = InvoiceItem.status == ItemStatus.ACTIVE
    by_direction = (
        select(InvoiceItem.invoice_id, func.sum(InvoiceItem.amount))
        .where(InvoiceItem.invoice_id.in_(ids), active)
        .group_by(InvoiceItem.invoice_id)
    )
    moved_items = _per_invoice(
        session,
        select(InvoiceItem.source_invoice_id, func.sum(InvoiceItem.amount))
        .where(InvoiceItem.source_invoice_id.in_(ids), active, InvoiceItem.kind.in_(MOVED_KINDS))
        .group_by(InvoiceItem.source_invoice_id),
    )
    plans = (
        select(InvoiceItem.payment_group_id, InvoiceItem.source_invoice_id)
        .where(
            InvoiceItem.source_invoice_id.in_(ids),
            active,
            InvoiceItem.kind == InvoiceItemKind.INVOICE_INSTALLMENT,
        )
        .distinct()
        .subquery()
    )
    interest = _per_invoice(
        session,
        select(plans.c.source_invoice_id, func.sum(Transaction.amount))
        .join(Transaction, Transaction.payment_group_id == plans.c.payment_group_id)
        .where(
            Transaction.type == TransactionType.CHARGE,
            Transaction.status == TransactionStatus.CONFIRMED,
        )
        .group_by(plans.c.source_invoice_id),
    )
    moved_out: defaultdict[UUID, Decimal] = defaultdict(lambda: ZERO)
    for invoice_id, amount in moved_items.items():
        moved_out[invoice_id] = quantize(amount - interest[invoice_id])
    return _Sums(
        debits=_per_invoice(
            session, by_direction.where(InvoiceItem.direction == ItemDirection.DEBIT)
        ),
        credits=_per_invoice(
            session, by_direction.where(InvoiceItem.direction == ItemDirection.CREDIT)
        ),
        payments=_per_invoice(
            session,
            select(Transaction.invoice_id, func.sum(Transaction.amount))
            .where(
                Transaction.invoice_id.in_(ids),
                Transaction.type == TransactionType.INVOICE_PAYMENT,
                Transaction.status == TransactionStatus.CONFIRMED,
            )
            .group_by(Transaction.invoice_id),
        ),
        moved_out=moved_out,
    )


def _card_invoices(session: Session, card: Card) -> list[Invoice]:
    return list(
        session.scalars(
            select(Invoice).where(Invoice.card_id == card.id).order_by(Invoice.reference_month)
        )
    )


def outstanding(session: Session, card: Card) -> Decimal:
    """Quanto se deve no cartão, somando todas as faturas (inclusive parcelas futuras).

    devido = débitos − créditos − pagamentos − valor levado adiante

    O valor levado adiante reaparece como débito na fatura de destino (no parcelamento, com os
    juros); descontá-lo na origem evita contar duas vezes.
    """
    ids = [i.id for i in _card_invoices(session, card)]
    sums = _sums(session, ids)
    return quantize(
        sum(
            (sums.debits[i] - sums.credits[i] - sums.payments[i] - sums.moved_out[i] for i in ids),
            ZERO,
        )
    )


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


def _state(invoice: Invoice, balance: Decimal, open_month: date, today: date) -> InvoiceState:
    if invoice.closing_date > today:
        return InvoiceState.OPEN if invoice.reference_month <= open_month else InvoiceState.FUTURE
    return InvoiceState.CLOSED if balance > 0 else InvoiceState.PAID


def invoice_totals(session: Session, card: Card, today: date) -> list[InvoiceTotals]:
    """Todas as faturas do cartão, em ordem de mês, com somas e estado.

    Uma fatura que fecha com mais crédito que débito fica paga, e o saldo credor abate a fatura
    seguinte (como o banco faz).
    """
    card_invoices = _card_invoices(session, card)
    sums = _sums(session, [i.id for i in card_invoices])
    debits, credits, payments, moved_out = sums.debits, sums.credits, sums.payments, sums.moved_out

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


# --- linhas da fatura -------------------------------------------------------------------------


@dataclass(frozen=True)
class InvoiceLine:
    item: InvoiceItem
    description: str
    occurred_on: date | None


def _line_description(item: InvoiceItem, tx_description: str | None, source: date | None) -> str:
    match item.kind:
        case InvoiceItemKind.OPENING_BALANCE:
            return "Saldo inicial"
        case InvoiceItemKind.CARRYOVER if source is not None:
            return f"Saldo da fatura de {month_name(source)}"
        case InvoiceItemKind.INVOICE_INSTALLMENT if source is not None:
            return (
                f"Parcelamento da fatura de {month_name(source)} "
                f"({item.installment_number}/{item.installment_count})"
            )
        case _:
            return tx_description or ""


def invoice_lines(session: Session, invoice: Invoice) -> list[InvoiceLine]:
    """Itens ativos da fatura, com o texto que a tela mostra, em ordem de data."""
    source = aliased(Invoice)
    rows = session.execute(
        select(
            InvoiceItem, Transaction.description, Transaction.occurred_on, source.reference_month
        )
        .outerjoin(Transaction, Transaction.id == InvoiceItem.transaction_id)
        .outerjoin(source, source.id == InvoiceItem.source_invoice_id)
        .where(InvoiceItem.invoice_id == invoice.id, InvoiceItem.status == ItemStatus.ACTIVE)
        .order_by(Transaction.occurred_on.asc().nulls_first(), InvoiceItem.id)
    ).all()
    return [
        InvoiceLine(item, _line_description(item, description, source_month), occurred_on)
        for item, description, occurred_on, source_month in rows
    ]


def invoice_payments(session: Session, invoice: Invoice) -> list[Transaction]:
    """Pagamentos confirmados da fatura."""
    return list(
        session.scalars(
            select(Transaction)
            .where(
                Transaction.invoice_id == invoice.id,
                Transaction.type == TransactionType.INVOICE_PAYMENT,
                Transaction.status == TransactionStatus.CONFIRMED,
            )
            .order_by(Transaction.occurred_on, Transaction.id)
        )
    )
