from datetime import date
from uuid import UUID

from pydantic import BaseModel

from app.api.schemas.common import Money
from app.api.schemas.transactions import TransactionOut
from app.domain.periods import PeriodKind


class PeriodOut(BaseModel):
    kind: PeriodKind
    start: date
    end: date
    has_next: bool


class CategoryTotalOut(BaseModel):
    """`category_id` nulo: "Outras" (não filtra)."""

    category_id: UUID | None
    name: str
    amount: Money


class PlaceTotalOut(BaseModel):
    key: str
    name: str
    amount: Money
    purchases: int
    category_name: str | None


class DayTotalOut(BaseModel):
    """No período do ano, um por mês (`day` = dia 1)."""

    day: date
    amount: Money


class AnalysisSummaryOut(BaseModel):
    period: PeriodOut
    total: Money
    by_category: list[CategoryTotalOut]
    by_place: list[PlaceTotalOut]
    by_day: list[DayTotalOut]
    busiest: DayTotalOut | None
    # "account:<id>" / "card:<id>" com gasto no período (sem o filtro de origem).
    sources: list[str]


class DaySpendingOut(BaseModel):
    transaction: TransactionOut
    # O que conta no dia (a parcela, no modo parcelas).
    amount: Money


class PlaceTotalsOut(BaseModel):
    amount: Money
    purchases: int


class PlaceDetailOut(BaseModel):
    key: str
    name: str
    category_name: str | None
    week: PlaceTotalsOut
    month: PlaceTotalsOut
    year: PlaceTotalsOut
    average: Money | None
