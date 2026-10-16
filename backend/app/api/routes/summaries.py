from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CtxDep, DbDep
from app.api.schemas.summaries import CategoryAmountOut, MonthSummaryOut
from app.domain.dates import parse_month
from app.domain.errors import RuleViolation
from app.services import ledger

router = APIRouter(prefix="/summaries", tags=["summaries"])


@router.get("/month", response_model=MonthSummaryOut)
def month_summary(
    ctx: CtxDep, db: DbDep, month: Annotated[str, Query(max_length=7)]
) -> MonthSummaryOut:
    try:
        year, number = parse_month(month)
    except ValueError as exc:
        raise RuleViolation("invalid_month", str(exc)) from exc
    summary = ledger.month_summary(db, ctx.user_id, year, number)
    return MonthSummaryOut(
        month=f"{year:04d}-{number:02d}",
        income=summary.income,
        consumption_total=summary.consumption_total,
        by_category=[CategoryAmountOut.model_validate(c) for c in summary.by_category],
    )
