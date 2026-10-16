"""Erros HTTP no formato Problem Details (RFC 9457) com `code` estável."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import DataError, IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.security_headers import apply_security_headers
from app.domain.errors import (
    Conflict,
    DomainError,
    NotFound,
    RuleViolation,
    TooManyAttempts,
    Unauthenticated,
)
from app.models import TransactionType

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


# Erros de protocolo (fora das regras de negócio) também com código estável e texto em português.
_HTTP_ERRORS: dict[int, tuple[str, str]] = {
    400: ("invalid_body", "O corpo da requisição não pôde ser lido (envie JSON em UTF-8)."),
    404: ("not_found", "Endereço não encontrado."),
    405: ("method_not_allowed", "Método não permitido neste endereço."),
}
# Rótulos do union de lançamentos que o Pydantic põe no caminho do campo (ex.: "EXPENSE.amount").
_UNION_TAGS = frozenset(t.value for t in TransactionType)


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
    if any(err["type"] == "json_invalid" for err in exc.errors()):
        return problem(
            422,
            "invalid_body",
            "O corpo da requisição não é um JSON válido.",
            request_id_of(request),
        )
    # O valor recebido (`input`) nunca volta na resposta: pode conter dados financeiros.
    errors = [
        # Mensagens próprias (ValueError dos validadores) chegam com um prefixo em inglês.
        {"field": _field_path(err["loc"]), "message": err["msg"].removeprefix("Value error, ")}
        for err in exc.errors()
    ]
    detail = "Alguns campos são inválidos."
    # Regra que envolve vários campos (ex.: conta ou cartão) não aponta um campo só: a
    # mensagem dela vira o detalhe, que a tela sempre mostra.
    if len(errors) == 1 and errors[0]["field"] == "body":
        message = errors[0]["message"]
        detail = message[:1].upper() + message[1:].rstrip(".") + "."
    return problem(422, "validation_error", detail, request_id_of(request), errors=errors)


def _field_path(loc: tuple[int | str, ...]) -> str:
    parts = [str(part) for part in loc[1:] if str(part) not in _UNION_TAGS]
    return ".".join(parts) or str(loc[0])


async def _http_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    code, detail = _HTTP_ERRORS.get(exc.status_code, ("http_error", str(exc.detail)))
    return problem(exc.status_code, code, detail, request_id_of(request))


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
    response = problem(
        500,
        "internal_error",
        "Erro inesperado. Informe o código da requisição se o problema continuar.",
        request_id_of(request),
    )
    # O erro 500 é respondido fora da pilha de middlewares: os cabeçalhos são postos aqui.
    response.headers["X-Request-ID"] = request_id_of(request)
    apply_security_headers(response.headers)
    return response


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _domain_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(IntegrityError, _integrity_error)
    app.add_exception_handler(DataError, _data_error)
    app.add_exception_handler(Exception, _unexpected_error)
