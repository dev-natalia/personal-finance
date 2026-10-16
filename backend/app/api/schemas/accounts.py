from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.api.schemas.common import AccountName, Money, NoticeOut
from app.models import AccountType


class AccountIn(BaseModel):
    name: AccountName
    type: AccountType
    opening_balance: Money
    opening_date: date


class AccountPatch(BaseModel):
    name: AccountName | None = None
    type: AccountType | None = None
    opening_balance: Money | None = None
    opening_date: date | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: AccountType
    opening_balance: Money
    opening_date: date
    archived_at: datetime | None


class AccountArchiveOut(BaseModel):
    account: AccountOut
    warnings: list[NoticeOut]


class AccountBalanceOut(BaseModel):
    account_id: UUID
    name: str
    archived: bool
    balance: Money


class BalancesOut(BaseModel):
    as_of: date
    total: Money
    accounts: list[AccountBalanceOut]
