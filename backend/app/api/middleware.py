"""Request id + log de acesso, cabeçalhos de segurança e proteção CSRF."""

import logging
import time
import uuid

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import RequestResponseEndpoint

from app.api.errors import problem, request_id_of
from app.api.security_headers import apply_security_headers
from app.config import Settings

logger = logging.getLogger("app.access")

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Rotas chamadas por máquinas com token próprio (sem cookie): CSRF não se aplica.
TOKEN_ONLY_PREFIX = "/api/v1/internal/"


def install_middlewares(app: FastAPI, settings: Settings) -> None:
    # O último registrado é o mais externo: request_context envolve todos os outros.

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if (
            request.method in UNSAFE_METHODS
            and path.startswith("/api/")
            and not path.startswith(TOKEN_ONLY_PREFIX)
        ):
            same_origin = request.headers.get("origin") == settings.app_origin
            if not same_origin or "x-requested-with" not in request.headers:
                return problem(
                    403,
                    "origin_not_allowed",
                    "Origem da requisição não permitida.",
                    request_id_of(request),
                )
        return await call_next(request)

    @app.middleware("http")
    async def security_headers(request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        # A documentação interativa carrega scripts de CDN: sem CSP só nela.
        is_docs = settings.enable_docs and request.url.path.startswith("/docs")
        apply_security_headers(response.headers, skip_csp=is_docs)
        return response

    @app.middleware("http")
    async def request_context(request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()
        # Só método, caminho (sem query string), status e duração: nada de corpo ou valores.
        try:
            response = await call_next(request)
        except Exception:
            logger.error(
                "request_id=%s method=%s path=%s status=500",
                request_id,
                request.method,
                request.url.path,
            )
            raise
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        return response
