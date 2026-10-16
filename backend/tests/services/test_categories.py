import pytest
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, RuleViolation
from app.models import CategoryKind
from app.services import categories
from app.services.context import RequestContext
from tests.support import find_category


def test_list_default_categories(db: Session, ctx: RequestContext) -> None:
    assert len(categories.list_categories(db, ctx)) == 19
    assert len(categories.list_categories(db, ctx, kind=CategoryKind.EXPENSE)) == 14


def test_create_and_duplicate(db: Session, ctx: RequestContext) -> None:
    created = categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    assert created.is_essential is False
    with pytest.raises(Conflict):
        categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.INCOME)


def test_system_category_cannot_be_renamed_or_archived(db: Session, ctx: RequestContext) -> None:
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    with pytest.raises(RuleViolation) as exc:
        categories.update_category(db, ctx, unclassified.id, name="Outros")
    assert exc.value.code == "system_category_locked"
    with pytest.raises(RuleViolation):
        categories.archive_category(db, ctx, unclassified.id)


def test_system_category_essential_flag_can_change(db: Session, ctx: RequestContext) -> None:
    charges = find_category(db, ctx, "Encargos financeiros")
    assert categories.update_category(db, ctx, charges.id, is_essential=True).is_essential


def test_get_active_category_checks_kind_and_archive(db: Session, ctx: RequestContext) -> None:
    salary = find_category(db, ctx, "Salário", CategoryKind.INCOME)
    with pytest.raises(RuleViolation) as exc:
        categories.get_active_category(db, ctx, salary.id, CategoryKind.EXPENSE)
    assert exc.value.code == "category_kind_mismatch"

    trips = categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    categories.archive_category(db, ctx, trips.id)
    with pytest.raises(RuleViolation) as exc:
        categories.get_active_category(db, ctx, trips.id, CategoryKind.EXPENSE)
    assert exc.value.code == "category_archived"
