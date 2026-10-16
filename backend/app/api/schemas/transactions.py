from datetime import date, datetime
from typing import Annotated, Literal, assert_never
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.api.schemas.common import (
    ApiDate,
    Description,
    MerchantName,
    Money,
    Notes,
    NoticeOut,
    PositiveMoney,
)
from app.models import PaymentMethod, TransactionSource, TransactionStatus, TransactionType
from app.services.transactions import NewExpense, NewIncome, NewTransaction, NewTransfer


class IncomeIn(BaseModel):
    type: Literal["INCOME"]
    amount: PositiveMoney
    occurred_on: ApiDate
    description: Description
    account_id: UUID
    category_id: UUID | None = None
    merchant: MerchantName | None = None
    notes: Notes | None = None


class ExpenseIn(BaseModel):
    type: Literal["EXPENSE"]
    amount: PositiveMoney
    occurred_on: ApiDate
    description: Description
    account_id: UUID
    payment_method: PaymentMethod
    category_id: UUID | None = None
    merchant: MerchantName | None = None
    notes: Notes | None = None


class TransferIn(BaseModel):
    type: Literal["TRANSFER"]
    amount: PositiveMoney
    occurred_on: ApiDate
    description: Description
    account_id: UUID
    destination_account_id: UUID
    notes: Notes | None = None


TransactionIn = Annotated[IncomeIn | ExpenseIn | TransferIn, Field(discriminator="type")]


def to_new_transaction(body: IncomeIn | ExpenseIn | TransferIn) -> NewTransaction:
    match body:
        case IncomeIn():
            return NewIncome(
                amount=body.amount,
                occurred_on=body.occurred_on,
                description=body.description,
                account_id=body.account_id,
                category_id=body.category_id,
                merchant=body.merchant,
                notes=body.notes,
            )
        case ExpenseIn():
            return NewExpense(
                amount=body.amount,
                occurred_on=body.occurred_on,
                description=body.description,
                account_id=body.account_id,
                payment_method=body.payment_method,
                category_id=body.category_id,
                merchant=body.merchant,
                notes=body.notes,
            )
        case TransferIn():
            return NewTransfer(
                amount=body.amount,
                occurred_on=body.occurred_on,
                description=body.description,
                account_id=body.account_id,
                destination_account_id=body.destination_account_id,
                notes=body.notes,
            )
        case _:
            assert_never(body)


class RefundIn(BaseModel):
    amount: PositiveMoney
    occurred_on: ApiDate
    account_id: UUID | None = None
    description: Description | None = None


class TransactionPatch(BaseModel):
    """Só os campos enviados são alterados. `null` em campo obrigatório gera erro 422."""

    amount: PositiveMoney | None = None
    occurred_on: ApiDate | None = None
    description: Description | None = None
    notes: Notes | None = None
    merchant: MerchantName | None = None
    category_id: UUID | None = None
    account_id: UUID | None = None
    destination_account_id: UUID | None = None
    payment_method: PaymentMethod | None = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: TransactionType
    amount: Money
    occurred_on: date
    description: str
    notes: str | None
    merchant_id: UUID | None
    category_id: UUID | None
    account_id: UUID
    destination_account_id: UUID | None
    payment_method: PaymentMethod | None
    refund_of_id: UUID | None
    status: TransactionStatus
    source: TransactionSource
    created_at: datetime
    voided_at: datetime | None


class TransactionWriteOut(BaseModel):
    transaction: TransactionOut
    replayed: bool = False
    warnings: list[NoticeOut] = Field(default_factory=list)


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    next_cursor: str | None
