from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.misread_phrase import MisreadReason


class MisreadPhraseIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    reasons: list[MisreadReason] = Field(min_length=1, max_length=len(MisreadReason))


class MisreadPhraseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    text: str
    reasons: list[MisreadReason]
    created_at: datetime
    updated_at: datetime
