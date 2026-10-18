from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from app.domain.dates import FixedClock
from app.domain.errors import NotFound, RuleViolation
from app.models.misread_phrase import MisreadReason
from app.services import misread_phrases
from app.services.context import RequestContext
from tests.support import FIXED_NOW

R = MisreadReason


def _at(ctx: RequestContext, minutes: int) -> RequestContext:
    return RequestContext(
        user_id=ctx.user_id,
        timezone=ctx.timezone,
        actor=ctx.actor,
        request_id=ctx.request_id,
        clock=FixedClock(FIXED_NOW + timedelta(minutes=minutes)),
    )


def test_records_a_phrase_with_its_reasons(db: Session, ctx: RequestContext) -> None:
    phrase = misread_phrases.record(
        db, ctx, "  42 mercado  ", [R.PENDING_PAYMENT_METHOD, R.PENDING_ACCOUNT]
    )
    assert phrase.text == "42 mercado"
    assert phrase.reasons == ["PENDING_ACCOUNT", "PENDING_PAYMENT_METHOD"]
    assert phrase.created_at == FIXED_NOW
    assert phrase.updated_at == FIXED_NOW


def test_same_phrase_within_ten_minutes_merges_reasons(db: Session, ctx: RequestContext) -> None:
    first = misread_phrases.record(db, ctx, "42 mercado", [R.PENDING_AMOUNT])
    later = _at(ctx, 9)
    second = misread_phrases.record(db, later, "42 mercado ", [R.CHANGED_DATE, R.PENDING_AMOUNT])
    assert second.id == first.id
    assert second.reasons == ["CHANGED_DATE", "PENDING_AMOUNT"]
    assert second.updated_at == FIXED_NOW + timedelta(minutes=9)
    assert [p.id for p in misread_phrases.list_phrases(db, ctx)] == [first.id]


def test_same_phrase_after_ten_minutes_is_a_new_record(db: Session, ctx: RequestContext) -> None:
    first = misread_phrases.record(db, ctx, "42 mercado", [R.PENDING_AMOUNT])
    second = misread_phrases.record(db, _at(ctx, 11), "42 mercado", [R.PENDING_AMOUNT])
    assert second.id != first.id
    assert len(misread_phrases.list_phrases(db, ctx)) == 2


@pytest.mark.parametrize(("text", "reasons"), [("   ", [R.NOTHING_PARSED]), ("abc", [])])
def test_empty_text_or_no_reasons_is_rejected(
    db: Session, ctx: RequestContext, text: str, reasons: list[MisreadReason]
) -> None:
    with pytest.raises(RuleViolation) as error:
        misread_phrases.record(db, ctx, text, reasons)
    assert error.value.code == "invalid_misread_phrase"


def test_lists_newest_first(db: Session, ctx: RequestContext) -> None:
    misread_phrases.record(db, ctx, "primeira", [R.NOTHING_PARSED])
    misread_phrases.record(db, _at(ctx, 1), "segunda", [R.NOTHING_PARSED])
    assert [p.text for p in misread_phrases.list_phrases(db, ctx)] == ["segunda", "primeira"]


def test_delete_one_and_delete_all(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    one = misread_phrases.record(db, ctx, "um", [R.NOTHING_PARSED])
    misread_phrases.record(db, ctx, "dois", [R.NOTHING_PARSED])
    misread_phrases.record(db, ctx, "três", [R.NOTHING_PARSED])
    foreign = misread_phrases.record(db, other_ctx, "dela", [R.NOTHING_PARSED])

    with pytest.raises(NotFound):
        misread_phrases.delete_phrase(db, ctx, foreign.id)
    misread_phrases.delete_phrase(db, ctx, one.id)
    assert {p.text for p in misread_phrases.list_phrases(db, ctx)} == {"dois", "três"}

    assert misread_phrases.delete_all(db, ctx) == 2
    assert misread_phrases.list_phrases(db, ctx) == []
    assert [p.text for p in misread_phrases.list_phrases(db, other_ctx)] == ["dela"]
