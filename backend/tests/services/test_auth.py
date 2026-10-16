from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LoginAttempt, User, UserSession
from app.services import auth
from tests.support import FIXED_NOW, PASSWORD, POLICY

NOW = FIXED_NOW


def _login(
    db: Session,
    email: str = "ana@example.com",
    password: str = PASSWORD,
    ip: str = "1.1.1.1",
    now: datetime = NOW,
) -> auth.LoginOutcome:
    return auth.login(db, POLICY, email, password, ip, now)


def test_login_success_creates_hashed_session(db: Session, user: User) -> None:
    outcome = _login(db)
    assert outcome.user is not None and outcome.user.id == user.id
    assert outcome.token and not outcome.blocked
    stored = db.scalars(select(UserSession).where(UserSession.user_id == user.id)).one()
    assert stored.token_hash == auth.hash_token(outcome.token, POLICY.secret_key)
    assert stored.token_hash != outcome.token.encode()
    assert stored.expires_at == NOW + timedelta(days=90)


def test_login_is_case_insensitive_on_email(db: Session, user: User) -> None:
    outcome = _login(db, email="  ANA@Example.com")
    assert outcome.user is not None and outcome.user.id == user.id


def test_wrong_password_records_failure(db: Session, user: User) -> None:
    outcome = _login(db, password="senha-errada-123")
    assert outcome.user is None and outcome.token is None and not outcome.blocked
    assert [a.succeeded for a in db.scalars(select(LoginAttempt)).all()] == [False]


def test_unknown_email_fails_like_wrong_password(db: Session) -> None:
    outcome = _login(db, email="ninguem@example.com")
    assert outcome.user is None and outcome.token is None and not outcome.blocked


def test_blocks_after_five_failures_by_email(db: Session, user: User) -> None:
    for i in range(5):
        _login(db, password="senha-errada-123", ip=f"10.0.0.{i}")
    outcome = _login(db, ip="10.0.0.99")
    assert outcome.blocked and outcome.token is None


def test_blocks_after_five_failures_by_ip(db: Session, user: User) -> None:
    for i in range(5):
        _login(db, email=f"x{i}@example.com", ip="2.2.2.2")
    assert _login(db, ip="2.2.2.2").blocked


def test_old_failures_do_not_count(db: Session, user: User) -> None:
    for _ in range(5):
        _login(db, password="senha-errada-123", now=NOW - timedelta(minutes=16))
    assert _login(db).token is not None


def test_authenticate_slides_while_in_use(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    first = auth.authenticate(db, POLICY, token, NOW + timedelta(days=20))
    assert first is not None and first.id == user.id
    assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=45)) is not None


def test_authenticate_rejects_idle_session(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=31)) is None


def test_authenticate_rejects_after_absolute_expiry(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    for day in (20, 40, 60, 80):
        assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=day)) is not None
    assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=91)) is None


def test_logout_revokes(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    auth.logout(db, POLICY, token, NOW)
    assert auth.authenticate(db, POLICY, token, NOW) is None


def test_revoke_all(db: Session, user: User) -> None:
    tokens = [_login(db).token, _login(db).token]
    assert auth.revoke_all(db, user.id, NOW) == 2
    for token in tokens:
        assert token is not None
        assert auth.authenticate(db, POLICY, token, NOW) is None


def test_unknown_token(db: Session) -> None:
    assert auth.authenticate(db, POLICY, "nao-existe", NOW) is None
