"""Pagamento de fatura e encargos do cartão.

Um pagamento é uma operação: uma ou mais contas de origem (cada uma vira um `INVOICE_PAYMENT`
com o mesmo `payment_group_id`) e, se sobrar saldo, o que fazer com o restante. A operação é
idempotente pela chave, guardada no primeiro pagamento do grupo, e é anulada inteira.

Fica fora de `invoices` porque usa a idempotência e as regras de conta de `transactions`, que
por sua vez lança itens por `invoices`.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.cards import MAX_INSTALLMENTS, MIN_INSTALLMENTS, add_months
from app.domain.dates import month_name
from app.domain.errors import NotFound, Notice, RuleViolation
from app.domain.money import format_brl, quantize, to_api
from app.models import (
    AuditAction,
    Card,
    Invoice,
    InvoiceItemKind,
    ItemDirection,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.repositories import get_owned
from app.services import card_ledger, invoices, transactions
from app.services.accounts import get_active_account
from app.services.audit import record, snapshot
from app.services.card_ledger import InvoiceState
from app.services.categories import get_financial_charges
from app.services.context import RequestContext
from app.services.transactions import NewCharge, WriteResult

MAX_SOURCES = 5


@dataclass(frozen=True)
class PaymentSource:
    account_id: UUID
    amount: Decimal


@dataclass(frozen=True)
class InstallmentPlan:
    """Parcelamento da fatura com o banco, com os valores que o banco mostra (A8)."""

    count: int
    installment_amount: Decimal


type Remainder = Literal["NONE", "CARRY_OVER"] | InstallmentPlan


@dataclass(frozen=True)
class NewInvoicePayment:
    occurred_on: date
    sources: tuple[PaymentSource, ...]
    remainder: Remainder = "NONE"


@dataclass(frozen=True)
class PaymentResult:
    group_id: UUID
    payments: list[Transaction]
    charge: Transaction | None
    replayed: bool = False
    notices: list[Notice] = field(default_factory=list)


def _digest(invoice_id: UUID, data: NewInvoicePayment) -> bytes:
    remainder = (
        data.remainder
        if isinstance(data.remainder, str)
        else f"{data.remainder.count}x{to_api(quantize(data.remainder.installment_amount))}"
    )
    return transactions.payload_hash(
        "NewInvoicePayment",
        {
            "invoice_id": invoice_id,
            "occurred_on": data.occurred_on,
            "sources": [f"{s.account_id}:{to_api(quantize(s.amount))}" for s in data.sources],
            "remainder": remainder,
        },
    )


def _group(session: Session, user_id: UUID, group_id: UUID, *, replayed: bool) -> PaymentResult:
    txs = list(
        session.scalars(
            select(Transaction)
            .where(Transaction.user_id == user_id, Transaction.payment_group_id == group_id)
            .order_by(Transaction.id)
        )
    )
    return PaymentResult(
        group_id=group_id,
        payments=[t for t in txs if t.type is TransactionType.INVOICE_PAYMENT],
        charge=next((t for t in txs if t.type is TransactionType.CHARGE), None),
        replayed=replayed,
    )


def _validate_plan(plan: InstallmentPlan, remainder: Decimal) -> None:
    if not MIN_INSTALLMENTS <= plan.count <= MAX_INSTALLMENTS or plan.installment_amount <= 0:
        raise RuleViolation(
            "installments_out_of_range",
            f"Parcelas devem ser de {MIN_INSTALLMENTS} a {MAX_INSTALLMENTS}, com valor maior "
            "que zero.",
        )
    if plan.count * quantize(plan.installment_amount) < remainder:
        raise RuleViolation(
            "invoice_installments_below_remainder",
            f"As parcelas somam menos que o restante da fatura ({format_brl(remainder)}).",
        )


def pay_invoice(
    session: Session,
    ctx: RequestContext,
    invoice_id: UUID,
    data: NewInvoicePayment,
    *,
    idempotency_key: str | None = None,
) -> PaymentResult:
    digest = _digest(invoice_id, data) if idempotency_key else None
    if idempotency_key is not None and digest is not None:
        transactions.lock_idempotency_key(session, ctx.user_id, idempotency_key)
        existing = transactions.find_by_key(session, ctx.user_id, idempotency_key)
        if existing is not None and existing.payment_group_id is not None:
            transactions.ensure_same_payload(existing, digest)
            return _group(session, ctx.user_id, existing.payment_group_id, replayed=True)

    invoice = get_owned(session, Invoice, invoice_id, ctx.user_id, "a fatura", for_update=True)
    card = session.get_one(Card, invoice.card_id)
    if not 1 <= len(data.sources) <= MAX_SOURCES:
        raise RuleViolation(
            "invalid_payment_sources", f"Informe de 1 a {MAX_SOURCES} contas de origem."
        )
    for source in data.sources:
        if source.amount <= 0:
            raise RuleViolation("amount_not_positive", "O valor deve ser maior que zero.")

    today = ctx.today()
    totals = next(
        t for t in card_ledger.invoice_totals(session, card, today) if t.invoice is invoice
    )
    if totals.state not in (InvoiceState.OPEN, InvoiceState.CLOSED) or totals.balance <= 0:
        raise RuleViolation("invoice_not_payable", "Esta fatura não tem saldo a pagar agora.")
    paid = quantize(sum((s.amount for s in data.sources), Decimal(0)))
    if paid > totals.balance:
        raise RuleViolation(
            "invoice_payment_exceeds_balance",
            f"O pagamento passa do saldo da fatura ({format_brl(totals.balance)}).",
        )
    remainder_amount = totals.balance - paid
    remainder = data.remainder if remainder_amount > 0 else "NONE"
    if remainder != "NONE" and totals.state is not InvoiceState.CLOSED:
        raise RuleViolation(
            "remainder_requires_closed_invoice",
            "Só dá para levar o restante adiante ou parcelar uma fatura fechada.",
        )
    if isinstance(remainder, InstallmentPlan):
        _validate_plan(remainder, remainder_amount)

    group_id = uuid.uuid7()
    month = month_name(invoice.reference_month)
    payments: list[Transaction] = []
    for index, source in enumerate(data.sources):
        account = get_active_account(session, ctx, source.account_id)
        transactions.check_account_opening(account, data.occurred_on)
        tx = Transaction(
            user_id=ctx.user_id,
            type=TransactionType.INVOICE_PAYMENT,
            amount=quantize(source.amount),
            occurred_on=data.occurred_on,
            description=f"Pagamento da fatura de {month} ({card.name})",
            account_id=account.id,
            invoice_id=invoice.id,
            payment_group_id=group_id,
        )
        # A chave fica no primeiro pagamento do grupo: é por ele que a operação é reencontrada.
        first = index == 0
        raced = transactions.insert_transaction(
            session, ctx, tx, idempotency_key if first else None, digest if first else None
        )
        if raced is not None and raced.transaction.payment_group_id is not None:
            return _group(session, ctx.user_id, raced.transaction.payment_group_id, replayed=True)
        payments.append(tx)

    charge = _settle_remainder(
        session, ctx, card, invoice, remainder, remainder_amount, group_id, data.occurred_on
    )
    outflow = [p.account_id for p in payments if p.account_id is not None]
    notices = transactions.negative_balance_notices(
        session, ctx, outflow, max(today, data.occurred_on)
    )
    return PaymentResult(group_id, payments, charge, replayed=False, notices=notices)


def _settle_remainder(
    session: Session,
    ctx: RequestContext,
    card: Card,
    invoice: Invoice,
    remainder: Remainder,
    amount: Decimal,
    group_id: UUID,
    occurred_on: date,
) -> Transaction | None:
    """O restante vai para a fatura seguinte (rotativo) ou vira N parcelas nas próximas faturas;
    nos dois casos a fatura atual fica paga. Juros do parcelamento viram um encargo, sem item
    próprio (já estão dentro das parcelas)."""
    links = {"source_invoice_id": invoice.id, "payment_group_id": group_id}
    if remainder == "CARRY_OVER":
        invoices.add_item(
            session,
            ctx,
            invoices.get_or_create_invoice(session, card, add_months(invoice.reference_month, 1)),
            kind=InvoiceItemKind.CARRYOVER,
            direction=ItemDirection.DEBIT,
            amount=amount,
            **links,
        )
        return None
    if not isinstance(remainder, InstallmentPlan):
        return None
    installment = quantize(remainder.installment_amount)
    for number in range(1, remainder.count + 1):
        invoices.add_item(
            session,
            ctx,
            invoices.get_or_create_invoice(
                session, card, add_months(invoice.reference_month, number)
            ),
            kind=InvoiceItemKind.INVOICE_INSTALLMENT,
            direction=ItemDirection.DEBIT,
            amount=installment,
            installment_number=number,
            installment_count=remainder.count,
            **links,
        )
    interest = remainder.count * installment - amount
    if interest <= 0:
        return None
    charge = Transaction(
        user_id=ctx.user_id,
        type=TransactionType.CHARGE,
        amount=quantize(interest),
        occurred_on=occurred_on,
        description=f"Juros do parcelamento da fatura de {month_name(invoice.reference_month)}",
        category_id=get_financial_charges(session, ctx.user_id).id,
        card_id=card.id,
        payment_group_id=group_id,
    )
    transactions.insert_transaction(session, ctx, charge, None, None)
    return charge


def void_payment_group(session: Session, ctx: RequestContext, group_id: UUID) -> list[Transaction]:
    """Anula a operação inteira: pagamentos, juros e os itens criados para o restante.

    Recusado se algum item criado já está em fatura fechada.
    """
    txs = list(
        session.scalars(
            select(Transaction)
            .where(Transaction.user_id == ctx.user_id, Transaction.payment_group_id == group_id)
            .order_by(Transaction.id)
            .with_for_update()
        )
    )
    if not txs:
        raise NotFound("o pagamento")
    invoices.cancel_group_items(session, ctx, group_id)
    for tx in txs:
        if tx.status is TransactionStatus.VOIDED:
            continue
        before = snapshot(tx)
        tx.status = TransactionStatus.VOIDED
        tx.voided_at = ctx.now()
        record(session, ctx, tx, AuditAction.VOID, before)
    return txs


def add_charge(
    session: Session,
    ctx: RequestContext,
    card_id: UUID,
    *,
    amount: Decimal,
    occurred_on: date,
    description: str,
    idempotency_key: str | None = None,
) -> WriteResult:
    """Encargo (juros, multa, IOF) na fatura da data em que foi cobrado."""
    data = NewCharge(
        amount=amount, occurred_on=occurred_on, description=description, card_id=card_id
    )
    return transactions.create_transaction(session, ctx, data, idempotency_key=idempotency_key)
