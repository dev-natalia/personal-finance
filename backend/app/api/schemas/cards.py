from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.api.schemas.common import (
    ApiDate,
    Description,
    Money,
    NoNul,
    NoticeOut,
    PositiveMoney,
)
from app.api.schemas.transactions import TransactionOut
from app.models import InvoiceItemKind, ItemDirection, ItemStatus
from app.services.card_ledger import InvoiceState, InvoiceTotals

CardName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60), NoNul
]
Day = Annotated[int, Field(ge=1, le=31)]
Installments = Annotated[int, Field(ge=2, le=24)]


class ClosedInvoiceIn(BaseModel):
    total: PositiveMoney
    due_date: ApiDate


class CardIn(BaseModel):
    name: CardName
    credit_limit: PositiveMoney
    closing_day: Day
    due_day: Day
    opening_date: ApiDate
    # Como o cartão está no primeiro dia (totais que o banco mostra hoje).
    open_invoice_total: PositiveMoney | None = None
    closed_invoice: ClosedInvoiceIn | None = None


class CardPatch(BaseModel):
    name: CardName | None = None
    credit_limit: PositiveMoney | None = None
    closing_day: Day | None = None
    due_day: Day | None = None


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    credit_limit: Money
    closing_day: int
    due_day: int
    opening_date: date
    archived_at: datetime | None


class CardArchiveOut(BaseModel):
    card: CardOut
    warnings: list[NoticeOut]


class InvoiceSummaryOut(BaseModel):
    """`id` nulo: fatura aberta ainda sem nenhum item (as datas vêm do ciclo do cartão)."""

    id: UUID | None
    reference_month: date
    closing_date: date
    due_date: date
    state: InvoiceState
    total: Money
    balance: Money
    reported_total: Money | None
    # Total informado pelo banco − total calculado aqui (positivo: falta registrar algo).
    difference: Money | None

    @classmethod
    def of(cls, totals: InvoiceTotals) -> InvoiceSummaryOut:
        invoice = totals.invoice
        reported = invoice.reported_total
        return cls(
            id=invoice.id,
            reference_month=invoice.reference_month,
            closing_date=invoice.closing_date,
            due_date=invoice.due_date,
            state=totals.state,
            total=totals.total,
            balance=totals.balance,
            reported_total=reported,
            difference=None if reported is None else reported - totals.total,
        )


class LimitOut(BaseModel):
    limit: Money
    used: Money
    available: Money


class CardSummaryOut(BaseModel):
    card: CardOut
    open_invoice: InvoiceSummaryOut
    payable: InvoiceSummaryOut | None
    future: list[InvoiceSummaryOut]
    limit: LimitOut


class CardInvoicesOut(BaseModel):
    open: InvoiceSummaryOut
    future: list[InvoiceSummaryOut]
    previous: list[InvoiceSummaryOut]
    next_before: date | None


class InvoiceItemOut(BaseModel):
    id: UUID
    kind: InvoiceItemKind
    direction: ItemDirection
    amount: Money
    description: str
    occurred_on: date | None
    installment_number: int | None
    installment_count: int | None
    transaction_id: UUID | None
    status: ItemStatus


class InvoiceDetailOut(BaseModel):
    invoice: InvoiceSummaryOut
    items: list[InvoiceItemOut]
    payments: list[TransactionOut]


class InvoicePatch(BaseModel):
    """`reported_total: null` apaga o total informado."""

    reported_total: Annotated[Money, Field(ge=0)] | None = None
    closing_date: ApiDate | None = None
    due_date: ApiDate | None = None


class PaymentSourceIn(BaseModel):
    account_id: UUID
    amount: PositiveMoney


class InstallmentPlanIn(BaseModel):
    installments: Installments
    installment_amount: PositiveMoney


class InvoicePaymentIn(BaseModel):
    occurred_on: ApiDate
    sources: list[PaymentSourceIn] = Field(min_length=1, max_length=5)
    remainder: Literal["NONE", "CARRY_OVER"] | InstallmentPlanIn = "NONE"


class InvoicePaymentOut(BaseModel):
    group_id: UUID
    payments: list[TransactionOut]
    charge: TransactionOut | None
    replayed: bool = False
    warnings: list[NoticeOut] = Field(default_factory=list)


class PaymentGroupVoidOut(BaseModel):
    group_id: UUID
    payments: list[TransactionOut]


class ChargeIn(BaseModel):
    amount: PositiveMoney
    occurred_on: ApiDate
    description: Description


class PreviewIn(BaseModel):
    amount: PositiveMoney
    installments: Installments | None = None
    occurred_on: ApiDate


class InvoiceImpactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reference_month: date
    before: Money
    after: Money


class PreviewOut(BaseModel):
    invoice: InvoiceImpactOut
    following: list[InvoiceImpactOut]
    limit_before: Money
    limit_after: Money
