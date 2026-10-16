"""Estabelecimentos e a memória estabelecimento → categoria."""

import uuid
from uuid import UUID

from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.domain.merchants import normalize
from app.models import Merchant


def resolve_merchant(session: Session, user_id: UUID, name: str | None) -> Merchant | None:
    """Encontra o estabelecimento pelo nome normalizado ou cria um novo."""
    if name is None:
        return None
    normalized = normalize(name)[:120]
    if not normalized:
        return None
    by_name = select(Merchant).where(
        Merchant.user_id == user_id, Merchant.normalized_name == normalized
    )
    merchant = session.scalar(by_name)
    if merchant is None:
        # ON CONFLICT: se outra requisição criou o mesmo estabelecimento ao mesmo tempo,
        # esperamos o commit dela e reaproveitamos o registro, em vez de falhar.
        session.execute(
            insert(Merchant)
            .values(
                id=uuid.uuid7(),
                user_id=user_id,
                name=name.strip()[:120],
                normalized_name=normalized,
            )
            .on_conflict_do_nothing(index_elements=["user_id", "normalized_name"])
        )
        merchant = session.scalars(by_name).one()
    return merchant


def search_merchants(
    session: Session, user_id: UUID, query: str, limit: int = 10
) -> list[Merchant]:
    normalized = normalize(query)
    if not normalized:
        return []
    exact_first = case((Merchant.normalized_name == normalized, 0), else_=1)
    stmt = (
        select(Merchant)
        .where(
            Merchant.user_id == user_id,
            Merchant.normalized_name.contains(normalized, autoescape=True),
        )
        .order_by(exact_first, Merchant.normalized_name)
        .limit(limit)
    )
    return list(session.scalars(stmt))
