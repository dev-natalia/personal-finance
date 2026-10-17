from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy.orm import Session

from app.api.deps import CtxDep, DbDep
from app.api.schemas.analysis import (
    AnalysisSummaryOut,
    CategoryTotalOut,
    DaySpendingOut,
    DayTotalOut,
    PeriodOut,
    PlaceDetailOut,
    PlaceTotalOut,
    PlaceTotalsOut,
)
from app.api.schemas.common import ApiDate
from app.api.schemas.transactions import TransactionOut, TransactionPage
from app.domain.errors import RuleViolation
from app.domain.periods import PeriodKind, has_next, period_containing
from app.models import Account, Card
from app.repositories import owned_select
from app.services import analysis
from app.services.context import RequestContext
from app.services.ledger import Source, SpendingMode

router = APIRouter(prefix="/analysis", tags=["analysis"])

SourceParam = Annotated[str | None, Query(max_length=60)]
ModeParam = Annotated[SpendingMode, Query()]


def _source(db: Session, ctx: RequestContext, text: str | None) -> Source | None:
    """`account:<id>` ou `card:<id>` da própria usuária (arquivados valem)."""
    if text is None:
        return None
    kind, _, value = text.partition(":")
    model = {"account": Account, "card": Card}.get(kind)
    try:
        source_id = UUID(value)
    except ValueError:
        model = None
    if (
        model is None
        or db.scalar(owned_select(model, ctx.user_id).where(model.id == source_id)) is None
    ):
        raise RuleViolation("invalid_source", "Escolha uma conta ou um cartão seu.")
    return Source("account" if kind == "account" else "card", source_id)


@router.get("/summary", response_model=AnalysisSummaryOut)
def summary(
    ctx: CtxDep,
    db: DbDep,
    period: Annotated[PeriodKind, Query()] = PeriodKind.MONTH,
    date: ApiDate | None = None,
    mode: ModeParam = SpendingMode.INSTALLMENTS,
    source: SourceParam = None,
    category_id: UUID | None = None,
) -> AnalysisSummaryOut:
    """Total, categorias, lugares e dias do período (o atual, sem `date`)."""
    today = ctx.today()
    resolved = period_containing(period, date or today, today)
    result = analysis.summary(
        db,
        ctx.user_id,
        resolved,
        mode=mode,
        source=_source(db, ctx, source),
        category_id=category_id,
    )
    return AnalysisSummaryOut(
        period=PeriodOut(
            kind=resolved.kind,
            start=resolved.start,
            end=resolved.end,
            has_next=has_next(resolved, today),
        ),
        total=result.total,
        by_category=[
            CategoryTotalOut(category_id=c.category_id, name=c.name, amount=c.amount)
            for c in result.by_category
        ],
        by_place=[
            PlaceTotalOut(
                key=p.key,
                name=p.name,
                amount=p.amount,
                purchases=p.purchases,
                category_name=p.category_name,
            )
            for p in result.by_place
        ],
        by_day=[DayTotalOut(day=d.day, amount=d.amount) for d in result.by_day],
        busiest=(
            DayTotalOut(day=result.busiest.day, amount=result.busiest.amount)
            if result.busiest
            else None
        ),
    )


@router.get("/day", response_model=list[DaySpendingOut])
def day(
    ctx: CtxDep,
    db: DbDep,
    date: ApiDate,
    mode: ModeParam = SpendingMode.INSTALLMENTS,
    source: SourceParam = None,
    category_id: UUID | None = None,
) -> list[DaySpendingOut]:
    """O que foi gasto num dia."""
    items = analysis.day_spending(
        db,
        ctx.user_id,
        date,
        mode=mode,
        source=_source(db, ctx, source),
        category_id=category_id,
    )
    return [
        DaySpendingOut(transaction=TransactionOut.model_validate(i.transaction), amount=i.amount)
        for i in items
    ]


@router.get("/places/{key}", response_model=PlaceDetailOut)
def place(
    key: str,
    ctx: CtxDep,
    db: DbDep,
    mode: ModeParam = SpendingMode.INSTALLMENTS,
    source: SourceParam = None,
) -> PlaceDetailOut:
    """Semana, mês e ano atuais de um lugar, e a média por compra."""
    detail = analysis.place_detail(
        db, ctx.user_id, key, mode=mode, source=_source(db, ctx, source), today=ctx.today()
    )
    return PlaceDetailOut(
        key=detail.key,
        name=detail.name,
        category_name=detail.category_name,
        week=PlaceTotalsOut(amount=detail.week.amount, purchases=detail.week.purchases),
        month=PlaceTotalsOut(amount=detail.month.amount, purchases=detail.month.purchases),
        year=PlaceTotalsOut(amount=detail.year.amount, purchases=detail.year.purchases),
        average=detail.average,
    )


@router.get("/places/{key}/transactions", response_model=TransactionPage)
def place_transactions(
    key: str,
    ctx: CtxDep,
    db: DbDep,
    source: SourceParam = None,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> TransactionPage:
    """Compras, encargos e estornos do lugar, do mais recente ao mais antigo."""
    page = analysis.place_transactions(
        db, ctx.user_id, key, source=_source(db, ctx, source), cursor=cursor
    )
    return TransactionPage(
        items=[TransactionOut.model_validate(t) for t in page.items],
        next_cursor=page.next_cursor,
    )
