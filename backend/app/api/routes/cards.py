from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response

from app.api.deps import CtxDep, DbDep
from app.api.schemas.cards import (
    CardArchiveOut,
    CardIn,
    CardInvoicesOut,
    CardOut,
    CardPatch,
    CardSummaryOut,
    ChargeIn,
    InvoiceImpactOut,
    InvoiceSummaryOut,
    LimitOut,
    PreviewIn,
    PreviewOut,
)
from app.api.schemas.common import ApiDate, NoticeOut
from app.api.schemas.transactions import TransactionOut, TransactionWriteOut
from app.models import Card
from app.repositories import get_owned
from app.services import card_ledger, cards, invoice_payments, transactions
from app.services.card_ledger import CardSummary, InvoiceState
from app.services.cards import OpeningState

router = APIRouter(prefix="/cards", tags=["cards"])

IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=100)]
ZERO = Decimal("0.00")


def _open_invoice(summary: CardSummary) -> InvoiceSummaryOut:
    if summary.open_invoice is not None:
        return InvoiceSummaryOut.of(summary.open_invoice)
    return InvoiceSummaryOut(
        id=None,
        reference_month=summary.open_reference_month,
        closing_date=summary.open_closing_date,
        due_date=summary.open_due_date,
        state=InvoiceState.OPEN,
        total=ZERO,
        balance=ZERO,
        reported_total=None,
        difference=None,
    )


def _summary_out(summary: CardSummary) -> CardSummaryOut:
    return CardSummaryOut(
        card=CardOut.model_validate(summary.card),
        open_invoice=_open_invoice(summary),
        payable=InvoiceSummaryOut.of(summary.payable) if summary.payable else None,
        future=[InvoiceSummaryOut.of(t) for t in summary.future],
        limit=LimitOut(
            limit=summary.limit.limit, used=summary.limit.used, available=summary.limit.available
        ),
    )


@router.get("", response_model=list[CardOut])
def list_cards(ctx: CtxDep, db: DbDep, include_archived: bool = False) -> list[Card]:
    return cards.list_cards(db, ctx, include_archived=include_archived)


@router.get("/summary", response_model=list[CardSummaryOut])
def cards_summary(ctx: CtxDep, db: DbDep) -> list[CardSummaryOut]:
    """Fatura aberta, fatura a pagar, próximas faturas e limite de cada cartão ativo."""
    today = ctx.today()
    return [
        _summary_out(card_ledger.card_summary(db, card, today))
        for card in cards.list_cards(db, ctx)
    ]


@router.post("", status_code=201, response_model=CardOut)
def create_card(body: CardIn, ctx: CtxDep, db: DbDep) -> Card:
    opening = None
    if body.open_invoice_total is not None or body.closed_invoice is not None:
        closed = body.closed_invoice
        opening = OpeningState(
            open_invoice_total=body.open_invoice_total,
            closed_invoice_total=closed.total if closed else None,
            closed_invoice_due_date=closed.due_date if closed else None,
        )
    card = cards.create_card(
        db,
        ctx,
        name=body.name,
        credit_limit=body.credit_limit,
        closing_day=body.closing_day,
        due_day=body.due_day,
        opening_date=body.opening_date,
        opening=opening,
    )
    db.commit()
    return card


@router.patch("/{card_id}", response_model=CardOut)
def update_card(card_id: UUID, body: CardPatch, ctx: CtxDep, db: DbDep) -> Card:
    card = cards.update_card(db, ctx, card_id, body.model_dump(exclude_unset=True))
    db.commit()
    return card


@router.post("/{card_id}/archive", response_model=CardArchiveOut)
def archive_card(card_id: UUID, ctx: CtxDep, db: DbDep) -> CardArchiveOut:
    result = cards.archive_card(db, ctx, card_id)
    db.commit()
    return CardArchiveOut(
        card=CardOut.model_validate(result.card), warnings=NoticeOut.many(result.notices)
    )


@router.get("/{card_id}/invoices", response_model=CardInvoicesOut)
def card_invoices(
    card_id: UUID,
    ctx: CtxDep,
    db: DbDep,
    before: ApiDate | None = None,
    limit: Annotated[int, Query(ge=1, le=36)] = 12,
) -> CardInvoicesOut:
    """Fatura aberta, futuras e anteriores (paginadas do mês mais recente para o mais antigo)."""
    card = get_owned(db, Card, card_id, ctx.user_id, "o cartão")
    summary = card_ledger.card_summary(db, card, ctx.today())
    cutoff: date = before or summary.open_reference_month
    previous = sorted(
        (
            t
            for t in card_ledger.invoice_totals(db, card, ctx.today())
            if t.state in (InvoiceState.CLOSED, InvoiceState.PAID)
            and t.invoice.reference_month < cutoff
        ),
        key=lambda t: t.invoice.reference_month,
        reverse=True,
    )
    page = previous[:limit]
    return CardInvoicesOut(
        open=_open_invoice(summary),
        future=[InvoiceSummaryOut.of(t) for t in summary.future],
        previous=[InvoiceSummaryOut.of(t) for t in page],
        next_before=page[-1].invoice.reference_month if len(previous) > limit else None,
    )


@router.post("/{card_id}/charges", status_code=201, response_model=TransactionWriteOut)
def add_charge(
    card_id: UUID,
    body: ChargeIn,
    idempotency_key: IdempotencyKey,
    response: Response,
    ctx: CtxDep,
    db: DbDep,
) -> TransactionWriteOut:
    result = invoice_payments.add_charge(
        db,
        ctx,
        card_id,
        amount=body.amount,
        occurred_on=body.occurred_on,
        description=body.description,
        idempotency_key=idempotency_key,
    )
    db.commit()
    if result.replayed:
        response.status_code = 200
    return TransactionWriteOut(
        transaction=TransactionOut.model_validate(result.transaction),
        replayed=result.replayed,
        warnings=NoticeOut.many(result.notices),
    )


@router.post("/{card_id}/preview", response_model=PreviewOut)
def preview_purchase(card_id: UUID, body: PreviewIn, ctx: CtxDep, db: DbDep) -> PreviewOut:
    """Como a fatura e o limite ficariam com a compra. Não grava nada."""
    card = cards.get_active_card(db, ctx, card_id)
    transactions.check_card_dates(card, body.occurred_on, None)
    preview = card_ledger.preview_purchase(
        db,
        card,
        amount=body.amount,
        installments=body.installments,
        occurred_on=body.occurred_on,
        today=ctx.today(),
    )
    return PreviewOut(
        invoice=InvoiceImpactOut.model_validate(preview.invoice),
        following=[InvoiceImpactOut.model_validate(i) for i in preview.following],
        limit_before=preview.limit_before,
        limit_after=preview.limit_after,
    )
