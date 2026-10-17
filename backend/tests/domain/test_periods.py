from datetime import date

from app.domain.periods import Period, PeriodKind, has_next, period_containing, shift_period

TODAY = date(2026, 10, 15)


def test_month_of_october() -> None:
    assert period_containing(PeriodKind.MONTH, date(2026, 10, 3), TODAY) == Period(
        PeriodKind.MONTH, date(2026, 10, 1), date(2026, 10, 31)
    )


def test_week_starts_on_monday() -> None:
    # 15/10/2026 é quinta-feira.
    assert period_containing(PeriodKind.WEEK, TODAY, TODAY) == Period(
        PeriodKind.WEEK, date(2026, 10, 12), date(2026, 10, 18)
    )


def test_week_across_new_year() -> None:
    today = date(2027, 1, 10)
    week = period_containing(PeriodKind.WEEK, date(2026, 12, 31), today)
    assert (week.start, week.end) == (date(2026, 12, 28), date(2027, 1, 3))
    following = shift_period(week, 1, today)
    assert (following.start, following.end) == (date(2027, 1, 4), date(2027, 1, 10))
    previous = shift_period(week, -1, today)
    assert (previous.start, previous.end) == (date(2026, 12, 21), date(2026, 12, 27))


def test_current_year_ends_at_end_of_current_month() -> None:
    assert period_containing(PeriodKind.YEAR, date(2026, 2, 1), TODAY) == Period(
        PeriodKind.YEAR, date(2026, 1, 1), date(2026, 10, 31)
    )


def test_past_year_is_complete() -> None:
    year = shift_period(period_containing(PeriodKind.YEAR, TODAY, TODAY), -1, TODAY)
    assert (year.start, year.end) == (date(2025, 1, 1), date(2025, 12, 31))


def test_month_shifts_across_years() -> None:
    january = period_containing(PeriodKind.MONTH, date(2026, 1, 20), TODAY)
    previous = shift_period(january, -1, TODAY)
    assert (previous.start, previous.end) == (date(2025, 12, 1), date(2025, 12, 31))


def test_no_next_period_after_today() -> None:
    assert not has_next(period_containing(PeriodKind.MONTH, TODAY, TODAY), TODAY)
    assert not has_next(period_containing(PeriodKind.WEEK, TODAY, TODAY), TODAY)
    assert not has_next(period_containing(PeriodKind.YEAR, TODAY, TODAY), TODAY)
    assert has_next(period_containing(PeriodKind.MONTH, date(2026, 9, 1), TODAY), TODAY)
