from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter

from app.api.deps import CtxDep, DbDep
from app.api.schemas.accounts import (
    AccountArchiveOut,
    AccountBalanceOut,
    AccountIn,
    AccountOut,
    AccountPatch,
    BalancesOut,
)
from app.api.schemas.common import NoticeOut
from app.models import Account
from app.services import accounts, ledger

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
def list_accounts(ctx: CtxDep, db: DbDep, include_archived: bool = False) -> list[Account]:
    return accounts.list_accounts(db, ctx, include_archived=include_archived)


@router.get("/balances", response_model=BalancesOut)
def balances(ctx: CtxDep, db: DbDep, as_of: date | None = None) -> BalancesOut:
    day = as_of or ctx.today()
    items = accounts.list_accounts(db, ctx, include_archived=True)
    values = ledger.account_balances(db, ctx.user_id, day)
    return BalancesOut(
        as_of=day,
        total=sum(values.values(), Decimal("0.00")),
        accounts=[
            AccountBalanceOut(
                account_id=a.id,
                name=a.name,
                archived=a.archived_at is not None,
                balance=values[a.id],
            )
            for a in items
        ],
    )


@router.post("", status_code=201, response_model=AccountOut)
def create_account(body: AccountIn, ctx: CtxDep, db: DbDep) -> Account:
    account = accounts.create_account(
        db,
        ctx,
        name=body.name,
        account_type=body.type,
        opening_balance=body.opening_balance,
        opening_date=body.opening_date,
    )
    db.commit()
    return account


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(account_id: UUID, body: AccountPatch, ctx: CtxDep, db: DbDep) -> Account:
    account = accounts.update_account(
        db,
        ctx,
        account_id,
        name=body.name,
        account_type=body.type,
        opening_balance=body.opening_balance,
        opening_date=body.opening_date,
    )
    db.commit()
    return account


@router.post("/{account_id}/archive", response_model=AccountArchiveOut)
def archive_account(account_id: UUID, ctx: CtxDep, db: DbDep) -> AccountArchiveOut:
    result = accounts.archive_account(db, ctx, account_id)
    db.commit()
    return AccountArchiveOut(
        account=AccountOut.model_validate(result.account),
        warnings=NoticeOut.many(result.notices),
    )
