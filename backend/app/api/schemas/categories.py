from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.api.schemas.common import CategoryName
from app.models import CategoryKind


class CategoryIn(BaseModel):
    name: CategoryName
    kind: CategoryKind
    is_essential: bool = False


class CategoryPatch(BaseModel):
    name: CategoryName | None = None
    is_essential: bool | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kind: CategoryKind
    is_essential: bool
    is_system: bool
    archived_at: datetime | None
