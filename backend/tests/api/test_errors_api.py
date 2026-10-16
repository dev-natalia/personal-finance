"""Erros fora das regras de negócio também seguem o padrão em português (consumido pelo frontend)."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain.dates import Clock
from app.models import User
from tests.api.conftest import build_client

JSON = {"Content-Type": "application/json"}


def test_unknown_route_is_not_found_in_portuguese(client: TestClient) -> None:
    response = client.get("/api/v1/nao-existe")
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "not_found"
    assert body["detail"] == "Endereço não encontrado."


def test_wrong_method_is_method_not_allowed(client: TestClient) -> None:
    response = client.post("/api/v1/health")
    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"


def test_body_not_utf8_is_invalid_body(client: TestClient, user: User) -> None:
    response = client.post(
        "/api/v1/auth/login",
        content=b'{"email": "\xff@x.com", "password": "x"}',
        headers=JSON,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_body"


def test_malformed_json_is_invalid_body(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", content=b'{"email": ', headers=JSON)
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "invalid_body"
    assert "errors" not in body


def test_union_field_path_has_no_type_tag(auth_client: TestClient) -> None:
    account = auth_client.post(
        "/api/v1/accounts",
        json={
            "name": "Itaú",
            "type": "CHECKING",
            "opening_balance": "1000.00",
            "opening_date": "2026-10-01",
        },
    ).json()
    response = auth_client.post(
        "/api/v1/transactions",
        json={
            "type": "EXPENSE",
            "amount": "42.00",
            "occurred_on": "2026-10-15",
            "description": "Mercado",
            "account_id": account["id"],
        },
        headers={"Idempotency-Key": "sem-meio-0001"},
    )
    assert response.status_code == 422
    assert [e["field"] for e in response.json()["errors"]] == ["payment_method"]


def test_server_error_keeps_request_id_and_security_headers(
    settings: Settings, db: Session, clock: Clock
) -> None:
    test_client = build_client(settings, db, clock, raise_server_exceptions=False)

    def boom() -> None:
        raise RuntimeError("falha")

    test_client.app.add_api_route("/api/v1/boom", boom)  # type: ignore[attr-defined]
    response = test_client.get("/api/v1/boom")
    assert response.status_code == 500
    assert len(response.headers["x-request-id"]) == 32
    assert "default-src 'self'" in response.headers["content-security-policy"]
