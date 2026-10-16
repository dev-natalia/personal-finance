"""Normalização determinística de nomes de estabelecimento."""

import re
import unicodedata

_PUNCTUATION = re.compile(r"[^\w\s]")
_SPACES = re.compile(r"\s+")


def normalize(name: str) -> str:
    """Minúsculas, sem acentos, sem pontuação e com espaços compactados.

    'DROGASIL' e 'drogasil' viram o mesmo; 'Drogasil SP' continua diferente de 'Drogasil'.
    """
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    without_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    without_punctuation = _PUNCTUATION.sub(" ", without_accents)
    return _SPACES.sub(" ", without_punctuation).strip()
