from uuid import UUID

from fastapi import APIRouter

from app.api.deps import CtxDep, DbDep
from app.api.schemas.categories import CategoryIn, CategoryOut, CategoryPatch
from app.models import Category, CategoryKind
from app.services import categories

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(
    ctx: CtxDep, db: DbDep, kind: CategoryKind | None = None, include_archived: bool = False
) -> list[Category]:
    return categories.list_categories(db, ctx, kind=kind, include_archived=include_archived)


@router.post("", status_code=201, response_model=CategoryOut)
def create_category(body: CategoryIn, ctx: CtxDep, db: DbDep) -> Category:
    category = categories.create_category(
        db, ctx, name=body.name, kind=body.kind, is_essential=body.is_essential
    )
    db.commit()
    return category


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(category_id: UUID, body: CategoryPatch, ctx: CtxDep, db: DbDep) -> Category:
    category = categories.update_category(
        db, ctx, category_id, name=body.name, is_essential=body.is_essential
    )
    db.commit()
    return category


@router.post("/{category_id}/archive", response_model=CategoryOut)
def archive_category(category_id: UUID, ctx: CtxDep, db: DbDep) -> Category:
    category = categories.archive_category(db, ctx, category_id)
    db.commit()
    return category
