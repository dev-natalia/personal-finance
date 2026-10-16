import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.models import User
from app.services import auth
from app.services.users import verify_password
from tests.support import FIXED_NOW, PASSWORD, POLICY


def test_create_user_command(
    db: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("PF_NEW_PASSWORD", "senha-da-cli-bem-longa")
    assert cli.run(["create-user", "--email", "cli@example.com"], db) == 0
    assert "cli@example.com" in capsys.readouterr().out
    assert db.scalar(select(User).where(User.email == "cli@example.com")) is not None


def test_create_user_duplicate_returns_error(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("PF_NEW_PASSWORD", "senha-da-cli-bem-longa")
    assert cli.run(["create-user", "--email", "ana@example.com"], db) == 1
    assert "Erro:" in capsys.readouterr().err


def test_set_password_revokes_sessions(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = auth.login(db, POLICY, "ana@example.com", PASSWORD, "ip", FIXED_NOW).token
    assert token is not None
    monkeypatch.setenv("PF_NEW_PASSWORD", "nova-senha-bem-longa")
    assert cli.run(["set-password", "--email", "ana@example.com"], db) == 0
    assert verify_password("nova-senha-bem-longa", user.password_hash)
    assert auth.authenticate(db, POLICY, token, FIXED_NOW) is None


def test_revoke_sessions_command(
    db: Session, user: User, capsys: pytest.CaptureFixture[str]
) -> None:
    for _ in range(2):
        auth.login(db, POLICY, "ana@example.com", PASSWORD, "ip", FIXED_NOW)
    assert cli.run(["revoke-sessions", "--email", "ana@example.com"], db) == 0
    assert "2 sessão(ões) revogada(s)." in capsys.readouterr().out


def test_unknown_email_returns_error(db: Session) -> None:
    assert cli.run(["revoke-sessions", "--email", "ninguem@example.com"], db) == 1
