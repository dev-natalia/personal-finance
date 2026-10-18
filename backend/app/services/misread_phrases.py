"""Frases não entendidas: guardadas para decidir, com uso real, se a IA faz falta."""

from collections.abc import Sequence
from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.errors import NotFound, RuleViolation
from app.models.misread_phrase import MisreadPhrase, MisreadReason
from app.services.context import RequestContext

MERGE_WINDOW = timedelta(minutes=10)
MAX_TEXT = 500


def record(
    session: Session, ctx: RequestContext, text: str, reasons: Sequence[MisreadReason]
) -> MisreadPhrase:
    """Guarda a frase; a mesma frase em menos de 10 minutos junta os motivos no registro."""
    cleaned = text.strip()[:MAX_TEXT]
    if not cleaned or not reasons:
        raise RuleViolation("invalid_misread_phrase", "Informe a frase e ao menos um motivo.")
    now = ctx.now()
    recent = session.scalar(
        select(MisreadPhrase)
        .where(
            MisreadPhrase.user_id == ctx.user_id,
            MisreadPhrase.text == cleaned,
            MisreadPhrase.updated_at > now - MERGE_WINDOW,
        )
        .order_by(MisreadPhrase.updated_at.desc())
        .limit(1)
        .with_for_update()
    )
    if recent is None:
        recent = MisreadPhrase(
            user_id=ctx.user_id,
            text=cleaned,
            reasons=sorted({str(r) for r in reasons}),
            created_at=now,
            updated_at=now,
        )
        session.add(recent)
    else:
        recent.reasons = sorted({*recent.reasons, *(str(r) for r in reasons)})
        recent.updated_at = now
    session.flush()
    return recent


def list_phrases(session: Session, ctx: RequestContext) -> list[MisreadPhrase]:
    stmt = (
        select(MisreadPhrase)
        .where(MisreadPhrase.user_id == ctx.user_id)
        .order_by(MisreadPhrase.updated_at.desc(), MisreadPhrase.id.desc())
    )
    return list(session.scalars(stmt))


def delete_phrase(session: Session, ctx: RequestContext, phrase_id: UUID) -> None:
    phrase = session.get(MisreadPhrase, phrase_id)
    if phrase is None or phrase.user_id != ctx.user_id:
        raise NotFound("a frase")
    session.delete(phrase)
    session.flush()


def delete_all(session: Session, ctx: RequestContext) -> int:
    deleted = session.scalars(
        delete(MisreadPhrase)
        .where(MisreadPhrase.user_id == ctx.user_id)
        .returning(MisreadPhrase.id)
        .execution_options(synchronize_session=False)
    ).all()
    session.expire_all()
    return len(deleted)
