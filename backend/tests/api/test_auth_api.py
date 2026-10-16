import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import Settings
from app.domain.dates import Clock
from app.main import create_app
from app.models import User
from tests.api.conftest import ORIGIN, build_client, login
from tests.support import PASSWORD

PROBLEM = "application/problem+json"


def test_login_sets_secure_cookie(client: TestClient, user: User) -> None:
    response = login(client)
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "ana@example.com"
    assert "password_hash" not in body
    cookie = response.headers["set-cookie"].lower()
    for attribute in ("pf_session=", "httponly", "secure", "samesite=strict", "path=/"):
        assert attribute in cookie


def test_me_requires_session(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.headers["content-type"].startswith(PROBLEM)
    assert response.json()["code"] == "unauthenticated"


def test_me_with_session(auth_client: TestClient) -> None:
    response = auth_client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["timezone"] == "America/Sao_Paulo"


def test_wrong_password_then_rate_limit(client: TestClient, user: User) -> None:
    for _ in range(5):
        response = login(client, password="senha-errada-123")
        assert response.status_code == 401
        assert response.json()["code"] == "invalid_credentials"
    blocked = login(client)
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "too_many_attempts"


def test_logout_ends_session(auth_client: TestClient) -> None:
    assert auth_client.post("/api/v1/auth/logout").status_code == 204
    assert auth_client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example.com", "X-Requested-With": "fetch"},
        {"X-Requested-With": "fetch"},
        {"Origin": ORIGIN},
    ],
)
def test_unsafe_requests_require_origin_and_header(
    settings: Settings, db: Session, clock: Clock, user: User, headers: dict[str, str]
) -> None:
    app: FastAPI = create_app(settings, clock=clock)
    app.dependency_overrides[get_db] = lambda: db
    raw = TestClient(app, base_url=ORIGIN)
    response = raw.post(
        "/api/v1/auth/login",
        json={"email": "ana@example.com", "password": PASSWORD},
        headers=headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"


def test_security_headers_and_request_id(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    csp = response.headers["content-security-policy"]
    assert "default-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["strict-transport-security"].startswith("max-age=")
    assert len(response.headers["x-request-id"]) == 32


def test_validation_error_format(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": "ana@example.com"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert [error["field"] for error in body["errors"]] == ["password"]


def test_unknown_route_is_problem(client: TestClient) -> None:
    response = client.get("/api/v1/nao-existe")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith(PROBLEM)


def test_unexpected_error_is_problem_without_details(
    settings: Settings, db: Session, clock: Clock
) -> None:
    test_client = build_client(settings, db, clock, raise_server_exceptions=False)

    def boom() -> None:
        raise RuntimeError("segredo-interno")

    test_client.app.add_api_route("/api/v1/boom", boom)  # type: ignore[attr-defined]
    response = test_client.get("/api/v1/boom")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "segredo" not in response.text


def test_logs_do_not_contain_credentials(
    client: TestClient, user: User, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    login(client)
    assert PASSWORD not in caplog.text
    assert "ana@example.com" not in caplog.text
    assert "path=/api/v1/auth/login" in caplog.text


def test_uvicorn_access_log_is_disabled(settings: Settings, clock: Clock) -> None:
    """O log de acesso do uvicorn grava a query string (ex.: ?q=<estabelecimento>)."""
    create_app(settings, clock=clock)
    assert logging.getLogger("uvicorn.access").disabled
