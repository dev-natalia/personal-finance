from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import Actor, AuditAction, AuditLog
from app.services import accounts
from app.services.context import RequestContext
from tests.support import make_account


def _audit(db: Session, entity_id: UUID) -> list[AuditLog]:
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.id))
    )


def test_create_account_quantizes_and_audits(db: Session, ctx: RequestContext) -> None:
    account = make_account(db, ctx, opening_balance="1000.5")
    assert account.opening_balance == Decimal("1000.50")
    [log] = _audit(db, account.id)
    assert log.action is AuditAction.CREATE
    assert log.actor is Actor.USER
    assert log.before is None
    assert log.after is not None
    assert log.after["opening_balance"] == "1000.50"
    assert log.after["name"] == "Itaú"


def test_negative_opening_balance_allowed(db: Session, ctx: RequestContext) -> None:
    assert make_account(db, ctx, opening_balance="-250.00").opening_balance == Decimal("-250.00")


def test_duplicate_name_conflicts(db: Session, ctx: RequestContext) -> None:
    make_account(db, ctx)
    with pytest.raises(Conflict) as exc:
        make_account(db, ctx)
    assert exc.value.code == "name_already_exists"


def test_same_name_allowed_for_other_user(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    make_account(db, ctx)
    make_account(db, other_ctx)


def test_update_account_records_before_and_after(db: Session, ctx: RequestContext) -> None:
    account = make_account(db, ctx)
    accounts.update_account(db, ctx, account.id, name="Itaú PF")
    log = _audit(db, account.id)[-1]
    assert log.action is AuditAction.UPDATE
    assert log.before is not None and log.before["name"] == "Itaú"
    assert log.after is not None and log.after["name"] == "Itaú PF"


def test_other_users_account_is_not_found(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    with pytest.raises(NotFound):
        accounts.update_account(db, ctx, foreign.id, name="Invasão")


def test_archive_is_idempotent_and_blocks_new_use(db: Session, ctx: RequestContext) -> None:
    account = make_account(db, ctx)
    first = accounts.archive_account(db, ctx, account.id)
    archived_at = first.account.archived_at
    assert archived_at is not None
    second = accounts.archive_account(db, ctx, account.id)
    assert second.account.archived_at == archived_at
    assert [log.action for log in _audit(db, account.id)].count(AuditAction.ARCHIVE) == 1
    with pytest.raises(RuleViolation) as exc:
        accounts.get_active_account(db, ctx, account.id)
    assert exc.value.code == "account_archived"


def test_list_hides_archived_by_default(db: Session, ctx: RequestContext) -> None:
    kept = make_account(db, ctx, name="Itaú")
    archived = make_account(db, ctx, name="Antiga")
    accounts.archive_account(db, ctx, archived.id)
    assert [a.id for a in accounts.list_accounts(db, ctx)] == [kept.id]
    assert len(accounts.list_accounts(db, ctx, include_archived=True)) == 2
