"""Datas no fuso da usuária e relógio injetável."""

import calendar
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

_MONTH = re.compile(r"([0-9]{4})-([0-9]{2})")

# Faixa de datas aceita em lançamentos e consultas. Fora dela, a entrada é tratada como erro
# de digitação (e evita estouro de data em cálculos como a janela de ±2 dias).
MIN_DATE = date(1900, 1, 1)
MAX_DATE = date(2100, 12, 31)


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


@dataclass(frozen=True)
class FixedClock:
    at: datetime

    def __post_init__(self) -> None:
        if self.at.tzinfo is None:
            raise ValueError("FixedClock exige datetime com fuso horário.")

    def now(self) -> datetime:
        return self.at


def today(clock: Clock, timezone: str) -> date:
    """Data local da usuária no instante atual do relógio."""
    return clock.now().astimezone(ZoneInfo(timezone)).date()


MONTH_NAMES = (
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
)


def month_name(day: date) -> str:
    """Nome do mês em português, minúsculo ("outubro"), para textos como "fatura de outubro"."""
    return MONTH_NAMES[day.month - 1]


def month_range(year: int, month: int) -> tuple[date, date]:
    """Primeiro e último dia do mês (inclusivos)."""
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def parse_month(text: str) -> tuple[int, int]:
    """Converte 'AAAA-MM' em (ano, mês)."""
    match = _MONTH.fullmatch(text)
    if match is None:
        raise ValueError("O mês deve estar no formato AAAA-MM.")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        raise ValueError("Mês inválido.")
    if not MIN_DATE.year <= year <= MAX_DATE.year:
        raise ValueError(f"O ano deve estar entre {MIN_DATE.year} e {MAX_DATE.year}.")
    return year, month
