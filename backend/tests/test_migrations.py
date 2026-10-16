from datetime import date
from decimal import Decimal

import pytest
from alembic import command
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountType,
    Category,
    CategoryKind,
    PaymentMethod,
    Transaction,
    TransactionType,
    User,
)
from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_migrations_match_models(engine: Engine) -> None:
    command.check(alembic_config(TEST_DATABASE_URL))


def _seed(db: Session) -> tuple[User, Account, Category]:
    user = User(email="constraints@example.com", password_hash="x")
    db.add(user)
    db.flush()
    account = Account(
        user_id=user.id,
        name="Conta",
        type=AccountType.CHECKING,
        opening_balance=Decimal("0"),
        opening_date=date(2026, 10, 1),
    )
    category = Category(user_id=user.id, name="Mercado", kind=CategoryKind.EXPENSE)
    db.add_all([account, category])
    db.flush()
    return user, account, category


def test_amount_must_be_positive(db: Session) -> None:
    user, account, category = _seed(db)
    db.add(
        Transaction(
            user_id=user.id,
            type=TransactionType.EXPENSE,
            amount=Decimal("0"),
            occurred_on=date(2026, 10, 2),
            description="x",
            account_id=account.id,
            category_id=category.id,
            payment_method=PaymentMethod.PIX,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_transfer_requires_distinct_accounts(db: Session) -> None:
    user, account, _ = _seed(db)
    db.add(
        Transaction(
            user_id=user.id,
            type=TransactionType.TRANSFER,
            amount=Decimal("10"),
            occurred_on=date(2026, 10, 2),
            description="x",
            account_id=account.id,
            destination_account_id=account.id,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_expense_requires_payment_method(db: Session) -> None:
    user, account, category = _seed(db)
    db.add(
        Transaction(
            user_id=user.id,
            type=TransactionType.EXPENSE,
            amount=Decimal("10"),
            occurred_on=date(2026, 10, 2),
            description="x",
            account_id=account.id,
            category_id=category.id,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()
