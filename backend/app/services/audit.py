"""Registro de auditoria gravado na mesma transação da alteração."""

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.domain.money import to_api
from app.models import AuditAction, AuditLog, OwnedModel
from app.services.context import RequestContext

_EXCLUDED = frozenset({"idempotency_payload_hash"})


def jsonable(value: object) -> object:
    """Converte valores de coluna para tipos aceitos em JSON."""
    match value:
        case None:
            return None
        case Decimal():
            return to_api(value)
        case datetime() | date():
            return value.isoformat()
        case UUID():
            return str(value)
        case StrEnum():
            return value.value
        case bytes():
            return value.hex()
        case _:
            return value


def snapshot(entity: OwnedModel) -> dict[str, Any]:
    mapper = inspect(entity).mapper
    return {
        attr.key: jsonable(getattr(entity, attr.key))
        for attr in mapper.column_attrs
        if attr.key not in _EXCLUDED
    }


def record(
    session: Session,
    ctx: RequestContext,
    entity: OwnedModel,
    action: AuditAction,
    before: dict[str, Any] | None,
) -> None:
    session.flush()  # garante id e valores padrão antes do snapshot
    session.add(
        AuditLog(
            user_id=ctx.user_id,
            entity_type=str(type(entity).__tablename__),
            entity_id=entity.id,
            action=action,
            before=before,
            after=snapshot(entity),
            actor=ctx.actor,
            request_id=ctx.request_id,
        )
    )
