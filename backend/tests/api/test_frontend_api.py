"""O FastAPI serve o app compilado (SPA) na mesma origem da API."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain.dates import Clock
from app.main import create_app
from tests.api.conftest import build_client

INDEX = "<!doctype html><title>PF</title>"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX, encoding="utf-8")
    (root / "assets" / "app-123.js").write_text("console.log(1)", encoding="utf-8")
    (root / "sw.js").write_text("// sw", encoding="utf-8")
    return root


@pytest.fixture
def spa_client(settings: Settings, db: Session, clock: Clock, dist: Path) -> TestClient:
    return build_client(settings.model_copy(update={"frontend_dist": str(dist)}), db, clock)


def test_root_serves_index_without_cache(spa_client: TestClient) -> None:
    response = spa_client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache"
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.text == INDEX


def test_spa_route_serves_index(spa_client: TestClient) -> None:
    assert spa_client.get("/lancamentos").text == INDEX


def test_assets_are_immutable(spa_client: TestClient) -> None:
    response = spa_client.get("/assets/app-123.js")
    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]


def test_root_files_are_served(spa_client: TestClient) -> None:
    assert spa_client.get("/sw.js").text == "// sw"


def test_unknown_api_path_is_still_problem(spa_client: TestClient) -> None:
    response = spa_client.get("/api/v1/nao-existe")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_api_still_works(spa_client: TestClient) -> None:
    assert spa_client.get("/api/v1/health").json() == {"status": "ok"}


def test_path_traversal_is_not_served(spa_client: TestClient, dist: Path) -> None:
    (dist.parent / "segredo.txt").write_text("conteudo-secreto", encoding="utf-8")
    response = spa_client.get("/..%2Fsegredo.txt")
    assert "conteudo-secreto" not in response.text


def test_missing_index_fails_fast(settings: Settings, tmp_path: Path) -> None:
    empty = tmp_path / "vazio"
    empty.mkdir()
    with pytest.raises(RuntimeError):
        create_app(settings.model_copy(update={"frontend_dist": str(empty)}))
