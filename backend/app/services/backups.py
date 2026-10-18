"""Registro dos backups concluídos e o aviso de backup atrasado."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import BackupReport

STALE_AFTER = timedelta(days=2)


@dataclass(frozen=True)
class BackupStatus:
    last_success_at: datetime | None
    stale: bool


def record_report(
    session: Session, object_key: str, size_bytes: int, finished_at: datetime
) -> BackupReport:
    report = BackupReport(object_key=object_key, size_bytes=size_bytes, finished_at=finished_at)
    session.add(report)
    session.flush()
    return report


def backup_status(session: Session, now: datetime) -> BackupStatus:
    last = session.scalar(select(func.max(BackupReport.finished_at)))
    return BackupStatus(last_success_at=last, stale=last is None or now - last > STALE_AFTER)
