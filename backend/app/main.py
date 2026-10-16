"""Aplicação FastAPI. Rodar com: uv run uvicorn --factory app.main:create_app"""

import logging

from fastapi import FastAPI

from app import __version__
from app.api.errors import install_error_handlers
from app.api.middleware import install_middlewares
from app.api.routes import api_router
from app.config import Settings, get_settings
from app.db import make_engine, make_sessionmaker
from app.domain.dates import Clock, SystemClock


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level)
    # O log de acesso do uvicorn grava a query string (ex.: ?q=<estabelecimento digitado>).
    # O log próprio (app.access) registra só método, caminho, status e duração.
    logging.getLogger("uvicorn.access").disabled = True
    app = FastAPI(
        title="Assistente Financeiro Pessoal",
        version=__version__,
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.enable_docs else None,
    )
    app.state.settings = settings
    app.state.sessionmaker = make_sessionmaker(make_engine(settings.database_url))
    app.state.clock = clock or SystemClock()
    install_error_handlers(app)
    install_middlewares(app, settings)
    app.include_router(api_router, prefix="/api/v1")
    return app
