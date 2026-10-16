import pytest

from app.domain.merchants import normalize


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("DROGASIL", "drogasil"),
        ("drogasil", "drogasil"),
        ("Pão de Açúcar", "pao de acucar"),
        ("  Uber   Eats! ", "uber eats"),
        ("D'Ávila", "d avila"),
        ("!!!", ""),
        ("Drogasil SP", "drogasil sp"),
    ],
)
def test_normalize(raw: str, expected: str) -> None:
    assert normalize(raw) == expected


def test_different_names_stay_different() -> None:
    assert normalize("Drogasil SP") != normalize("Drogasil")
