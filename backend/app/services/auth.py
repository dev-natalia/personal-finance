"""Login com limite de tentativas e sessões guardadas no banco (revogáveis)."""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.models import LoginAttempt, User, UserSession
from app.services.users import DUMMY_HASH, normalize_email, verify_password

MAX_FAILURES = 5
FAILURE_WINDOW = timedelta(minutes=15)


@dataclass(frozen=True)
class SessionPolicy:
    secret_key: bytes
    idle: timedelta
    max_age: timedelta


@dataclass(frozen=True)
class LoginOutcome:
    user: User | None
    token: str | None
    blocked: bool = False


def hash_token(token: str, secret_key: bytes) -> bytes:
    """O banco guarda só o HMAC do token: quem lê o banco não consegue usar a sessão."""
    return hmac.new(secret_key, token.encode(), hashlib.sha256).digest()


def _recent_failures(
    session: Session, column: InstrumentedAttribute[str], value: str, since: datetime
) -> int:
    count = session.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(
            column == value,
            LoginAttempt.succeeded.is_(False),
            LoginAttempt.attempted_at >= since,
        )
    )
    return count or 0


def login(
    session: Session, policy: SessionPolicy, email: str, password: str, ip: str, now: datetime
) -> LoginOutcome:
    normalized = normalize_email(email)[:320]
    ip = ip[:64]
    since = now - FAILURE_WINDOW
    if (
        _recent_failures(session, LoginAttempt.email_normalized, normalized, since) >= MAX_FAILURES
        or _recent_failures(session, LoginAttempt.ip, ip, since) >= MAX_FAILURES
    ):
        return LoginOutcome(user=None, token=None, blocked=True)

    user = session.scalar(select(User).where(User.email == normalized))
    # Verifica um hash fictício quando o e-mail não existe: o tempo de resposta não revela nada.
    password_ok = verify_password(password, user.password_hash if user else DUMMY_HASH)
    succeeded = user is not None and password_ok
    session.add(
        LoginAttempt(email_normalized=normalized, ip=ip, succeeded=succeeded, attempted_at=now)
    )
    if not succeeded or user is None:
        session.flush()
        return LoginOutcome(user=None, token=None)

    token = secrets.token_urlsafe(32)
    session.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token, policy.secret_key),
            created_at=now,
            expires_at=now + policy.max_age,
            last_seen_at=now,
        )
    )
    session.flush()
    return LoginOutcome(user=user, token=token)


def _find(session: Session, policy: SessionPolicy, token: str) -> UserSession | None:
    return session.scalar(
        select(UserSession).where(UserSession.token_hash == hash_token(token, policy.secret_key))
    )


def authenticate(session: Session, policy: SessionPolicy, token: str, now: datetime) -> User | None:
    stored = _find(session, policy, token)
    if (
        stored is None
        or stored.revoked_at is not None
        or now >= stored.expires_at
        or now - stored.last_seen_at > policy.idle
    ):
        return None
    stored.last_seen_at = now
    session.flush()
    return session.get(User, stored.user_id)


def logout(session: Session, policy: SessionPolicy, token: str, now: datetime) -> None:
    stored = _find(session, policy, token)
    if stored is not None and stored.revoked_at is None:
        stored.revoked_at = now
        session.flush()


def revoke_all(session: Session, user_id: UUID, now: datetime) -> int:
    sessions = session.scalars(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    ).all()
    for stored in sessions:
        stored.revoked_at = now
    session.flush()
    return len(sessions)
