from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.api.schemas.common import ApiDate, MerchantName, PositiveMoney
from app.api.schemas.transactions import TransactionOut
from app.models import AccountType, PaymentMethod


class EntryAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: AccountType


class PaymentOptionOut(BaseModel):
    """Atalho de pagamento: conta + meio, ou cartão (`card_id`, meio `CREDIT`)."""

    model_config = ConfigDict(from_attributes=True)

    account_id: UUID | None
    card_id: UUID | None
    name: str
    payment_method: PaymentMethod


class EntryCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class EntryHintsOut(BaseModel):
    today: date
    accounts: list[EntryAccountOut]
    cards: list[EntryCardOut]
    payment_methods: list[PaymentMethod]
    top_payment_options: list[PaymentOptionOut]


class EntryCheckItem(BaseModel):
    amount: PositiveMoney
    merchant: MerchantName | None = None
    occurred_on: ApiDate


class EntryChecksIn(BaseModel):
    items: list[EntryCheckItem] = Field(min_length=1, max_length=50)


class EntryCheckResult(BaseModel):
    index: int
    possible_duplicates: list[TransactionOut]


class EntryChecksOut(BaseModel):
    results: list[EntryCheckResult]
