import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel, enum_type


class TransactionType(StrEnum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"
    TRANSFER = "TRANSFER"
    REFUND = "REFUND"


class PaymentMethod(StrEnum):
    PIX = "PIX"
    DEBIT = "DEBIT"
    CASH = "CASH"
    BOLETO = "BOLETO"
    OTHER = "OTHER"


class TransactionStatus(StrEnum):
    CONFIRMED = "CONFIRMED"
    VOIDED = "VOIDED"


class TransactionSource(StrEnum):
    MANUAL = "MANUAL"
    AI = "AI"
    IMPORT = "IMPORT"


# Colunas obrigatórias/proibidas por tipo. O service valida antes; isto é a rede de segurança.
SHAPE_BY_TYPE = """
(type = 'INCOME' AND category_id IS NOT NULL AND destination_account_id IS NULL
    AND payment_method IS NULL AND refund_of_id IS NULL)
OR (type = 'EXPENSE' AND category_id IS NOT NULL AND payment_method IS NOT NULL
    AND destination_account_id IS NULL AND refund_of_id IS NULL)
OR (type = 'TRANSFER' AND destination_account_id IS NOT NULL
    AND destination_account_id <> account_id AND category_id IS NULL
    AND payment_method IS NULL AND refund_of_id IS NULL AND merchant_id IS NULL)
OR (type = 'REFUND' AND refund_of_id IS NOT NULL AND category_id IS NOT NULL
    AND destination_account_id IS NULL AND payment_method IS NULL)
"""


class Transaction(OwnedModel):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(SHAPE_BY_TYPE, name="shape_by_type"),
        CheckConstraint(
            "(idempotency_key IS NULL) = (idempotency_payload_hash IS NULL)",
            name="idempotency_pair",
        ),
        CheckConstraint(
            "(status = 'VOIDED') = (voided_at IS NOT NULL)", name="voided_at_matches_status"
        ),
        UniqueConstraint("user_id", "idempotency_key"),
        Index("ix_transactions_user_date", "user_id", "occurred_on", "id"),
        Index("ix_transactions_user_account_date", "user_id", "account_id", "occurred_on"),
        Index("ix_transactions_user_destination", "user_id", "destination_account_id"),
        Index("ix_transactions_user_category_date", "user_id", "category_id", "occurred_on"),
    )

    type: Mapped[TransactionType] = mapped_column(enum_type(TransactionType, "transaction_type"))
    amount: Mapped[Decimal]
    occurred_on: Mapped[date]
    description: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(String(1000))
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("merchants.id"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    destination_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id"))
    payment_method: Mapped[PaymentMethod | None] = mapped_column(
        enum_type(PaymentMethod, "payment_method")
    )
    refund_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id"), index=True
    )
    status: Mapped[TransactionStatus] = mapped_column(
        enum_type(TransactionStatus, "transaction_status"), default=TransactionStatus.CONFIRMED
    )
    source: Mapped[TransactionSource] = mapped_column(
        enum_type(TransactionSource, "transaction_source"), default=TransactionSource.MANUAL
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(100))
    idempotency_payload_hash: Mapped[bytes | None] = mapped_column(LargeBinary(32))
    voided_at: Mapped[datetime | None]
