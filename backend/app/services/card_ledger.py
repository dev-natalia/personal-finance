"""Consultas do cartão. Única fonte das definições de saldo de fatura, limite e prévia.

Nenhuma outra parte do código soma itens de fatura por conta própria.
"""

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

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


def _sum(session: Session, stmt: object) -> Decimal:
    return quantize(Decimal(session.scalar(stmt) or 0))  # type: ignore[call-overload]


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
