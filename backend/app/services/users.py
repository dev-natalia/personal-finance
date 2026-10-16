"""Criação de usuárias e senhas (argon2id). Não há cadastro público: só via CLI."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import DEFAULT_TIMEZONE, User
from app.services.categories import seed_default_categories

MIN_PASSWORD_LENGTH = 12

_hasher = PasswordHash((Argon2Hasher(),))
# Usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos.
DUMMY_HASH = _hasher.hash("senha-ficticia-para-tempo-constante")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _hasher.verify(password, password_hash)


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise RuleViolation(
            "weak_password", f"A senha deve ter pelo menos {MIN_PASSWORD_LENGTH} caracteres."
        )


def create_user(
    session: Session, email: str, password: str, timezone: str = DEFAULT_TIMEZONE
) -> User:
    normalized = normalize_email(email)
    if "@" not in normalized or len(normalized) > 320:
        raise RuleViolation("invalid_email", "E-mail inválido.")
    _validate_password(password)
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise RuleViolation("invalid_timezone", f"Fuso horário desconhecido: {timezone}.") from exc
    if session.scalar(select(User.id).where(User.email == normalized)) is not None:
        raise Conflict("email_already_exists", "Já existe uma usuária com esse e-mail.")

    user = User(email=normalized, password_hash=hash_password(password), timezone=timezone)
    session.add(user)
    session.flush()
    seed_default_categories(session, user.id)
    return user


def get_by_email(session: Session, email: str) -> User:
    user = session.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        raise NotFound("a usuária")
    return user


def set_password(session: Session, email: str, password: str) -> User:
    user = get_by_email(session, email)
    _validate_password(password)
    user.password_hash = hash_password(password)
    session.flush()
    return user
