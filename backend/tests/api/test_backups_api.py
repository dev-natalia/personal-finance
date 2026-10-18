from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import Settings
from app.domain.dates import FixedClock
from app.main import create_app
from app.models import BackupReport, User
from app.services.backups import backup_status, record_report
from tests.api.conftest import ORIGIN, login
from tests.support import FIXED_NOW

REPORT_URL = "/api/v1/internal/backup-report"
STATUS_URL = "/api/v1/backup-status"
TOKEN = "t" * 40
BODY = {"object_key": "daily/2026-10-15.sql.gz.age", "size_bytes": 12345}


def _machine_client(settings: Settings, db: Session) -> TestClient:
    """Como a máquina de backup chama: sem cookie, sem Origin, sem X-Requested-With."""
    app = create_app(settings, clock=FixedClock(FIXED_NOW))
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, base_url=ORIGIN)


@pytest.fixture
def machine(settings: Settings, db: Session) -> Iterator[TestClient]:
    configured = settings.model_copy(update={"backup_report_token": SecretStr(TOKEN)})
    with _machine_client(configured, db) as client:
        yield client


def _count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(BackupReport)) or 0


def test_backup_report_requires_the_configured_token(
    machine: TestClient, settings: Settings, db: Session
) -> None:
    assert machine.post(REPORT_URL, json=BODY).status_code == 401
    wrong = {"Authorization": "Bearer " + "x" * 40}
    assert machine.post(REPORT_URL, json=BODY, headers=wrong).status_code == 401
    with _machine_client(settings, db) as unconfigured:
        auth = {"Authorization": f"Bearer {TOKEN}"}
        assert unconfigured.post(REPORT_URL, json=BODY, headers=auth).status_code == 404
    assert _count(db) == 0


def test_backup_report_records_and_status_is_fresh(
    machine: TestClient, auth_client: TestClient, db: Session
) -> None:
    response = machine.post(REPORT_URL, json=BODY, headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 204, response.text
    report = db.scalars(select(BackupReport)).one()
    assert report.object_key == BODY["object_key"]
    assert report.size_bytes == 12345
    assert report.finished_at == FIXED_NOW
    assert auth_client.get(STATUS_URL).json() == {
        "last_success_at": "2026-10-15T15:00:00Z",
        "stale": False,
    }


def test_status_is_stale_after_two_days_and_when_never_run(db: Session) -> None:
    assert backup_status(db, FIXED_NOW).stale is True
    assert backup_status(db, FIXED_NOW).last_success_at is None
    record_report(db, "daily/a", 1, FIXED_NOW)
    assert backup_status(db, FIXED_NOW + timedelta(days=2)).stale is False
    stale = backup_status(db, FIXED_NOW + timedelta(days=2, minutes=1))
    assert stale.stale is True
    assert stale.last_success_at == FIXED_NOW


def test_backup_status_requires_login(client: TestClient, user: User) -> None:
    assert client.get(STATUS_URL).status_code == 401
    assert login(client).status_code == 200
    assert client.get(STATUS_URL).json() == {"last_success_at": None, "stale": True}


def test_csrf_still_guards_routes_outside_internal(machine: TestClient) -> None:
    response = machine.post(
        "/api/v1/misread-phrases", json={"text": "x", "reasons": ["NOTHING_PARSED"]}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"
