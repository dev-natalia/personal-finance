from fastapi import APIRouter

from app.api.routes import (
    accounts,
    auth,
    categories,
    entry,
    health,
    merchants,
    summaries,
    transactions,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(accounts.router)
api_router.include_router(categories.router)
api_router.include_router(merchants.router)
api_router.include_router(transactions.router)
api_router.include_router(entry.router)
api_router.include_router(summaries.router)
