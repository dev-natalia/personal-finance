"""Ordem de escolha da categoria de um lançamento."""

from uuid import UUID


def resolve_category(
    explicit: UUID | None, merchant_default: UUID | None, unclassified: UUID
) -> UUID:
    """Explícita → padrão do estabelecimento → 'A classificar'."""
    if explicit is not None:
        return explicit
    if merchant_default is not None:
        return merchant_default
    return unclassified
