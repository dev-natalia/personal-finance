from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel


class Card(OwnedModel):
    """Cartão de crédito. O ciclo (fechamento e vencimento) define as faturas."""

    __tablename__ = "cards"
    __table_args__ = (
        UniqueConstraint("user_id", "name"),
        CheckConstraint("credit_limit > 0", name="credit_limit_positive"),
        CheckConstraint("closing_day BETWEEN 1 AND 31", name="closing_day_range"),
        CheckConstraint("due_day BETWEEN 1 AND 31", name="due_day_range"),
    )

    name: Mapped[str] = mapped_column(String(60))
    credit_limit: Mapped[Decimal]
    closing_day: Mapped[int] = mapped_column(SmallInteger)
    due_day: Mapped[int] = mapped_column(SmallInteger)
    # Primeiro dia em que o app acompanha o cartão; a história anterior entra pelo início.
    opening_date: Mapped[date]
    archived_at: Mapped[datetime | None]
