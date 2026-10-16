"""Operações com dinheiro. Sempre Decimal, nunca ponto flutuante binário."""

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENT = Decimal("0.01")
MAX_AMOUNT = Decimal("999999999999.99")

_PREFIX = re.compile(r"^r\$\s*", re.IGNORECASE)
_ALLOWED = re.compile(r"[0-9.,]+")
_DIGITS = re.compile(r"[0-9]+")
_THOUSANDS = re.compile(r"[0-9]{1,3}(?:\.[0-9]{3})+")


class InvalidMoney(ValueError):
    """Texto que não representa um valor monetário válido."""


def quantize(value: Decimal) -> Decimal:
    """Arredonda para centavos com ROUND_HALF_UP (meio centavo arredonda para longe do zero)."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _integer_part(text: str) -> str:
    if _DIGITS.fullmatch(text):
        return text
    if _THOUSANDS.fullmatch(text):
        return text.replace(".", "")
    raise InvalidMoney(f"Parte inteira inválida: {text!r}.")


def parse_money(text: str) -> Decimal:
    """Interpreta valores digitados em pt-BR: 42 · 42,50 · 42.50 · 1.234,56 · R$ 42.

    Regras: com vírgula, ela é o separador decimal e pontos são de milhar. Sem vírgula,
    um único ponto seguido de 1 ou 2 dígitos é decimal; seguido de 3 dígitos é milhar.
    Mais de 2 casas decimais é rejeitado (nunca arredondado em silêncio).
    """
    cleaned = _PREFIX.sub("", text.strip())
    if not cleaned or not _ALLOWED.fullmatch(cleaned):
        raise InvalidMoney(f"Valor inválido: {text!r}.")

    if "," in cleaned:
        integer, _, decimals = cleaned.partition(",")
        if not decimals or not _DIGITS.fullmatch(decimals):
            raise InvalidMoney(f"Valor inválido: {text!r}.")
        if len(decimals) > 2:
            raise InvalidMoney("O valor tem mais de 2 casas decimais.")
        normalized = f"{_integer_part(integer)}.{decimals}"
    elif cleaned.count(".") == 1:
        integer, _, fraction = cleaned.partition(".")
        if not integer:
            raise InvalidMoney(f"Valor inválido: {text!r}.")
        if len(fraction) in (1, 2):
            normalized = f"{integer}.{fraction}"
        elif len(fraction) == 3 and len(integer) <= 3:
            normalized = integer + fraction
        else:
            raise InvalidMoney(f"Valor inválido: {text!r}.")
    else:
        normalized = _integer_part(cleaned)

    try:
        value = Decimal(normalized)
    except InvalidOperation as exc:
        raise InvalidMoney(f"Valor inválido: {text!r}.") from exc
    if value > MAX_AMOUNT:
        raise InvalidMoney("Valor acima do máximo permitido.")
    return quantize(value)


def format_brl(value: Decimal) -> str:
    """Formata em reais: R$ 1.234,56 (negativos com '-' antes de 'R$')."""
    q = quantize(value) + Decimal(0)
    sign = "-" if q < 0 else ""
    integer, _, cents = f"{abs(q):.2f}".partition(".")
    groups: list[str] = []
    while len(integer) > 3:
        groups.insert(0, integer[-3:])
        integer = integer[:-3]
    groups.insert(0, integer)
    return f"{sign}R$ {'.'.join(groups)},{cents}"


def to_api(value: Decimal) -> str:
    """Representação canônica para JSON: '1234.56'."""
    return f"{quantize(value) + Decimal(0):.2f}"
