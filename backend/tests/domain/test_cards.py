from datetime import date
from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.domain.cards import (
    MAX_INSTALLMENTS,
    MIN_INSTALLMENTS,
    add_months,
    consumption_month,
    invoice_dates,
    invoice_month_for,
    split_installments,
)


@pytest.mark.parametrize(
    ("reference_month", "closing_day", "due_day", "expected"),
    [
        # Nubank da usuária: fecha 3, vence 10, ambos no mês da fatura.
        (date(2026, 11, 1), 3, 10, (date(2026, 11, 3), date(2026, 11, 10))),
        # Vencimento antes do fechamento no calendário: fecha no mês anterior.
        (date(2026, 11, 1), 28, 5, (date(2026, 10, 28), date(2026, 11, 5))),
        (date(2027, 2, 1), 31, 10, (date(2027, 1, 31), date(2027, 2, 10))),
        # Dia inexistente no mês vira o último dia (A7).
        (date(2026, 11, 1), 3, 31, (date(2026, 11, 3), date(2026, 11, 30))),
        (date(2027, 3, 1), 31, 5, (date(2027, 2, 28), date(2027, 3, 5))),
        (date(2028, 3, 1), 30, 5, (date(2028, 2, 29), date(2028, 3, 5))),
        # Virada de ano.
        (date(2027, 1, 1), 28, 5, (date(2026, 12, 28), date(2027, 1, 5))),
    ],
)
def test_invoice_dates(
    reference_month: date, closing_day: int, due_day: int, expected: tuple[date, date]
) -> None:
    assert invoice_dates(reference_month, closing_day, due_day) == expected


def test_purchase_on_closing_day_goes_to_next_invoice() -> None:
    assert invoice_month_for(date(2026, 11, 3), 3, 10) == date(2026, 12, 1)


@pytest.mark.parametrize(
    ("purchase", "closing_day", "due_day", "expected"),
    [
        (date(2026, 11, 2), 3, 10, date(2026, 11, 1)),
        (date(2026, 10, 16), 3, 10, date(2026, 11, 1)),
        (date(2026, 12, 31), 3, 10, date(2027, 1, 1)),
        # Fecha 28 e vence 5: compra em 27/10 entra na fatura que fecha 28/10 (vence em novembro).
        (date(2026, 10, 27), 28, 5, date(2026, 11, 1)),
        (date(2026, 10, 28), 28, 5, date(2026, 12, 1)),
        # Fechamento no último dia de um mês curto (31 → 28/02).
        (date(2027, 2, 27), 31, 10, date(2027, 3, 1)),
        (date(2027, 2, 28), 31, 10, date(2027, 4, 1)),
    ],
)
def test_invoice_month_for(purchase: date, closing_day: int, due_day: int, expected: date) -> None:
    assert invoice_month_for(purchase, closing_day, due_day) == expected


def test_add_months_crosses_years() -> None:
    assert add_months(date(2026, 11, 1), 5) == date(2027, 4, 1)
    assert add_months(date(2026, 1, 1), -1) == date(2025, 12, 1)


def test_split_installments_even() -> None:
    assert split_installments(Decimal("1200.00"), 6) == [Decimal("200.00")] * 6


def test_split_installments_remainder_goes_to_first() -> None:
    assert split_installments(Decimal("100.00"), 3) == [
        Decimal("33.34"),
        Decimal("33.33"),
        Decimal("33.33"),
    ]


def test_split_installments_rejects_out_of_range_count() -> None:
    with pytest.raises(ValueError):
        split_installments(Decimal("100.00"), MIN_INSTALLMENTS - 1)
    with pytest.raises(ValueError):
        split_installments(Decimal("100.00"), MAX_INSTALLMENTS + 1)


@given(
    cents=st.integers(min_value=2, max_value=99_999_999_999),
    count=st.integers(min_value=MIN_INSTALLMENTS, max_value=MAX_INSTALLMENTS),
)
def test_split_installments_always_sums_to_total(cents: int, count: int) -> None:
    total = Decimal(cents) / 100
    parts = split_installments(total, count)
    assert len(parts) == count
    assert sum(parts) == total
    assert all(p == p.quantize(Decimal("0.01")) for p in parts)
    if cents >= count:
        assert all(p >= Decimal("0.01") for p in parts)


def test_consumption_month() -> None:
    assert consumption_month(date(2026, 10, 16), 1) == date(2026, 10, 1)
    assert consumption_month(date(2026, 10, 16), 4) == date(2027, 1, 1)
