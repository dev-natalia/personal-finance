import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, SmallInteger, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel, enum_type


class Invoice(OwnedModel):
    """Fatura de um cartão, identificada pelo mês de vencimento.

    Criada pelo backend quando o primeiro item cai nela. O estado (aberta, fechada, paga) é
    derivado das datas e dos itens, nunca guardado.
    """

    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("card_id", "reference_month"),
        CheckConstraint("EXTRACT(DAY FROM reference_month) = 1", name="reference_month_first_day"),
        CheckConstraint("closing_date < due_date", name="closing_before_due"),
    )

    card_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cards.id"), index=True)
    reference_month: Mapped[date]
    closing_date: Mapped[date]
    due_date: Mapped[date]
    # Total que o banco mostra (A9); a diferença para o calculado fica visível.
    reported_total: Mapped[Decimal | None]
    # Datas editadas à mão (o banco às vezes desloca para dia útil) não são recalculadas.
    dates_edited: Mapped[bool] = mapped_column(default=False)


class InvoiceItemKind(StrEnum):
    PURCHASE = "PURCHASE"
    CHARGE = "CHARGE"
    REFUND_CREDIT = "REFUND_CREDIT"
    CARRYOVER = "CARRYOVER"
    INVOICE_INSTALLMENT = "INVOICE_INSTALLMENT"
    OPENING_BALANCE = "OPENING_BALANCE"


class ItemDirection(StrEnum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class ItemStatus(StrEnum):
    ACTIVE = "ACTIVE"
    CANCELLED = "CANCELLED"


class InvoiceItem(OwnedModel):
    """Uma linha da fatura: parcela de compra, encargo, crédito de estorno, saldo levado
    adiante, parcela de parcelamento da fatura ou saldo inicial."""

    __tablename__ = "invoice_items"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(
            "(kind = 'REFUND_CREDIT') = (direction = 'CREDIT')", name="direction_matches_kind"
        ),
        CheckConstraint(
            "(installment_number IS NULL) = (installment_count IS NULL)"
            " AND (installment_number IS NULL OR installment_number BETWEEN 1 AND installment_count)",
            name="installment_pair",
        ),
        CheckConstraint(
            "(source_invoice_id IS NOT NULL) = (kind IN ('CARRYOVER', 'INVOICE_INSTALLMENT'))",
            name="source_invoice_matches_kind",
        ),
        CheckConstraint(
            "consumption_month IS NULL OR kind = 'PURCHASE'", name="consumption_month_purchase_only"
        ),
        Index("ix_invoice_items_invoice_status", "invoice_id", "status"),
    )

    invoice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("invoices.id"))
    kind: Mapped[InvoiceItemKind] = mapped_column(enum_type(InvoiceItemKind, "invoice_item_kind"))
    direction: Mapped[ItemDirection] = mapped_column(enum_type(ItemDirection, "item_direction"))
    amount: Mapped[Decimal]
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id"), index=True
    )
    installment_number: Mapped[int | None] = mapped_column(SmallInteger)
    installment_count: Mapped[int | None] = mapped_column(SmallInteger)
    # Só parcelas de compra parcelada: mês em que a parcela conta no consumo (A3).
    consumption_month: Mapped[date | None]
    source_invoice_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("invoices.id"))
    payment_group_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    # Estorno que cancelou esta parcela (para devolvê-la se o estorno for anulado).
    cancelled_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id"))
    status: Mapped[ItemStatus] = mapped_column(
        enum_type(ItemStatus, "item_status"), default=ItemStatus.ACTIVE
    )
