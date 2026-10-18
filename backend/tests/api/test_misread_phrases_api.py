from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.misread_phrase import MisreadReason
from app.services import misread_phrases
from app.services.context import RequestContext

URL = "/api/v1/misread-phrases"


def test_requires_authentication(client: TestClient) -> None:
    assert client.get(URL).status_code == 401


def test_misread_phrases_endpoints(auth_client: TestClient) -> None:
    created = auth_client.post(
        URL, json={"text": "energético nubank", "reasons": ["PENDING_AMOUNT"]}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["text"] == "energético nubank"
    assert body["reasons"] == ["PENDING_AMOUNT"]
    assert {"id", "created_at", "updated_at"} <= body.keys()

    auth_client.post(URL, json={"text": "xyz", "reasons": ["NOTHING_PARSED"]})
    # Mesmo instante no relógio fixo: o desempate é a ordem de criação.
    assert [p["text"] for p in auth_client.get(URL).json()] == ["xyz", "energético nubank"]

    assert auth_client.delete(f"{URL}/{body['id']}").status_code == 204
    assert [p["text"] for p in auth_client.get(URL).json()] == ["xyz"]
    assert auth_client.delete(URL).status_code == 204
    assert auth_client.get(URL).json() == []


def test_other_user_cannot_see_or_delete_phrases(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    foreign = misread_phrases.record(db, other_ctx, "dela", [MisreadReason.NOTHING_PARSED])
    assert auth_client.get(URL).json() == []
    response = auth_client.delete(f"{URL}/{foreign.id}")
    assert response.status_code == 404
    assert auth_client.delete(URL).status_code == 204
    assert [p.text for p in misread_phrases.list_phrases(db, other_ctx)] == ["dela"]


def test_invalid_reason_is_rejected(auth_client: TestClient) -> None:
    response = auth_client.post(URL, json={"text": "abc", "reasons": ["WHATEVER"]})
    assert response.status_code == 422
