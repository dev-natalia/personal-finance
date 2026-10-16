import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import Category, CategoryKind
from app.repositories import get_owned
from app.services.audit import snapshot
from app.services.users import create_user, set_password, verify_password
from tests.support import PASSWORD


def test_create_user_normalizes_email_and_hashes_password(db: Session) -> None:
    user = create_user(db, "  Ana@Example.COM ", PASSWORD)
    assert user.email == "ana@example.com"
    assert user.password_hash != PASSWORD
    assert verify_password(PASSWORD, user.password_hash)
    assert not verify_password("outra-senha-qualquer", user.password_hash)


def test_create_user_seeds_default_categories(db: Session) -> None:
    user = create_user(db, "ana@example.com", PASSWORD)
    categories = db.scalars(select(Category).where(Category.user_id == user.id)).all()
    expense = {c.name for c in categories if c.kind is CategoryKind.EXPENSE}
    income = {c.name for c in categories if c.kind is CategoryKind.INCOME}
    assert len(expense) == 14
    assert {"A classificar", "Encargos financeiros", "Mercado", "Saúde"} <= expense
    assert income == {"Salário", "13º salário", "Receitas extras", "Reembolsos", "A classificar"}
    assert {c.name for c in categories if c.is_essential} == {
        "Moradia",
        "Contas da casa",
        "Saúde",
        "Pets",
    }
    assert {(c.name, c.kind) for c in categories if c.is_system} == {
        ("A classificar", CategoryKind.EXPENSE),
        ("Encargos financeiros", CategoryKind.EXPENSE),
        ("A classificar", CategoryKind.INCOME),
    }


def test_duplicate_email_conflicts(db: Session) -> None:
    create_user(db, "ana@example.com", PASSWORD)
    with pytest.raises(Conflict) as exc:
        create_user(db, "ANA@example.com", PASSWORD)
    assert exc.value.code == "email_already_exists"


@pytest.mark.parametrize(
    ("email", "password", "timezone", "code"),
    [
        ("ana@example.com", "curta", "America/Sao_Paulo", "weak_password"),
        ("sem-arroba", PASSWORD, "America/Sao_Paulo", "invalid_email"),
        ("ana@example.com", PASSWORD, "Marte/Olympus", "invalid_timezone"),
    ],
)
def test_create_user_validations(
    db: Session, email: str, password: str, timezone: str, code: str
) -> None:
    with pytest.raises(RuleViolation) as exc:
        create_user(db, email, password, timezone)
    assert exc.value.code == code


def test_set_password(db: Session) -> None:
    create_user(db, "ana@example.com", PASSWORD)
    user = set_password(db, "ana@example.com", "uma-nova-senha-longa")
    assert verify_password("uma-nova-senha-longa", user.password_hash)


def test_set_password_unknown_email(db: Session) -> None:
    with pytest.raises(NotFound):
        set_password(db, "ninguem@example.com", "uma-nova-senha-longa")


def test_get_owned_hides_other_users_data(db: Session) -> None:
    ana = create_user(db, "ana@example.com", PASSWORD)
    bia = create_user(db, "bia@example.com", PASSWORD)
    category = db.scalars(select(Category).where(Category.user_id == ana.id)).first()
    assert category is not None
    assert get_owned(db, Category, category.id, ana.id, "a categoria") is category
    with pytest.raises(NotFound):
        get_owned(db, Category, category.id, bia.id, "a categoria")


def test_snapshot_is_json_friendly(db: Session) -> None:
    ana = create_user(db, "ana@example.com", PASSWORD)
    category = db.scalars(select(Category).where(Category.name == "Saúde")).one()
    data = snapshot(category)
    assert data["name"] == "Saúde"
    assert data["kind"] == "EXPENSE"
    assert data["is_essential"] is True
    assert data["user_id"] == str(ana.id)
