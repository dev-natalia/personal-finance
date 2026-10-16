import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Identity, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, enum_type


class AuditAction(StrEnum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    VOID = "VOID"
    ARCHIVE = "ARCHIVE"


class Actor(StrEnum):
    USER = "USER"
    AI = "AI"
    SYSTEM = "SYSTEM"


class AuditLog(Base):
    """Registro somente de inserção das alterações relevantes."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    action: Mapped[AuditAction] = mapped_column(enum_type(AuditAction, "audit_action"))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    actor: Mapped[Actor] = mapped_column(enum_type(Actor, "audit_actor"))
    request_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
