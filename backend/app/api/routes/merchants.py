from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CtxDep, DbDep
from app.api.schemas.merchants import MerchantOut
from app.models import Merchant
from app.services.merchants import search_merchants

router = APIRouter(prefix="/merchants", tags=["merchants"])


@router.get("", response_model=list[MerchantOut])
def search(
    ctx: CtxDep, db: DbDep, q: Annotated[str, Query(min_length=1, max_length=120)]
) -> list[Merchant]:
    return search_merchants(db, ctx.user_id, q)
