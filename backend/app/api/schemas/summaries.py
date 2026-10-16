from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.api.schemas.common import Money


class CategoryAmountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category_id: UUID
    name: str
    amount: Money


class MonthSummaryOut(BaseModel):
    month: str
    income: Money
    consumption_total: Money
    by_category: list[CategoryAmountOut]
