from uuid import UUID

from fastapi import APIRouter, Response

from app.api.deps import CtxDep, DbDep
from app.api.schemas.misread_phrases import MisreadPhraseIn, MisreadPhraseOut
from app.models.misread_phrase import MisreadPhrase
from app.services import misread_phrases

router = APIRouter(prefix="/misread-phrases", tags=["misread-phrases"])


@router.get("", response_model=list[MisreadPhraseOut])
def list_phrases(ctx: CtxDep, db: DbDep) -> list[MisreadPhrase]:
    return misread_phrases.list_phrases(db, ctx)


@router.post("", status_code=201, response_model=MisreadPhraseOut)
def record_phrase(body: MisreadPhraseIn, ctx: CtxDep, db: DbDep) -> MisreadPhrase:
    phrase = misread_phrases.record(db, ctx, body.text, body.reasons)
    db.commit()
    return phrase


@router.delete("/{phrase_id}", status_code=204)
def delete_phrase(phrase_id: UUID, ctx: CtxDep, db: DbDep) -> Response:
    misread_phrases.delete_phrase(db, ctx, phrase_id)
    db.commit()
    return Response(status_code=204)


@router.delete("", status_code=204)
def delete_all(ctx: CtxDep, db: DbDep) -> Response:
    misread_phrases.delete_all(db, ctx)
    db.commit()
    return Response(status_code=204)
