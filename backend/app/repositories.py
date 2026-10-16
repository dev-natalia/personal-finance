"""Acesso a dados sempre restrito à usuária dona do registro."""

from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.domain.errors import NotFound
from app.models import OwnedModel


def owned_select[M: OwnedModel](model: type[M], user_id: UUID) -> Select[M]:
    return select(model).where(model.user_id == user_id)


def get_owned[M: OwnedModel](
    session: Session,
    model: type[M],
    obj_id: UUID,
    user_id: UUID,
    what: str,
    *,
    for_update: bool = False,
) -> M:
    """Busca por id; registro inexistente ou de outra usuária é tratado igual (404)."""
    obj = session.get(model, obj_id, with_for_update=for_update)
    if obj is None or obj.user_id != user_id:
        raise NotFound(what)
    return obj
