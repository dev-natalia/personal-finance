from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services.context import RequestContext
from app.services.merchants import resolve_merchant
from tests.support import find_category, make_account


def _create(client: TestClient, **overrides: Any) -> httpx.Response:
    body = {
        "name": "Itaú",
        "type": "CHECKING",
        "opening_balance": "1000.00",
        "opening_date": "2026-10-01",
    }
    body.update(overrides)
    return client.post("/api/v1/accounts", json=body)


def test_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/v1/accounts").status_code == 401


def test_create_and_list_accounts(auth_client: TestClient) -> None:
    response = _create(auth_client)
    assert response.status_code == 201
    body = response.json()
    assert body["opening_balance"] == "1000.00"
    assert body["archived_at"] is None
    assert [a["name"] for a in auth_client.get("/api/v1/accounts").json()] == ["Itaú"]


@pytest.mark.parametrize("amount", [1000.5, "1.005", "1000000000000.00", "abc", "1,50"])
def test_money_must_be_string_with_two_decimals(auth_client: TestClient, amount: Any) -> None:
    response = _create(auth_client, opening_balance=amount)
    assert response.status_code == 422
    assert [e["field"] for e in response.json()["errors"]] == ["opening_balance"]


def test_duplicate_name_conflict(auth_client: TestClient) -> None:
    _create(auth_client)
    response = _create(auth_client)
    assert response.status_code == 409
    assert response.json()["code"] == "name_already_exists"


def test_other_users_account_is_404(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    response = auth_client.patch(f"/api/v1/accounts/{foreign.id}", json={"name": "x"})
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_archive_warns_about_balance(auth_client: TestClient) -> None:
    account_id = _create(auth_client).json()["id"]
    response = auth_client.post(f"/api/v1/accounts/{account_id}/archive")
    assert response.status_code == 200
    body = response.json()
    assert body["account"]["archived_at"] is not None
    assert [w["code"] for w in body["warnings"]] == ["archived_with_balance"]
    assert auth_client.get("/api/v1/accounts").json() == []


def test_balances(auth_client: TestClient) -> None:
    _create(auth_client, name="Itaú", opening_balance="1000.00")
    _create(auth_client, name="Nubank", opening_balance="-50.25")
    body = auth_client.get("/api/v1/accounts/balances").json()
    assert body["as_of"] == "2026-10-15"
    assert body["total"] == "949.75"
    assert {a["name"]: a["balance"] for a in body["accounts"]} == {
        "Itaú": "1000.00",
        "Nubank": "-50.25",
    }


def test_categories_endpoints(auth_client: TestClient) -> None:
    listed = auth_client.get("/api/v1/categories").json()
    assert len(listed) == 19
    unclassified = next(
        c for c in listed if c["name"] == "A classificar" and c["kind"] == "EXPENSE"
    )
    locked = auth_client.patch(f"/api/v1/categories/{unclassified['id']}", json={"name": "Outros"})
    assert locked.status_code == 422
    assert locked.json()["code"] == "system_category_locked"

    created = auth_client.post("/api/v1/categories", json={"name": "Viagens", "kind": "EXPENSE"})
    assert created.status_code == 201
    assert created.json()["is_essential"] is False
    archived = auth_client.post(f"/api/v1/categories/{created.json()['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None

    expense_only = auth_client.get("/api/v1/categories", params={"kind": "EXPENSE"}).json()
    assert len(expense_only) == 14


def test_merchant_search(auth_client: TestClient, db: Session, ctx: RequestContext) -> None:
    saude = find_category(db, ctx, "Saúde")
    drogasil = resolve_merchant(db, ctx.user_id, "Drogasil")
    assert drogasil is not None
    drogasil.default_category_id = saude.id
    resolve_merchant(db, ctx.user_id, "Drogaria São Paulo")
    db.flush()

    exact = auth_client.get("/api/v1/merchants", params={"q": "DROGASIL"}).json()
    assert [m["name"] for m in exact] == ["Drogasil"]
    assert exact[0]["default_category_id"] == str(saude.id)
    partial = auth_client.get("/api/v1/merchants", params={"q": "drog"}).json()
    assert len(partial) == 2
