"""Contas: cadastro com saldo e data de abertura, edição e arquivamento."""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, Notice, RuleViolation
from app.domain.money import quantize
from app.models import Account, AccountType, AuditAction, Transaction, TransactionStatus
from app.repositories import get_owned, owned_select
from app.services.audit import record, snapshot
from app.services.context import RequestContext


@dataclass(frozen=True)
class ArchiveResult:
    account: Account
    notices: list[Notice] = field(default_factory=list)


def list_accounts(
    session: Session, ctx: RequestContext, *, include_archived: bool = False
) -> list[Account]:
    stmt = owned_select(Account, ctx.user_id).order_by(Account.name)
    if not include_archived:
        stmt = stmt.where(Account.archived_at.is_(None))
    return list(session.scalars(stmt))


def get_active_account(session: Session, ctx: RequestContext, account_id: UUID) -> Account:
    account = get_owned(session, Account, account_id, ctx.user_id, "a conta")
    if account.archived_at is not None:
        raise RuleViolation("account_archived", f"A conta {account.name} está arquivada.")
    return account


def _ensure_unique_name(
    session: Session, user_id: UUID, name: str, exclude_id: UUID | None = None
) -> None:
    stmt = select(Account.id).where(Account.user_id == user_id, Account.name == name)
    if exclude_id is not None:
        stmt = stmt.where(Account.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise Conflict("name_already_exists", "Já existe uma conta com esse nome.")


def create_account(
    session: Session,
    ctx: RequestContext,
    *,
    name: str,
    account_type: AccountType,
    opening_balance: Decimal,
    opening_date: date,
) -> Account:
    _ensure_unique_name(session, ctx.user_id, name)
    account = Account(
        user_id=ctx.user_id,
        name=name,
        type=account_type,
        opening_balance=quantize(opening_balance),
        opening_date=opening_date,
    )
    session.add(account)
    record(session, ctx, account, AuditAction.CREATE, before=None)
    return account


def update_account(
    session: Session,
    ctx: RequestContext,
    account_id: UUID,
    *,
    name: str | None = None,
    account_type: AccountType | None = None,
    opening_balance: Decimal | None = None,
    opening_date: date | None = None,
) -> Account:
    account = get_owned(session, Account, account_id, ctx.user_id, "a conta", for_update=True)
    before = snapshot(account)
    if name is not None and name != account.name:
        _ensure_unique_name(session, ctx.user_id, name, exclude_id=account.id)
        account.name = name
    if account_type is not None:
        account.type = account_type
    if opening_balance is not None:
        account.opening_balance = quantize(opening_balance)
    if opening_date is not None:
        earliest = session.scalar(
            select(func.min(Transaction.occurred_on)).where(
                Transaction.user_id == ctx.user_id,
                Transaction.status == TransactionStatus.CONFIRMED,
                or_(
                    Transaction.account_id == account.id,
                    Transaction.destination_account_id == account.id,
                ),
            )
        )
        if earliest is not None and earliest < opening_date:
            raise RuleViolation(
                "date_before_account_opening",
                f"Há lançamentos em {earliest:%d/%m/%Y}, antes da nova data de abertura.",
            )
        account.opening_date = opening_date
    record(session, ctx, account, AuditAction.UPDATE, before)
    return account


def archive_account(session: Session, ctx: RequestContext, account_id: UUID) -> ArchiveResult:
    account = get_owned(session, Account, account_id, ctx.user_id, "a conta", for_update=True)
    if account.archived_at is not None:
        return ArchiveResult(account)
    before = snapshot(account)
    account.archived_at = ctx.now()
    record(session, ctx, account, AuditAction.ARCHIVE, before)
    return ArchiveResult(account)
