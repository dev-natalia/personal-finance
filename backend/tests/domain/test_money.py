from decimal import Decimal
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.domain.money import MAX_AMOUNT, InvalidMoney, format_brl, parse_money, quantize, to_api


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("42", "42.00"),
        ("42,5", "42.50"),
        ("42,50", "42.50"),
        ("42.50", "42.50"),
        ("42.5", "42.50"),
        ("1.234", "1234.00"),
        ("1.234,56", "1234.56"),
        ("12.345.678,90", "12345678.90"),
        ("R$ 42", "42.00"),
        ("r$42,10", "42.10"),
        ("  7 ", "7.00"),
        ("0,01", "0.01"),
        ("1234", "1234.00"),
        ("1234,5", "1234.50"),
    ],
)
def test_parse_money_accepts(text: str, expected: str) -> None:
    assert parse_money(text) == Decimal(expected)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "abc",
        "42,505",
        "42.505.1",
        "1.2345",
        "1234.567",
        ",50",
        "42,",
        "42.",
        "1,2,3",
        "-5",
        "12.34,56",
        "1.23.456",
        "999.999.999.999,991",
        "1.000.000.000.000,00",
        "٤٢",
    ],
)
def test_parse_money_rejects(text: str) -> None:
    with pytest.raises(InvalidMoney):
        parse_money(text)


def test_quantize_rounds_half_up() -> None:
    assert quantize(Decimal("0.005")) == Decimal("0.01")
    assert quantize(Decimal("2.345")) == Decimal("2.35")
    assert quantize(Decimal("-2.345")) == Decimal("-2.35")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("0", "R$ 0,00"),
        ("42.5", "R$ 42,50"),
        ("1234.56", "R$ 1.234,56"),
        ("-1234.56", "-R$ 1.234,56"),
        ("1000000", "R$ 1.000.000,00"),
    ],
)
def test_format_brl(value: str, expected: str) -> None:
    assert format_brl(Decimal(value)) == expected


def test_to_api() -> None:
    assert to_api(Decimal("42.5")) == "42.50"
    assert to_api(Decimal("-3")) == "-3.00"
    assert to_api(Decimal("-0.001")) == "0.00"


@given(st.decimals(min_value=Decimal("0"), max_value=MAX_AMOUNT, places=2))
def test_format_then_parse_roundtrip(value: Decimal) -> None:
    assert parse_money(format_brl(value)) == value


def test_domain_never_uses_binary_floating_point() -> None:
    domain_dir = Path(__file__).resolve().parents[2] / "app" / "domain"
    offenders = [
        p.name for p in domain_dir.glob("*.py") if "float" in p.read_text(encoding="utf-8")
    ]
    assert offenders == []
