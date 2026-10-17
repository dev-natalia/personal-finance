"""Categorias: lista padrão, consultas e regras de edição."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, RuleViolation
from app.models import AuditAction, Category, CategoryKind
from app.repositories import get_owned, owned_select
from app.services.audit import record, snapshot
from app.services.context import RequestContext

UNCLASSIFIED = "A classificar"
FINANCIAL_CHARGES = "Encargos financeiros"

# (nome, essencial)
DEFAULT_EXPENSE_CATEGORIES: tuple[tuple[str, bool], ...] = (
    ("Alimentação", False),
    ("Mercado", False),
    ("Transporte", False),
    ("Moradia", True),
    ("Contas da casa", True),
    ("Saúde", True),
    ("Pets", True),
    ("Assinaturas", False),
    ("Compras diversas", False),
    ("Lazer", False),
    ("Hábitos pessoais", False),
    ("Educação", False),
)
DEFAULT_INCOME_CATEGORIES: tuple[str, ...] = (
    "Salário",
    "13º salário",
    "Receitas extras",
    "Reembolsos",
)


def seed_default_categories(session: Session, user_id: UUID) -> None:
    expense = CategoryKind.EXPENSE
    income = CategoryKind.INCOME
    rows = [
        Category(user_id=user_id, name=name, kind=expense, is_essential=essential)
        for name, essential in DEFAULT_EXPENSE_CATEGORIES
    ]
    rows += [
        Category(user_id=user_id, name=name, kind=income) for name in DEFAULT_INCOME_CATEGORIES
    ]
    rows += [
        Category(user_id=user_id, name=UNCLASSIFIED, kind=expense, is_system=True),
        Category(user_id=user_id, name=FINANCIAL_CHARGES, kind=expense, is_system=True),
        Category(user_id=user_id, name=UNCLASSIFIED, kind=income, is_system=True),
    ]
    session.add_all(rows)
    session.flush()


def get_unclassified(session: Session, user_id: UUID, kind: CategoryKind) -> Category:
    return session.scalars(
        select(Category).where(
            Category.user_id == user_id,
            Category.kind == kind,
            Category.is_system.is_(True),
            Category.name == UNCLASSIFIED,
        )
    ).one()


def get_financial_charges(session: Session, user_id: UUID) -> Category:
    """Categoria de sistema dos juros, multas e IOF do cartão."""
    return session.scalars(
        select(Category).where(
            Category.user_id == user_id,
            Category.kind == CategoryKind.EXPENSE,
            Category.is_system.is_(True),
            Category.name == FINANCIAL_CHARGES,
        )
    ).one()


def list_categories(
    session: Session,
    ctx: RequestContext,
    *,
    kind: CategoryKind | None = None,
    include_archived: bool = False,
) -> list[Category]:
    stmt = owned_select(Category, ctx.user_id).order_by(Category.kind, Category.name)
    if kind is not None:
        stmt = stmt.where(Category.kind == kind)
    if not include_archived:
        stmt = stmt.where(Category.archived_at.is_(None))
    return list(session.scalars(stmt))


def get_active_category(
    session: Session, ctx: RequestContext, category_id: UUID, kind: CategoryKind
) -> Category:
    category = get_owned(session, Category, category_id, ctx.user_id, "a categoria")
    if category.kind is not kind:
        raise RuleViolation(
            "category_kind_mismatch", "A categoria não é do tipo esperado (despesa ou receita)."
        )
    if category.archived_at is not None:
        raise RuleViolation("category_archived", f"A categoria {category.name} está arquivada.")
    return category


def _ensure_unique(
    session: Session,
    user_id: UUID,
    kind: CategoryKind,
    name: str,
    exclude_id: UUID | None = None,
) -> None:
    stmt = select(Category.id).where(
        Category.user_id == user_id, Category.kind == kind, Category.name == name
    )
    if exclude_id is not None:
        stmt = stmt.where(Category.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise Conflict("name_already_exists", "Já existe uma categoria com esse nome.")


def _ensure_not_system(category: Category) -> None:
    if category.is_system:
        raise RuleViolation(
            "system_category_locked",
            "Categorias do sistema não podem ser renomeadas nem arquivadas.",
        )


def create_category(
    session: Session,
    ctx: RequestContext,
    *,
    name: str,
    kind: CategoryKind,
    is_essential: bool = False,
) -> Category:
    _ensure_unique(session, ctx.user_id, kind, name)
    category = Category(user_id=ctx.user_id, name=name, kind=kind, is_essential=is_essential)
    session.add(category)
    record(session, ctx, category, AuditAction.CREATE, before=None)
    return category


def update_category(
    session: Session,
    ctx: RequestContext,
    category_id: UUID,
    *,
    name: str | None = None,
    is_essential: bool | None = None,
) -> Category:
    category = get_owned(session, Category, category_id, ctx.user_id, "a categoria")
    before = snapshot(category)
    if name is not None and name != category.name:
        _ensure_not_system(category)
        _ensure_unique(session, ctx.user_id, category.kind, name, exclude_id=category.id)
        category.name = name
    if is_essential is not None:
        category.is_essential = is_essential
    record(session, ctx, category, AuditAction.UPDATE, before)
    return category


def archive_category(session: Session, ctx: RequestContext, category_id: UUID) -> Category:
    category = get_owned(session, Category, category_id, ctx.user_id, "a categoria")
    _ensure_not_system(category)
    if category.archived_at is not None:
        return category
    before = snapshot(category)
    category.archived_at = ctx.now()
    record(session, ctx, category, AuditAction.ARCHIVE, before)
    return category
