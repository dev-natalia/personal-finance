"""Categorias: lista padrão, consultas e regras de edição."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, CategoryKind

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
