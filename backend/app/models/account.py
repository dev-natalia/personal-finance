from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel, enum_type


class AccountType(StrEnum):
    CHECKING = "CHECKING"
    SAVINGS = "SAVINGS"
    CASH = "CASH"


class Account(OwnedModel):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[AccountType] = mapped_column(enum_type(AccountType, "account_type"))
    opening_balance: Mapped[Decimal]
    opening_date: Mapped[date]
    archived_at: Mapped[datetime | None]
