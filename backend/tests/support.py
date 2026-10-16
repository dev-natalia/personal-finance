"""Constantes e fábricas compartilhadas pelos testes."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountType, Category, CategoryKind
from app.services import accounts
from app.services.auth import SessionPolicy
from app.services.context import RequestContext

PASSWORD = "senha-super-secreta"
FIXED_NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)  # 12h00 em São Paulo
POLICY = SessionPolicy(secret_key=b"k" * 32, idle=timedelta(days=30), max_age=timedelta(days=90))


def make_account(
    db: Session,
    ctx: RequestContext,
    name: str = "Itaú",
    opening_balance: str = "1000.00",
    opening_date: date = date(2026, 10, 1),
    account_type: AccountType = AccountType.CHECKING,
) -> Account:
    return accounts.create_account(
        db,
        ctx,
        name=name,
        account_type=account_type,
        opening_balance=Decimal(opening_balance),
        opening_date=opening_date,
    )


def find_category(
    db: Session, ctx: RequestContext, name: str, kind: CategoryKind = CategoryKind.EXPENSE
) -> Category:
    return db.scalars(
        select(Category).where(
            Category.user_id == ctx.user_id, Category.kind == kind, Category.name == name
        )
    ).one()
