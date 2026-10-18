import hmac
from datetime import datetime

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.api.deps import ClockDep, CtxDep, DbDep, SettingsDep
from app.domain.errors import NotFound, Unauthenticated
from app.services import backups

router = APIRouter(tags=["backups"])


class BackupReportIn(BaseModel):
    object_key: str = Field(min_length=1, max_length=300)
    size_bytes: int = Field(ge=0)


class BackupStatusOut(BaseModel):
    last_success_at: datetime | None
    stale: bool


@router.post("/internal/backup-report", status_code=204)
def report_backup(
    body: BackupReportIn, request: Request, db: DbDep, settings: SettingsDep, clock: ClockDep
) -> Response:
    """Chamado pela máquina de backup, com o token dela; sem sessão nem cookie."""
    if settings.backup_report_token is None:
        raise NotFound("a rota")
    expected = f"Bearer {settings.backup_report_token.get_secret_value()}".encode()
    given = request.headers.get("authorization", "").encode()
    if not hmac.compare_digest(given, expected):
        raise Unauthenticated("invalid_backup_token", "Token do backup inválido.")
    backups.record_report(db, body.object_key, body.size_bytes, clock.now())
    db.commit()
    return Response(status_code=204)


@router.get("/backup-status", response_model=BackupStatusOut)
def backup_status(ctx: CtxDep, db: DbDep) -> backups.BackupStatus:
    return backups.backup_status(db, ctx.now())
