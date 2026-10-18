"""Frases do registro rápido que o interpretador não entendeu de primeira."""

from enum import StrEnum

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel


class MisreadReason(StrEnum):
    NOTHING_PARSED = "NOTHING_PARSED"
    PENDING_AMOUNT = "PENDING_AMOUNT"
    PENDING_DESCRIPTION = "PENDING_DESCRIPTION"
    PENDING_ACCOUNT = "PENDING_ACCOUNT"
    PENDING_PAYMENT_METHOD = "PENDING_PAYMENT_METHOD"
    CHANGED_TYPE = "CHANGED_TYPE"
    CHANGED_AMOUNT = "CHANGED_AMOUNT"
    CHANGED_DESCRIPTION = "CHANGED_DESCRIPTION"
    CHANGED_DATE = "CHANGED_DATE"
    CHANGED_SOURCE = "CHANGED_SOURCE"
    CHANGED_PAYMENT_METHOD = "CHANGED_PAYMENT_METHOD"
    CHANGED_INSTALLMENTS = "CHANGED_INSTALLMENTS"
    UNCHECKED_ITEM = "UNCHECKED_ITEM"


class MisreadPhrase(OwnedModel):
    __tablename__ = "misread_phrases"

    text: Mapped[str] = mapped_column(String(500))
    # Motivos (valores de MisreadReason) ordenados e sem repetição.
    reasons: Mapped[list[str]] = mapped_column(ARRAY(String(30)))
