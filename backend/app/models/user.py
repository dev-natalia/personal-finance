import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Identity, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

DEFAULT_TIMEZONE = "America/Sao_Paulo"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    timezone: Mapped[str] = mapped_column(
        String(64), default=DEFAULT_TIMEZONE, server_default=DEFAULT_TIMEZONE
    )


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    email_normalized: Mapped[str] = mapped_column(String(320), index=True)
    ip: Mapped[str] = mapped_column(String(64), index=True)
    succeeded: Mapped[bool]
    attempted_at: Mapped[datetime] = mapped_column(index=True)
