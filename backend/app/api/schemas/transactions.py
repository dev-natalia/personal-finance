from datetime import date, datetime
from typing import Annotated, Literal, Self, assert_never
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.api.schemas.common import (
    ApiDate,
    Description,
    MerchantName,
    Money,
    Notes,
    NoticeOut,
    PositiveMoney,
)
from app.domain.cards import split_installments
from app.models import PaymentMethod, TransactionSource, TransactionStatus, TransactionType
from app.services.transactions import (
    NewCardExpense,
    NewExpense,
    NewIncome,
    NewTransaction,
    NewTransfer,
)

Installments = Annotated[int, Field(ge=2, le=24)]


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
    """Despesa via conta (`account_id` + `payment_method`) ou no cartão (`card_id`, com
    `installments` opcional; `remaining_installments` só para parcelada em andamento)."""

    type: Literal["EXPENSE"]
    amount: PositiveMoney
    occurred_on: ApiDate
    description: Description
    account_id: UUID | None = None
    payment_method: PaymentMethod | None = None
    card_id: UUID | None = None
    installments: Installments | None = None
    remaining_installments: Annotated[int, Field(ge=1, le=23)] | None = None
    category_id: UUID | None = None
    merchant: MerchantName | None = None
    notes: Notes | None = None

    @model_validator(mode="after")
    def _account_or_card(self) -> Self:
        via_account = self.account_id is not None and self.payment_method is not None
        via_card = self.card_id is not None
        account_fields = self.account_id is not None or self.payment_method is not None
        if via_card == account_fields or (not via_card and not via_account):
            raise ValueError("informe a conta e o meio de pagamento, ou o cartão (não os dois)")
        if not via_card and (self.installments or self.remaining_installments):
            raise ValueError("parcelas só existem em compras no cartão")
        return self


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
        case ExpenseIn() if body.card_id is not None:
            return NewCardExpense(
                amount=body.amount,
                occurred_on=body.occurred_on,
                description=body.description,
                card_id=body.card_id,
                installments=body.installments,
                remaining_installments=body.remaining_installments,
                category_id=body.category_id,
                merchant=body.merchant,
                notes=body.notes,
            )
        case ExpenseIn() if body.account_id is not None and body.payment_method is not None:
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
        case ExpenseIn():
            raise ValueError("Despesa sem conta nem cartão.")  # o validador já recusa antes
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
    # Compras no cartão: `installments: null` volta para à vista.
    installments: Installments | None = None
    card_id: UUID | None = None


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
    account_id: UUID | None
    destination_account_id: UUID | None
    payment_method: PaymentMethod | None
    refund_of_id: UUID | None
    card_id: UUID | None
    installments: int | None
    remaining_installments: int | None
    invoice_id: UUID | None
    payment_group_id: UUID | None
    status: TransactionStatus
    source: TransactionSource
    created_at: datetime
    voided_at: datetime | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def installment_amount(self) -> Money | None:
        """Valor de cada parcela (as demais; a primeira leva a sobra dos centavos)."""
        if self.installments is None:
            return None
        return split_installments(self.amount, self.installments)[-1]


class TransactionWriteOut(BaseModel):
    transaction: TransactionOut
    replayed: bool = False
    warnings: list[NoticeOut] = Field(default_factory=list)


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    next_cursor: str | None
