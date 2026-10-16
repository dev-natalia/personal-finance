"""Entradas absurdas ou maliciosas devem virar 422 (nunca 500), inclusive antes do login."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models import User


def _account(client: TestClient) -> str:
    response = client.post(
        "/api/v1/accounts",
        json={
            "name": "Itaú",
            "type": "CHECKING",
            "opening_balance": "1000.00",
            "opening_date": "2026-10-01",
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _expense(account_id: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": "EXPENSE",
        "amount": "42.00",
        "occurred_on": "2026-10-15",
        "description": "Mercado",
        "account_id": account_id,
        "payment_method": "PIX",
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize("month", ["0000-01", "1899-12", "2101-01"])
def test_month_outside_supported_range_is_422(auth_client: TestClient, month: str) -> None:
    response = auth_client.get("/api/v1/summaries/month", params={"month": month})
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_month"


@pytest.mark.parametrize("day", ["0001-01-01", "9999-12-31", "1899-12-31", "2101-01-01"])
def test_dates_outside_supported_range_are_422(auth_client: TestClient, day: str) -> None:
    account_id = _account(auth_client)
    checks = auth_client.post(
        "/api/v1/entry-checks",
        json={"items": [{"amount": "1.00", "merchant": "x", "occurred_on": day}]},
    )
    assert checks.status_code == 422
    created = auth_client.post(
        "/api/v1/transactions",
        json=_expense(account_id, occurred_on=day),
        headers={"Idempotency-Key": f"data-limite-{day}"},
    )
    assert created.status_code == 422
    listed = auth_client.get("/api/v1/transactions", params={"date_from": day})
    assert listed.status_code == 422
    balances = auth_client.get("/api/v1/accounts/balances", params={"as_of": day})
    assert balances.status_code == 422


def test_nul_byte_in_login_is_422_before_authentication(client: TestClient, user: User) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"email": "nul\u0000@example.com", "password": "x"}
    )
    assert response.status_code == 422


def test_nul_byte_in_body_is_422_and_in_search_is_harmless(auth_client: TestClient) -> None:
    account_id = _account(auth_client)
    created = auth_client.post(
        "/api/v1/transactions",
        json=_expense(account_id, description="Mer\u0000cado"),
        headers={"Idempotency-Key": "nul-0001"},
    )
    assert created.status_code == 422
    # Na busca, a normalização do nome já descarta o caractere: resposta normal, sem erro.
    search = auth_client.get("/api/v1/merchants", params={"q": "drog\u0000asil"})
    assert search.status_code == 200
    assert search.json() == []
