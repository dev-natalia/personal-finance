from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Response

from app.api.deps import CtxDep, DbDep
from app.api.schemas.cards import (
    InvoiceAdjustmentOut,
    InvoiceDetailOut,
    InvoiceItemOut,
    InvoicePatch,
    InvoicePaymentIn,
    InvoicePaymentOut,
    InvoiceSummaryOut,
    PaymentGroupVoidOut,
)
from app.api.schemas.common import NoticeOut
from app.api.schemas.transactions import TransactionOut
from app.models import Card, Invoice
from app.repositories import get_owned
from app.services import card_ledger, invoice_payments, invoices
from app.services.invoice_payments import (
    InstallmentPlan,
    NewInvoicePayment,
    PaymentSource,
    Remainder,
)

router = APIRouter(tags=["invoices"])

IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=100)]


def _detail(db: DbDep, today: date, invoice: Invoice) -> InvoiceDetailOut:
    card = db.get_one(Card, invoice.card_id)
    totals = next(
        t for t in card_ledger.invoice_totals(db, card, today) if t.invoice.id == invoice.id
    )
    return InvoiceDetailOut(
        invoice=InvoiceSummaryOut.of(totals),
        items=[
            InvoiceItemOut(
                id=line.item.id,
                kind=line.item.kind,
                direction=line.item.direction,
                amount=line.item.amount,
                description=line.description,
                occurred_on=line.occurred_on,
                installment_number=line.item.installment_number,
                installment_count=line.item.installment_count,
                transaction_id=line.item.transaction_id,
                status=line.item.status,
            )
            for line in card_ledger.invoice_lines(db, invoice)
        ],
        adjustments=[
            InvoiceAdjustmentOut(description=a.description, amount=a.amount)
            for a in card_ledger.invoice_adjustments(db, card, totals)
        ],
        payments=[
            TransactionOut.model_validate(p) for p in card_ledger.invoice_payments(db, invoice)
        ],
    )


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetailOut)
def get_invoice(invoice_id: UUID, ctx: CtxDep, db: DbDep) -> InvoiceDetailOut:
    invoice = get_owned(db, Invoice, invoice_id, ctx.user_id, "a fatura")
    return _detail(db, ctx.today(), invoice)


@router.patch("/invoices/{invoice_id}", response_model=InvoiceSummaryOut)
def update_invoice(
    invoice_id: UUID, body: InvoicePatch, ctx: CtxDep, db: DbDep
) -> InvoiceSummaryOut:
    invoice = invoices.update_invoice(db, ctx, invoice_id, body.model_dump(exclude_unset=True))
    db.commit()
    return _detail(db, ctx.today(), invoice).invoice


@router.post("/invoices/{invoice_id}/payments", status_code=201, response_model=InvoicePaymentOut)
def pay_invoice(
    invoice_id: UUID,
    body: InvoicePaymentIn,
    idempotency_key: IdempotencyKey,
    response: Response,
    ctx: CtxDep,
    db: DbDep,
) -> InvoicePaymentOut:
    remainder: Remainder = (
        body.remainder
        if isinstance(body.remainder, str)
        else InstallmentPlan(body.remainder.installments, body.remainder.installment_amount)
    )
    data = NewInvoicePayment(
        occurred_on=body.occurred_on,
        sources=tuple(PaymentSource(s.account_id, s.amount) for s in body.sources),
        remainder=remainder,
    )
    result = invoice_payments.pay_invoice(
        db, ctx, invoice_id, data, idempotency_key=idempotency_key
    )
    db.commit()
    if result.replayed:
        response.status_code = 200
    return InvoicePaymentOut(
        group_id=result.group_id,
        payments=[TransactionOut.model_validate(p) for p in result.payments],
        charge=TransactionOut.model_validate(result.charge) if result.charge else None,
        replayed=result.replayed,
        warnings=NoticeOut.many(result.notices),
    )


@router.post("/payment-groups/{group_id}/void", response_model=PaymentGroupVoidOut)
def void_payment_group(group_id: UUID, ctx: CtxDep, db: DbDep) -> PaymentGroupVoidOut:
    voided = invoice_payments.void_payment_group(db, ctx, group_id)
    db.commit()
    return PaymentGroupVoidOut(
        group_id=group_id,
        payments=[TransactionOut.model_validate(t) for t in voided],
    )
