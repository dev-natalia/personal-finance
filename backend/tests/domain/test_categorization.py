from uuid import uuid4

from app.domain.categorization import resolve_category

EXPLICIT, DEFAULT, UNCLASSIFIED = uuid4(), uuid4(), uuid4()


def test_explicit_wins() -> None:
    assert resolve_category(EXPLICIT, DEFAULT, UNCLASSIFIED) == EXPLICIT


def test_merchant_default_when_no_explicit() -> None:
    assert resolve_category(None, DEFAULT, UNCLASSIFIED) == DEFAULT


def test_unclassified_as_last_resort() -> None:
    assert resolve_category(None, None, UNCLASSIFIED) == UNCLASSIFIED
