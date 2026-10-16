from datetime import datetime
from enum import StrEnum

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel, enum_type


class CategoryKind(StrEnum):
    EXPENSE = "EXPENSE"
    INCOME = "INCOME"


class Category(OwnedModel):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "kind", "name"),)

    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[CategoryKind] = mapped_column(enum_type(CategoryKind, "category_kind"))
    is_essential: Mapped[bool] = mapped_column(default=False)
    is_system: Mapped[bool] = mapped_column(default=False)
    archived_at: Mapped[datetime | None]
