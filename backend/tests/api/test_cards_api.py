from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import Settings
from app.domain.dates import FixedClock
from app.main import create_app
from app.models import User
from app.services.context import RequestContext
from tests.api.conftest import ORIGIN
from tests.support import make_card


def _card(client: TestClient, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Nubank",
        "credit_limit": "11000.00",
        "closing_day": 3,
        "due_day": 10,
        "opening_date": "2026-10-15",
    }
    body.update(overrides)
    response = client.post("/api/v1/cards", json=body)
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def _buy(client: TestClient, card_id: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": "EXPENSE",
        "amount": "1200.00",
        "occurred_on": "2026-10-15",
        "description": "celular",
        "card_id": card_id,
        "installments": 6,
    }
    body.update(overrides)
    response = client.post(
        "/api/v1/transactions", json=body, headers={"Idempotency-Key": f"k-{body['amount']}-x"}
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def _summary(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/v1/cards/summary")
    assert response.status_code == 200, response.text
    [summary] = response.json()
    return summary  # type: ignore[no-any-return]


def test_create_card_with_opening_state_and_read_summary(auth_client: TestClient) -> None:
    card = _card(
        auth_client,
        open_invoice_total="1240.00",
        closed_invoice={"total": "2380.00", "due_date": "2026-10-10"},
    )
    assert card["credit_limit"] == "11000.00"
    summary = _summary(auth_client)
    assert summary["card"]["id"] == card["id"]
    assert summary["open_invoice"]["reference_month"] == "2026-11-01"
    assert summary["open_invoice"]["closing_date"] == "2026-11-03"
    assert summary["open_invoice"]["total"] == "1240.00"
    assert summary["open_invoice"]["state"] == "OPEN"
    assert summary["payable"]["reference_month"] == "2026-10-01"
    assert summary["payable"]["balance"] == "2380.00"
    assert summary["limit"] == {"limit": "11000.00", "used": "3620.00", "available": "7380.00"}


def test_summary_shows_open_invoice_dates_before_any_purchase(auth_client: TestClient) -> None:
    _card(auth_client)
    opened = _summary(auth_client)["open_invoice"]
    assert opened["id"] is None
    assert (opened["reference_month"], opened["due_date"], opened["total"]) == (
        "2026-11-01",
        "2026-11-10",
        "0.00",
    )


def test_card_purchase_via_transactions_endpoint(auth_client: TestClient) -> None:
    card = _card(auth_client)
    tx = _buy(auth_client, card["id"])["transaction"]
    assert (tx["account_id"], tx["card_id"], tx["payment_method"], tx["installments"]) == (
        None,
        card["id"],
        "CREDIT",
        6,
    )
    # Valor de cada parcela (a sobra dos centavos fica na primeira).
    assert tx["installment_amount"] == "200.00"
    summary = _summary(auth_client)
    assert summary["open_invoice"]["total"] == "200.00"
    assert [(f["reference_month"], f["total"]) for f in summary["future"]][:2] == [
        ("2026-12-01", "200.00"),
        ("2027-01-01", "200.00"),
    ]
    listed = auth_client.get("/api/v1/transactions", params={"card_id": card["id"]}).json()
    assert [t["id"] for t in listed["items"]] == [tx["id"]]


def test_expense_needs_account_or_card(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/v1/transactions",
        json={
            "type": "EXPENSE",
            "amount": "42.00",
            "occurred_on": "2026-10-15",
            "description": "mercado",
        },
        headers={"Idempotency-Key": "sem-conta-1"},
    )
    assert response.status_code == 422
    [error] = response.json()["errors"]
    assert error["message"] == "informe a conta e o meio de pagamento, ou o cartão (não os dois)"
    assert response.json()["detail"] == (
        "Informe a conta e o meio de pagamento, ou o cartão (não os dois)."
    )


def test_expense_with_both_account_and_card_is_rejected(auth_client: TestClient) -> None:
    card = _card(auth_client)
    account = auth_client.post(
        "/api/v1/accounts",
        json={
            "name": "Itaú",
            "type": "CHECKING",
            "opening_balance": "100.00",
            "opening_date": "2026-10-01",
        },
    ).json()
    response = auth_client.post(
        "/api/v1/transactions",
        json={
            "type": "EXPENSE",
            "amount": "42.00",
            "occurred_on": "2026-10-15",
            "description": "mercado",
            "account_id": account["id"],
            "payment_method": "PIX",
            "card_id": card["id"],
        },
        headers={"Idempotency-Key": "os-dois-1"},
    )
    assert response.status_code == 422


def test_preview_does_not_write(auth_client: TestClient) -> None:
    card = _card(auth_client, open_invoice_total="1240.00")
    response = auth_client.post(
        f"/api/v1/cards/{card['id']}/preview",
        json={"amount": "1200.00", "installments": 6, "occurred_on": "2026-10-15"},
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["invoice"] == {
        "reference_month": "2026-11-01",
        "before": "1240.00",
        "after": "1440.00",
    }
    assert len(preview["following"]) == 5
    assert (preview["limit_before"], preview["limit_after"]) == ("9760.00", "8560.00")
    assert _summary(auth_client)["open_invoice"]["total"] == "1240.00"


def test_update_and_archive_card(auth_client: TestClient) -> None:
    card = _card(auth_client, open_invoice_total="100.00")
    patched = auth_client.patch(
        f"/api/v1/cards/{card['id']}", json={"name": "Nubank Ultravioleta", "credit_limit": "12000"}
    )
    assert patched.status_code == 200, patched.text
    assert (patched.json()["name"], patched.json()["credit_limit"]) == (
        "Nubank Ultravioleta",
        "12000.00",
    )
    archived = auth_client.post(f"/api/v1/cards/{card['id']}/archive")
    assert archived.status_code == 200
    assert [w["code"] for w in archived.json()["warnings"]] == ["archived_with_balance"]
    assert auth_client.get("/api/v1/cards").json() == []
    assert len(auth_client.get("/api/v1/cards", params={"include_archived": True}).json()) == 1


def test_invalid_card_fields_are_rejected(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/v1/cards",
        json={
            "name": "Nubank",
            "credit_limit": "0",
            "closing_day": 32,
            "due_day": 10,
            "opening_date": "2026-10-15",
        },
    )
    assert response.status_code == 422
    assert {e["field"] for e in response.json()["errors"]} == {"credit_limit", "closing_day"}


def test_charge_endpoint_replays(auth_client: TestClient) -> None:
    card = _card(auth_client)
    body = {"amount": "15.00", "occurred_on": "2026-10-15", "description": "IOF"}
    headers = {"Idempotency-Key": "encargo-api-1"}
    first = auth_client.post(f"/api/v1/cards/{card['id']}/charges", json=body, headers=headers)
    again = auth_client.post(f"/api/v1/cards/{card['id']}/charges", json=body, headers=headers)
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["transaction"]["type"] == "CHARGE"
    assert _summary(auth_client)["open_invoice"]["total"] == "15.00"


def test_entry_hints_include_cards_and_card_payment_options(auth_client: TestClient) -> None:
    card = _card(auth_client)
    _buy(auth_client, card["id"], installments=None, amount="38.00")
    hints = auth_client.get("/api/v1/entry-hints").json()
    assert hints["cards"] == [{"id": card["id"], "name": "Nubank"}]
    assert hints["top_payment_options"] == [
        {"account_id": None, "card_id": card["id"], "name": "Nubank", "payment_method": "CREDIT"}
    ]


def test_card_routes_require_csrf_headers(
    settings: Settings, db: Session, clock: FixedClock, user: User
) -> None:
    app = create_app(settings, clock=clock)
    app.dependency_overrides[get_db] = lambda: db
    raw = TestClient(app, base_url=ORIGIN)
    response = raw.post("/api/v1/cards", json={"name": "X"})
    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"


def test_other_user_cannot_read_or_change_the_card(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    other_card = make_card(db, other_ctx, name="Inter")
    assert (
        auth_client.patch(f"/api/v1/cards/{other_card.id}", json={"name": "x"}).status_code == 404
    )
    preview = auth_client.post(
        f"/api/v1/cards/{other_card.id}/preview",
        json={"amount": "10.00", "occurred_on": "2026-10-15"},
    )
    assert preview.status_code == 404
    assert auth_client.get(f"/api/v1/cards/{other_card.id}/invoices").status_code == 404


def test_preview_refuses_a_date_before_the_card_opening(auth_client: TestClient) -> None:
    """Mesma regra da gravação: a prévia não mostra o impacto de algo que será recusado."""
    card = _card(auth_client)
    response = auth_client.post(
        f"/api/v1/cards/{card['id']}/preview",
        json={"amount": "80.00", "occurred_on": "2026-01-02"},
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "purchase_before_card_opening"


def test_cycle_names_the_open_invoice_for_a_new_card(auth_client: TestClient) -> None:
    """Cadastro em 05/10, fecha 3, vence 10: outubro já fechou; a fatura aberta é a de novembro."""
    response = auth_client.get(
        "/api/v1/cards/cycle",
        params={"closing_day": 3, "due_day": 10, "opening_date": "2026-10-05"},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "open_reference_month": "2026-11-01",
        "open_closing_date": "2026-11-03",
        "open_due_date": "2026-11-10",
        "next_reference_month": "2026-12-01",
    }
    bad = auth_client.get("/api/v1/cards/cycle", params={"closing_day": 40, "due_day": 10})
    assert bad.status_code == 422


def test_opening_total_can_be_set_later(auth_client: TestClient) -> None:
    card = _card(auth_client)
    response = auth_client.put(
        f"/api/v1/cards/{card['id']}/opening-total", json={"amount": "1240.00"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["open_invoice"]["total"] == "1240.00"
    negative = auth_client.put(
        f"/api/v1/cards/{card['id']}/opening-total", json={"amount": "-1.00"}
    )
    assert negative.status_code == 422


def test_card_can_be_unarchived(auth_client: TestClient) -> None:
    card = _card(auth_client)
    auth_client.post(f"/api/v1/cards/{card['id']}/archive")
    response = auth_client.post(f"/api/v1/cards/{card['id']}/unarchive")
    assert response.status_code == 200, response.text
    assert response.json()["archived_at"] is None
    assert [c["id"] for c in auth_client.get("/api/v1/cards").json()] == [card["id"]]
