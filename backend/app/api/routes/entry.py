from fastapi import APIRouter

from app.api.deps import CtxDep, DbDep
from app.api.schemas.entry import (
    EntryAccountOut,
    EntryCheckResult,
    EntryChecksIn,
    EntryChecksOut,
    EntryHintsOut,
    PaymentOptionOut,
)
from app.api.schemas.transactions import TransactionOut
from app.models import PaymentMethod
from app.services import accounts, ledger

router = APIRouter(tags=["entry"])


@router.get("/entry-hints", response_model=EntryHintsOut)
def entry_hints(ctx: CtxDep, db: DbDep) -> EntryHintsOut:
    """Tudo que a tela de registro precisa para montar o cartão de confirmação."""
    today = ctx.today()
    return EntryHintsOut(
        today=today,
        accounts=[EntryAccountOut.model_validate(a) for a in accounts.list_accounts(db, ctx)],
        payment_methods=list(PaymentMethod),
        top_payment_options=[
            PaymentOptionOut.model_validate(o)
            for o in ledger.top_payment_options(db, ctx.user_id, today)
        ],
    )


@router.post("/entry-checks", response_model=EntryChecksOut)
def entry_checks(body: EntryChecksIn, ctx: CtxDep, db: DbDep) -> EntryChecksOut:
    """Possíveis duplicatas para cada item antes de confirmar (não grava nada)."""
    results = [
        EntryCheckResult(
            index=index,
            possible_duplicates=[
                TransactionOut.model_validate(t)
                for t in ledger.possible_duplicates(
                    db,
                    ctx.user_id,
                    amount=item.amount,
                    merchant=item.merchant,
                    occurred_on=item.occurred_on,
                )
            ],
        )
        for index, item in enumerate(body.items)
    ]
    return EntryChecksOut(results=results)
