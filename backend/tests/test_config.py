import pytest
from pydantic import ValidationError

from app.config import Settings

VALID = {
    "database_url": "postgresql+psycopg://u:p@localhost:5433/db",
    "secret_key": "x" * 32,
    "app_origin": "https://financas.example.com",
}


def test_settings_load_with_required_values() -> None:
    settings = Settings(_env_file=None, **VALID)
    assert settings.cookie_secure is True
    assert settings.enable_docs is False
    assert settings.session_idle_days == 30
    assert settings.session_max_days == 90


def test_settings_require_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    values = {k: v for k, v in VALID.items() if k != "database_url"}
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_settings_reject_short_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{**VALID, "secret_key": "curta"})
