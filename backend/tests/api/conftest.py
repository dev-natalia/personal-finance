from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import Settings
from app.domain.dates import Clock
from app.main import create_app
from app.models import User
from tests.conftest import TEST_DATABASE_URL
from tests.support import PASSWORD

ORIGIN = "https://testserver"
HEADERS = {"Origin": ORIGIN, "X-Requested-With": "fetch"}


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        database_url=TEST_DATABASE_URL,
        secret_key="k" * 40,
        app_origin=ORIGIN,
    )


def build_client(
    settings: Settings, db: Session, clock: Clock, *, raise_server_exceptions: bool = True
) -> TestClient:
    app = create_app(settings, clock=clock)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(
        app, base_url=ORIGIN, headers=HEADERS, raise_server_exceptions=raise_server_exceptions
    )


@pytest.fixture
def client(settings: Settings, db: Session, clock: Clock) -> Iterator[TestClient]:
    with build_client(settings, db, clock) as test_client:
        yield test_client


def login(
    client: TestClient, email: str = "ana@example.com", password: str = PASSWORD
) -> httpx.Response:
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


@pytest.fixture
def auth_client(client: TestClient, user: User) -> TestClient:
    response = login(client)
    assert response.status_code == 200, response.text
    return client
