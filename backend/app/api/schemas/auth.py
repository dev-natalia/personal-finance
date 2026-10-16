from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.api.schemas.common import NoNul


class LoginIn(BaseModel):
    email: Annotated[str, Field(min_length=3, max_length=320), NoNul]
    password: Annotated[str, Field(min_length=1, max_length=200), NoNul]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    timezone: str
