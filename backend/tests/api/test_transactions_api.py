from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain.dates import FixedClock
from app.models import User
from app.services.context import RequestContext
from tests.api.conftest import build_client, login
from tests.support import make_account


def _account(client: TestClient, name: str = "Itaú", opening: str = "1000.00") -> str:
    response = client.post(
        "/api/v1/accounts",
        json={
            "name": name,
            "type": "CHECKING",
            "opening_balance": opening,
            "opening_date": "2026-10-01",
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


@pytest.fixture
def itau_id(auth_client: TestClient) -> str:
    return _account(auth_client)


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


def _post(client: TestClient, body: dict[str, Any], key: str = "chave-api-0001") -> httpx.Response:
    return client.post("/api/v1/transactions", json=body, headers={"Idempotency-Key": key})


def test_create_expense(auth_client: TestClient, itau_id: str) -> None:
    response = _post(auth_client, _expense(itau_id))
    assert response.status_code == 201
    body = response.json()
    assert body["replayed"] is False
    assert body["warnings"] == []
    tx = body["transaction"]
    assert tx["amount"] == "42.00"
    assert tx["type"] == "EXPENSE"
    assert tx["status"] == "CONFIRMED"
    assert tx["category_id"] is not None


def test_replay_and_conflict(auth_client: TestClient, itau_id: str) -> None:
    first = _post(auth_client, _expense(itau_id))
    again = _post(auth_client, _expense(itau_id))
    assert again.status_code == 200
    assert again.json()["replayed"] is True
    assert again.json()["transaction"]["id"] == first.json()["transaction"]["id"]
    conflict = _post(auth_client, _expense(itau_id, amount="43.00"))
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "idempotency_key_reused"


def test_idempotency_key_is_required(auth_client: TestClient, itau_id: str) -> None:
    response = auth_client.post("/api/v1/transactions", json=_expense(itau_id))
    assert response.status_code == 422
    assert "Idempotency-Key" in [e["field"] for e in response.json()["errors"]]


@pytest.mark.parametrize(
    "override",
    [
        {"amount": "0"},
        {"amount": 42},
        {"amount": "42.001"},
        {"payment_method": "CHEQUE"},
        {"description": "   "},
        {"type": "TRANSFER"},
    ],
)
def test_invalid_bodies(auth_client: TestClient, itau_id: str, override: dict[str, Any]) -> None:
    response = _post(auth_client, _expense(itau_id, **override))
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_amount_too_large_is_422(auth_client: TestClient, itau_id: str) -> None:
    response = _post(auth_client, _expense(itau_id, amount="1000000000000.00"))
    assert response.status_code == 422


def test_rule_violation_is_422_with_code(auth_client: TestClient, itau_id: str) -> None:
    response = _post(auth_client, _expense(itau_id, occurred_on="2026-09-30"))
    assert response.status_code == 422
    assert response.json()["code"] == "date_before_account_opening"


def test_other_users_account_is_404(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    response = _post(auth_client, _expense(str(foreign.id)))
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_negative_balance_warning(auth_client: TestClient) -> None:
    account_id = _account(auth_client, "Carteira", "10.00")
    response = _post(auth_client, _expense(account_id))
    assert response.status_code == 201
    assert [w["code"] for w in response.json()["warnings"]] == ["negative_balance"]


def test_list_get_patch_void_flow(auth_client: TestClient, itau_id: str) -> None:
    ids = [
        _post(
            auth_client, _expense(itau_id, occurred_on=f"2026-10-0{day}"), key=f"chave-lista-{day}0"
        ).json()["transaction"]["id"]
        for day in (1, 2, 3)
    ]
    page = auth_client.get("/api/v1/transactions", params={"limit": 2}).json()
    assert [t["id"] for t in page["items"]] == [ids[2], ids[1]]
    assert page["next_cursor"]
    rest = auth_client.get(
        "/api/v1/transactions", params={"limit": 2, "cursor": page["next_cursor"]}
    ).json()
    assert [t["id"] for t in rest["items"]] == [ids[0]]
    assert rest["next_cursor"] is None

    assert auth_client.get(f"/api/v1/transactions/{ids[0]}").status_code == 200
    patched = auth_client.patch(
        f"/api/v1/transactions/{ids[0]}", json={"amount": "50.00", "notes": "corrigido"}
    )
    assert patched.status_code == 200
    assert patched.json()["transaction"]["amount"] == "50.00"
    not_editable = auth_client.patch(
        f"/api/v1/transactions/{ids[0]}", json={"destination_account_id": itau_id}
    )
    assert not_editable.status_code == 422
    assert not_editable.json()["code"] == "field_not_editable"

    voided = auth_client.post(f"/api/v1/transactions/{ids[0]}/void")
    assert voided.status_code == 200
    assert voided.json()["status"] == "VOIDED"
    assert len(auth_client.get("/api/v1/transactions").json()["items"]) == 2
    everything = auth_client.get("/api/v1/transactions", params={"status": "ALL"}).json()
    assert len(everything["items"]) == 3


def test_refund_flow(auth_client: TestClient, itau_id: str) -> None:
    tx_id = _post(auth_client, _expense(itau_id)).json()["transaction"]["id"]
    url = f"/api/v1/transactions/{tx_id}/refunds"
    refund = auth_client.post(
        url,
        json={"amount": "10.00", "occurred_on": "2026-10-15"},
        headers={"Idempotency-Key": "estorno-api-0001"},
    )
    assert refund.status_code == 201
    assert refund.json()["transaction"]["type"] == "REFUND"
    assert refund.json()["transaction"]["refund_of_id"] == tx_id
    too_much = auth_client.post(
        url,
        json={"amount": "40.00", "occurred_on": "2026-10-15"},
        headers={"Idempotency-Key": "estorno-api-0002"},
    )
    assert too_much.status_code == 422
    assert too_much.json()["code"] == "refund_exceeds_original"
    blocked = auth_client.post(f"/api/v1/transactions/{tx_id}/void")
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "has_active_refunds"


def test_transfer_keeps_totals(auth_client: TestClient, itau_id: str) -> None:
    nubank_id = _account(auth_client, "Nubank", "0.00")
    before = auth_client.get("/api/v1/accounts/balances").json()["total"]
    transfer = {
        "type": "TRANSFER",
        "amount": "300.00",
        "occurred_on": "2026-10-15",
        "description": "Reserva",
        "account_id": itau_id,
        "destination_account_id": nubank_id,
    }
    assert _post(auth_client, transfer).status_code == 201
    assert auth_client.get("/api/v1/accounts/balances").json()["total"] == before
    summary = auth_client.get("/api/v1/summaries/month", params={"month": "2026-10"}).json()
    assert summary["income"] == "0.00"
    assert summary["consumption_total"] == "0.00"


def test_month_summary(auth_client: TestClient, itau_id: str) -> None:
    _post(auth_client, _expense(itau_id))
    income = {
        "type": "INCOME",
        "amount": "3000.00",
        "occurred_on": "2026-10-05",
        "description": "Salário",
        "account_id": itau_id,
    }
    assert _post(auth_client, income, key="chave-receita-0001").status_code == 201
    body = auth_client.get("/api/v1/summaries/month", params={"month": "2026-10"}).json()
    assert body["month"] == "2026-10"
    assert body["income"] == "3000.00"
    assert body["consumption_total"] == "42.00"
    assert [(c["name"], c["amount"]) for c in body["by_category"]] == [("A classificar", "42.00")]
    invalid = auth_client.get("/api/v1/summaries/month", params={"month": "2026-13"})
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_month"


def test_entry_hints_and_checks(auth_client: TestClient, itau_id: str) -> None:
    _post(auth_client, _expense(itau_id, description="Drogasil"))
    hints = auth_client.get("/api/v1/entry-hints").json()
    assert hints["today"] == "2026-10-15"
    assert [a["name"] for a in hints["accounts"]] == ["Itaú"]
    assert "PIX" in hints["payment_methods"]
    assert hints["top_payment_options"][0] == {
        "account_id": itau_id,
        "account_name": "Itaú",
        "payment_method": "PIX",
    }
    checks = auth_client.post(
        "/api/v1/entry-checks",
        json={
            "items": [
                {"amount": "42.00", "merchant": "DROGASIL", "occurred_on": "2026-10-16"},
                {"amount": "42.00", "merchant": "Outro", "occurred_on": "2026-10-16"},
            ]
        },
    ).json()
    assert [len(r["possible_duplicates"]) for r in checks["results"]] == [1, 0]


def test_entry_hints_today_uses_user_timezone(settings: Settings, db: Session, user: User) -> None:
    late_night = FixedClock(datetime(2026, 10, 16, 2, 30, tzinfo=UTC))  # 23h30 em São Paulo
    with build_client(settings, db, late_night) as test_client:
        assert login(test_client).status_code == 200
        assert test_client.get("/api/v1/entry-hints").json()["today"] == "2026-10-15"
