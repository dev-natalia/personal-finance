from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response

from app.api.deps import CtxDep, DbDep
from app.api.schemas.common import ApiDate, NoticeOut
from app.api.schemas.transactions import (
    RefundIn,
    TransactionIn,
    TransactionOut,
    TransactionPage,
    TransactionPatch,
    TransactionWriteOut,
    to_new_transaction,
)
from app.models import PaymentMethod, Transaction, TransactionStatus, TransactionType
from app.repositories import get_owned
from app.services import ledger, transactions
from app.services.transactions import NewRefund, WriteResult

router = APIRouter(prefix="/transactions", tags=["transactions"])

IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=100)]


def _write_out(result: WriteResult) -> TransactionWriteOut:
    return TransactionWriteOut(
        transaction=TransactionOut.model_validate(result.transaction),
        replayed=result.replayed,
        warnings=NoticeOut.many(result.notices),
    )


@router.post("", status_code=201, response_model=TransactionWriteOut)
def create_transaction(
    body: TransactionIn,
    idempotency_key: IdempotencyKey,
    response: Response,
    ctx: CtxDep,
    db: DbDep,
) -> TransactionWriteOut:
    result = transactions.create_transaction(
        db, ctx, to_new_transaction(body), idempotency_key=idempotency_key
    )
    db.commit()
    if result.replayed:
        response.status_code = 200
    return _write_out(result)


@router.get("", response_model=TransactionPage)
def list_transactions(
    ctx: CtxDep,
    db: DbDep,
    date_from: ApiDate | None = None,
    date_to: ApiDate | None = None,
    account_id: UUID | None = None,
    category_id: UUID | None = None,
    merchant_id: UUID | None = None,
    payment_method: PaymentMethod | None = None,
    tx_type: Annotated[TransactionType | None, Query(alias="type")] = None,
    status: Literal["CONFIRMED", "VOIDED", "ALL"] = "CONFIRMED",
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> TransactionPage:
    filters = ledger.TransactionFilters(
        date_from=date_from,
        date_to=date_to,
        account_id=account_id,
        category_id=category_id,
        merchant_id=merchant_id,
        payment_method=payment_method,
        type=tx_type,
        status=None if status == "ALL" else TransactionStatus(status),
    )
    page = ledger.list_transactions(db, ctx.user_id, filters, cursor=cursor, limit=limit)
    return TransactionPage(
        items=[TransactionOut.model_validate(t) for t in page.items],
        next_cursor=page.next_cursor,
    )


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: UUID, ctx: CtxDep, db: DbDep) -> Transaction:
    return get_owned(db, Transaction, transaction_id, ctx.user_id, "o lançamento")


@router.patch("/{transaction_id}", response_model=TransactionWriteOut)
def update_transaction(
    transaction_id: UUID, body: TransactionPatch, ctx: CtxDep, db: DbDep
) -> TransactionWriteOut:
    result = transactions.update_transaction(
        db, ctx, transaction_id, body.model_dump(exclude_unset=True)
    )
    db.commit()
    return _write_out(result)


@router.post("/{transaction_id}/void", response_model=TransactionOut)
def void_transaction(transaction_id: UUID, ctx: CtxDep, db: DbDep) -> Transaction:
    tx = transactions.void_transaction(db, ctx, transaction_id)
    db.commit()
    return tx


@router.post("/{transaction_id}/refunds", status_code=201, response_model=TransactionWriteOut)
def create_refund(
    transaction_id: UUID,
    body: RefundIn,
    idempotency_key: IdempotencyKey,
    response: Response,
    ctx: CtxDep,
    db: DbDep,
) -> TransactionWriteOut:
    data = NewRefund(
        amount=body.amount,
        occurred_on=body.occurred_on,
        account_id=body.account_id,
        description=body.description,
    )
    result = transactions.create_refund(
        db, ctx, transaction_id, data, idempotency_key=idempotency_key
    )
    db.commit()
    if result.replayed:
        response.status_code = 200
    return _write_out(result)
