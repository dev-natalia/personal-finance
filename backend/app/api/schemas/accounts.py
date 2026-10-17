from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.api.schemas.common import AccountName, ApiDate, Money, NoticeOut
from app.models import AccountType


class AccountIn(BaseModel):
    name: AccountName
    type: AccountType
    opening_balance: Money
    opening_date: ApiDate


class AccountPatch(BaseModel):
    name: AccountName | None = None
    type: AccountType | None = None
    opening_balance: Money | None = None
    opening_date: ApiDate | None = None


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
    # Só contas ativas; o que ficou em contas arquivadas vem à parte.
    total: Money
    archived_total: Money
    accounts: list[AccountBalanceOut]
