"""Tipos compartilhados pelos schemas da API."""

import re
from collections.abc import Iterable
from datetime import date
from decimal import Decimal
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
)

from app.domain.dates import MAX_DATE, MIN_DATE
from app.domain.errors import Notice
from app.domain.money import to_api

_MONEY_PATTERN = r"-?[0-9]{1,12}(\.[0-9]{1,2})?"
_MONEY = re.compile(_MONEY_PATTERN)


def _parse_money(value: object) -> Decimal:
    """Dinheiro chega como string ("42.50"). Números JSON são recusados para evitar imprecisão."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, str) and _MONEY.fullmatch(value):
        return Decimal(value)
    raise ValueError('use uma string com até 2 casas decimais, por exemplo "42.50"')


Money = Annotated[
    Decimal,
    BeforeValidator(_parse_money),
    PlainSerializer(to_api, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": f"^{_MONEY_PATTERN}$", "examples": ["42.50"]}),
]
PositiveMoney = Annotated[Money, Field(gt=0)]

# Datas de entrada (corpo e query): fora de 1900-2100 é erro de digitação.
ApiDate = Annotated[date, Field(ge=MIN_DATE, le=MAX_DATE)]


def _reject_nul(value: str) -> str:
    """O PostgreSQL não aceita o caractere nulo em textos; recusamos antes de chegar lá."""
    if "\x00" in value:
        raise ValueError("o texto contém um caractere inválido")
    return value


NoNul = AfterValidator(_reject_nul)

Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), NoNul
]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000), NoNul]
MerchantName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120), NoNul
]
AccountName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80), NoNul
]
CategoryName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60), NoNul
]


class NoticeOut(BaseModel):
    code: str
    detail: str

    @classmethod
    def many(cls, notices: Iterable[Notice]) -> list[Self]:
        return [cls(code=n.code, detail=n.detail) for n in notices]
