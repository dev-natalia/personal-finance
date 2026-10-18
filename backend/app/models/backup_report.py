"""Cada backup concluído avisa o app; é assim que ele sabe quando foi o último."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BackupReport(Base):
    """Sem dona: o backup é do banco inteiro."""

    __tablename__ = "backup_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    finished_at: Mapped[datetime] = mapped_column(index=True)
    object_key: Mapped[str] = mapped_column(String(300))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
