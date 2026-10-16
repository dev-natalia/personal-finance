from datetime import UTC, date, datetime

import pytest

from app.domain.dates import FixedClock, SystemClock, month_range, parse_month, today


def test_today_uses_user_timezone_near_midnight() -> None:
    clock = FixedClock(datetime(2026, 10, 16, 2, 30, tzinfo=UTC))  # 23h30 de 15/10 em São Paulo
    assert today(clock, "America/Sao_Paulo") == date(2026, 10, 15)
    assert today(clock, "UTC") == date(2026, 10, 16)


def test_fixed_clock_requires_timezone() -> None:
    with pytest.raises(ValueError):
        FixedClock(datetime(2026, 10, 15, 12, 0))


def test_system_clock_is_timezone_aware() -> None:
    assert SystemClock().now().tzinfo is not None


@pytest.mark.parametrize(
    ("year", "month", "expected"),
    [
        (2026, 10, (date(2026, 10, 1), date(2026, 10, 31))),
        (2026, 2, (date(2026, 2, 1), date(2026, 2, 28))),
        (2028, 2, (date(2028, 2, 1), date(2028, 2, 29))),
    ],
)
def test_month_range(year: int, month: int, expected: tuple[date, date]) -> None:
    assert month_range(year, month) == expected


def test_parse_month_accepts_iso_month() -> None:
    assert parse_month("2026-10") == (2026, 10)


@pytest.mark.parametrize(
    "text", ["2026-13", "2026-00", "26-10", "2026/10", "abc", "", "0000-01", "1899-12", "2101-01"]
)
def test_parse_month_rejects(text: str) -> None:
    with pytest.raises(ValueError):
        parse_month(text)
