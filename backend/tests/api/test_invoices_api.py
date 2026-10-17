from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Invoice
from app.services import transactions
from app.services.context import RequestContext
from app.services.transactions import NewCardExpense
from tests.support import make_card


def _post(client: TestClient, url: str, body: dict[str, Any], key: str | None = None) -> Any:
    headers = {"Idempotency-Key": key} if key else {}
    response = client.post(url, json=body, headers=headers)
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.fixture
def setup(auth_client: TestClient) -> dict[str, str]:
    """Nubank desde setembro; compra de R$ 300 em 20/09 na fatura de outubro (já fechada)."""
    card = _post(
        auth_client,
        "/api/v1/cards",
        {
            "name": "Nubank",
            "credit_limit": "11000.00",
            "closing_day": 3,
            "due_day": 10,
            "opening_date": "2026-09-01",
        },
    )
    accounts = {}
    for name, opening in (("Itaú", "5000.00"), ("Poupança", "1000.00")):
        accounts[name] = _post(
            auth_client,
            "/api/v1/accounts",
            {
                "name": name,
                "type": "CHECKING",
                "opening_balance": opening,
                "opening_date": "2026-09-01",
            },
        )["id"]
    purchase = _post(
        auth_client,
        "/api/v1/transactions",
        {
            "type": "EXPENSE",
            "amount": "300.00",
            "occurred_on": "2026-09-20",
            "description": "mercado",
            "card_id": card["id"],
        },
        key="compra-setembro",
    )
    summary = auth_client.get("/api/v1/cards/summary").json()[0]
    return {
        "card": card["id"],
        "itau": accounts["Itaú"],
        "savings": accounts["Poupança"],
        "october": summary["payable"]["id"],
        "purchase": purchase["transaction"]["id"],
    }


def _pay(client: TestClient, setup: dict[str, str], body: dict[str, Any], key: str) -> Any:
    response = client.post(
        f"/api/v1/invoices/{setup['october']}/payments",
        json=body,
        headers={"Idempotency-Key": key},
    )
    return response


def test_pay_invoice_with_two_sources_and_carry_over(
    auth_client: TestClient, setup: dict[str, str]
) -> None:
    response = _pay(
        auth_client,
        setup,
        {
            "occurred_on": "2026-10-15",
            "sources": [
                {"account_id": setup["itau"], "amount": "100.00"},
                {"account_id": setup["savings"], "amount": "20.00"},
            ],
            "remainder": "CARRY_OVER",
        },
        "pagar-outubro-1",
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert len(result["payments"]) == 2
    assert result["charge"] is None
    assert {p["payment_group_id"] for p in result["payments"]} == {result["group_id"]}
    summary = auth_client.get("/api/v1/cards/summary").json()[0]
    assert summary["payable"] is None
    assert summary["open_invoice"]["total"] == "180.00"


def test_payment_with_installment_plan_returns_the_charge(
    auth_client: TestClient, setup: dict[str, str]
) -> None:
    response = _pay(
        auth_client,
        setup,
        {
            "occurred_on": "2026-10-15",
            "sources": [{"account_id": setup["itau"], "amount": "120.00"}],
            "remainder": {"installments": 3, "installment_amount": "65.00"},
        },
        "pagar-outubro-2",
    )
    assert response.status_code == 201, response.text
    assert response.json()["charge"]["amount"] == "15.00"


def test_payment_replay_returns_200(auth_client: TestClient, setup: dict[str, str]) -> None:
    body = {
        "occurred_on": "2026-10-15",
        "sources": [{"account_id": setup["itau"], "amount": "300.00"}],
    }
    first = _pay(auth_client, setup, body, "pagar-outubro-3")
    again = _pay(auth_client, setup, body, "pagar-outubro-3")
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["replayed"] is True
    assert again.json()["group_id"] == first.json()["group_id"]


def test_payment_above_balance_returns_422(auth_client: TestClient, setup: dict[str, str]) -> None:
    response = _pay(
        auth_client,
        setup,
        {"occurred_on": "2026-10-15", "sources": [{"account_id": setup["itau"], "amount": "301"}]},
        "pagar-outubro-4",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invoice_payment_exceeds_balance"


def test_invoice_detail_lists_items_with_labels(
    auth_client: TestClient, setup: dict[str, str]
) -> None:
    _pay(
        auth_client,
        setup,
        {
            "occurred_on": "2026-10-15",
            "sources": [{"account_id": setup["itau"], "amount": "120.00"}],
            "remainder": "CARRY_OVER",
        },
        "pagar-outubro-5",
    )
    _post(
        auth_client,
        "/api/v1/transactions",
        {
            "type": "EXPENSE",
            "amount": "1200.00",
            "occurred_on": "2026-10-15",
            "description": "celular",
            "card_id": setup["card"],
            "installments": 6,
        },
        key="celular-6x",
    )
    november = auth_client.get("/api/v1/cards/summary").json()[0]["open_invoice"]
    detail = auth_client.get(f"/api/v1/invoices/{november['id']}").json()
    lines = [
        (i["description"], i["amount"], i["installment_number"], i["installment_count"])
        for i in detail["items"]
    ]
    assert ("Saldo da fatura de outubro", "180.00", None, None) in lines
    assert ("celular", "200.00", 1, 6) in lines
    assert detail["invoice"]["total"] == "380.00"
    october = auth_client.get(f"/api/v1/invoices/{setup['october']}").json()
    assert [p["amount"] for p in october["payments"]] == ["120.00"]
    assert october["invoice"]["state"] == "PAID"
    assert october["adjustments"] == [
        {"description": "Levado para a fatura de novembro", "amount": "180.00"}
    ]
    assert detail["adjustments"] == []


def test_card_invoices_lists_open_future_and_previous(
    auth_client: TestClient, setup: dict[str, str]
) -> None:
    page = auth_client.get(f"/api/v1/cards/{setup['card']}/invoices").json()
    assert page["open"]["reference_month"] == "2026-11-01"
    assert [p["reference_month"] for p in page["previous"]] == ["2026-10-01"]
    assert page["future"] == []
    assert page["next_before"] is None


def test_reported_total_shows_the_difference(
    auth_client: TestClient, setup: dict[str, str]
) -> None:
    response = auth_client.patch(
        f"/api/v1/invoices/{setup['october']}", json={"reported_total": "380.00"}
    )
    assert response.status_code == 200, response.text
    payable = auth_client.get("/api/v1/cards/summary").json()[0]["payable"]
    assert (payable["reported_total"], payable["difference"]) == ("380.00", "80.00")
    cleared = auth_client.patch(
        f"/api/v1/invoices/{setup['october']}", json={"reported_total": None}
    ).json()
    assert cleared["reported_total"] is None


def test_void_payment_group(auth_client: TestClient, setup: dict[str, str]) -> None:
    paid = _pay(
        auth_client,
        setup,
        {"occurred_on": "2026-10-15", "sources": [{"account_id": setup["itau"], "amount": "300"}]},
        "pagar-outubro-6",
    ).json()
    response = auth_client.post(f"/api/v1/payment-groups/{paid['group_id']}/void")
    assert response.status_code == 200, response.text
    assert {p["status"] for p in response.json()["payments"]} == {"VOIDED"}
    assert auth_client.get("/api/v1/cards/summary").json()[0]["payable"]["balance"] == "300.00"


def test_void_purchase_in_closed_invoice_returns_422(
    auth_client: TestClient, setup: dict[str, str]
) -> None:
    response = auth_client.post(f"/api/v1/transactions/{setup['purchase']}/void")
    assert response.status_code == 422
    assert response.json()["code"] == "void_blocked_by_closed_invoice"
    assert response.json()["detail"] == (
        "Esta compra já está em fatura fechada. Registre um estorno."
    )


def test_other_user_cannot_read_or_pay_the_invoice(
    auth_client: TestClient, db: Session, other_ctx: RequestContext, setup: dict[str, str]
) -> None:
    other = make_card(db, other_ctx, name="Inter", opening_date=date(2026, 9, 1))
    transactions.create_transaction(
        db,
        other_ctx,
        NewCardExpense(
            amount=Decimal("10.00"),
            occurred_on=date(2026, 10, 15),
            description="x",
            card_id=other.id,
        ),
    )
    invoice_id = db.scalars(select(Invoice.id).where(Invoice.card_id == other.id)).one()
    assert auth_client.get(f"/api/v1/invoices/{invoice_id}").status_code == 404
    response = auth_client.post(
        f"/api/v1/invoices/{invoice_id}/payments",
        json={
            "occurred_on": "2026-10-15",
            "sources": [{"account_id": setup["itau"], "amount": "1"}],
        },
        headers={"Idempotency-Key": "alheia-1"},
    )
    assert response.status_code == 404
