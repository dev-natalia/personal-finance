from decimal import Decimal
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import PaymentMethod
from app.services import transactions
from app.services.context import RequestContext
from app.services.transactions import NewExpense
from tests.support import make_account, make_card


def _post(client: TestClient, url: str, body: dict[str, Any], key: str | None = None) -> Any:
    headers = {"Idempotency-Key": key} if key else {}
    response = client.post(url, json=body, headers=headers)
    assert response.status_code in (200, 201), response.text
    return response.json()


def _setup(client: TestClient) -> dict[str, str]:
    account = _post(
        client,
        "/api/v1/accounts",
        {
            "name": "Itaú",
            "type": "CHECKING",
            "opening_balance": "1000.00",
            "opening_date": "2026-09-01",
        },
    )
    card = _post(
        client,
        "/api/v1/cards",
        {
            "name": "Nubank",
            "credit_limit": "11000.00",
            "closing_day": 3,
            "due_day": 10,
            "opening_date": "2026-09-01",
        },
    )
    for amount, day, description in (
        ("30.00", "2026-10-09", "iFood"),
        ("42.00", "2026-10-15", "mercado"),
    ):
        _post(
            client,
            "/api/v1/transactions",
            {
                "type": "EXPENSE",
                "amount": amount,
                "occurred_on": day,
                "description": description,
                "account_id": account["id"],
                "payment_method": "PIX",
            },
            key=f"conta-{amount}",
        )
    _post(
        client,
        "/api/v1/transactions",
        {
            "type": "EXPENSE",
            "amount": "1200.00",
            "occurred_on": "2026-10-15",
            "description": "celular",
            "card_id": card["id"],
            "installments": 6,
        },
        key="celular-6x",
    )
    return {"account": account["id"], "card": card["id"]}


def test_summary_endpoint_returns_october(auth_client: TestClient) -> None:
    _setup(auth_client)
    body = auth_client.get("/api/v1/analysis/summary").json()
    assert body["period"] == {
        "kind": "month",
        "start": "2026-10-01",
        "end": "2026-10-31",
        "has_next": False,
    }
    assert body["total"] == "272.00"
    assert {p["name"]: (p["amount"], p["purchases"]) for p in body["by_place"]} == {
        "celular": ("200.00", 1),
        "mercado": ("42.00", 1),
        "iFood": ("30.00", 1),
    }
    assert body["by_day"] == [
        {"day": "2026-10-09", "amount": "30.00"},
        {"day": "2026-10-15", "amount": "242.00"},
    ]
    assert body["busiest"] == {"day": "2026-10-15", "amount": "242.00"}
    assert sum(Decimal(c["amount"]) for c in body["by_category"]) == Decimal("272.00")


def test_week_and_year_periods(auth_client: TestClient) -> None:
    _setup(auth_client)
    week = auth_client.get(
        "/api/v1/analysis/summary", params={"period": "week", "date": "2026-10-09"}
    ).json()
    assert (week["period"]["start"], week["period"]["end"], week["period"]["has_next"]) == (
        "2026-10-05",
        "2026-10-11",
        True,
    )
    assert week["total"] == "30.00"
    year = auth_client.get("/api/v1/analysis/summary", params={"period": "year"}).json()
    assert year["period"]["end"] == "2026-10-31"
    assert year["by_day"] == [{"day": "2026-10-01", "amount": "272.00"}]


def test_purchase_mode(auth_client: TestClient) -> None:
    _setup(auth_client)
    body = auth_client.get("/api/v1/analysis/summary", params={"mode": "purchase"}).json()
    assert body["total"] == "1272.00"


def test_source_and_category_filters(auth_client: TestClient) -> None:
    ids = _setup(auth_client)
    card = auth_client.get(
        "/api/v1/analysis/summary", params={"source": f"card:{ids['card']}"}
    ).json()
    assert card["total"] == "200.00"
    account = auth_client.get(
        "/api/v1/analysis/summary", params={"source": f"account:{ids['account']}"}
    ).json()
    assert account["total"] == "72.00"
    category_id = auth_client.get("/api/v1/analysis/summary").json()["by_category"][0][
        "category_id"
    ]
    filtered = auth_client.get(
        "/api/v1/analysis/summary", params={"category_id": category_id}
    ).json()
    assert filtered["total"] == "272.00"
    assert len(filtered["by_category"]) >= 1


def test_invalid_source_is_rejected(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    other_card = make_card(db, other_ctx, name="Inter")
    for source in ("card:abc", "conta:123", f"card:{other_card.id}"):
        response = auth_client.get("/api/v1/analysis/summary", params={"source": source})
        assert response.status_code == 422, source
        assert response.json()["code"] == "invalid_source"
    assert auth_client.get("/api/v1/analysis/summary", params={"period": "day"}).status_code == 422


def test_day_endpoint(auth_client: TestClient) -> None:
    _setup(auth_client)
    body = auth_client.get("/api/v1/analysis/day", params={"date": "2026-10-15"}).json()
    assert [(i["transaction"]["description"], i["amount"]) for i in body] == [
        ("celular", "200.00"),
        ("mercado", "42.00"),
    ]


def test_place_detail_and_transactions(auth_client: TestClient) -> None:
    _setup(auth_client)
    places = auth_client.get("/api/v1/analysis/summary").json()["by_place"]
    key = next(p["key"] for p in places if p["name"] == "iFood")
    detail = auth_client.get("/api/v1/analysis/place", params={"key": key}).json()
    assert detail["name"] == "iFood"
    assert detail["month"] == {"amount": "30.00", "purchases": 1}
    assert detail["week"] == {"amount": "0.00", "purchases": 0}
    assert detail["average"] == "30.00"
    page = auth_client.get("/api/v1/analysis/place/transactions", params={"key": key}).json()
    assert [t["amount"] for t in page["items"]] == ["30.00"]
    assert page["next_cursor"] is None


def test_other_users_place_is_not_found(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    account = make_account(db, other_ctx, "Itaú")
    tx = transactions.create_transaction(
        db,
        other_ctx,
        NewExpense(
            amount=Decimal("10.00"),
            occurred_on=account.opening_date,
            description="segredo",
            account_id=account.id,
            payment_method=PaymentMethod.PIX,
        ),
    ).transaction
    key = f"m:{tx.merchant_id}"
    assert auth_client.get("/api/v1/analysis/place", params={"key": key}).status_code == 404
    response = auth_client.get("/api/v1/analysis/place/transactions", params={"key": key})
    assert response.status_code == 404


def test_place_with_a_slash_in_its_name(auth_client: TestClient) -> None:
    """Encargo "IOF compra 1/2" (sem estabelecimento): a chave tem "/" e o lugar abre."""
    card = _setup(auth_client)["card"]
    _post(
        auth_client,
        f"/api/v1/cards/{card}/charges",
        {"amount": "3.50", "occurred_on": "2026-10-15", "description": "IOF compra 1/2"},
        key="iof-compra-1-2",
    )
    places = auth_client.get("/api/v1/analysis/summary").json()["by_place"]
    key = next(p["key"] for p in places if p["name"] == "IOF compra 1/2")
    assert key == "d:iof compra 1/2"
    detail = auth_client.get("/api/v1/analysis/place", params={"key": key})
    assert detail.status_code == 200, detail.text
    page = auth_client.get("/api/v1/analysis/place/transactions", params={"key": key}).json()
    assert [t["amount"] for t in page["items"]] == ["3.50"]
