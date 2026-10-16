"""Erros HTTP no formato Problem Details (RFC 9457) com `code` estável."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import DataError, IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain.errors import (
    Conflict,
    DomainError,
    NotFound,
    RuleViolation,
    TooManyAttempts,
    Unauthenticated,
)

logger = logging.getLogger("app.errors")

_STATUS: dict[type[DomainError], int] = {
    NotFound: 404,
    RuleViolation: 422,
    Conflict: 409,
    Unauthenticated: 401,
    TooManyAttempts: 429,
}
_TITLES = {
    401: "Não autenticado",
    403: "Proibido",
    404: "Não encontrado",
    405: "Método não permitido",
    409: "Conflito",
    422: "Requisição inválida",
    429: "Muitas tentativas",
    500: "Erro interno",
}


def request_id_of(request: Request) -> str:
    return str(getattr(request.state, "request_id", ""))


def problem(status: int, code: str, detail: str, request_id: str, **extra: Any) -> JSONResponse:
    body = {
        "type": f"/problems/{code}",
        "title": _TITLES.get(status, "Erro"),
        "status": status,
        "code": code,
        "detail": detail,
        "request_id": request_id,
        **extra,
    }
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


def _status_for(exc: DomainError) -> int:
    for cls in type(exc).__mro__:
        if cls in _STATUS:
            return _STATUS[cls]
    return 400


async def _domain_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, DomainError)
    return problem(_status_for(exc), exc.code, exc.detail, request_id_of(request))


async def _validation_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)
    # O valor recebido (`input`) nunca volta na resposta: pode conter dados financeiros.
    errors = [
        {
            "field": ".".join(str(part) for part in err["loc"][1:]) or str(err["loc"][0]),
            "message": err["msg"],
        }
        for err in exc.errors()
    ]
    return problem(
        422,
        "validation_error",
        "Alguns campos são inválidos.",
        request_id_of(request),
        errors=errors,
    )


async def _http_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    return problem(exc.status_code, "http_error", str(exc.detail), request_id_of(request))


async def _integrity_error(request: Request, exc: Exception) -> Response:
    logger.warning("integrity_error request_id=%s", request_id_of(request))
    return problem(
        409, "conflict", "A operação conflita com dados existentes.", request_id_of(request)
    )


async def _data_error(request: Request, exc: Exception) -> Response:
    # Valor que o banco recusa (ex.: caractere nulo numa busca). O valor não vai para o log.
    logger.warning("data_error request_id=%s", request_id_of(request))
    return problem(
        422, "invalid_value", "Algum valor enviado não pôde ser processado.", request_id_of(request)
    )


async def _unexpected_error(request: Request, exc: Exception) -> Response:
    logger.exception("unhandled_error request_id=%s", request_id_of(request))
    return problem(
        500,
        "internal_error",
        "Erro inesperado. Informe o código da requisição se o problema continuar.",
        request_id_of(request),
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _domain_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(IntegrityError, _integrity_error)
    app.add_exception_handler(DataError, _data_error)
    app.add_exception_handler(Exception, _unexpected_error)
