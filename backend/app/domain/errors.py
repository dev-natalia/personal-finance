"""Erros de domínio com código estável e avisos não bloqueantes."""

from dataclasses import dataclass


class DomainError(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


class NotFound(DomainError):
    def __init__(self, what: str = "o recurso") -> None:
        super().__init__("not_found", f"Não encontramos {what}.")


class RuleViolation(DomainError):
    """Regra de negócio violada (HTTP 422)."""


class Conflict(DomainError):
    """Conflito com dados existentes (HTTP 409)."""


class Unauthenticated(DomainError):
    def __init__(
        self, code: str = "unauthenticated", detail: str = "Sessão inválida ou expirada."
    ) -> None:
        super().__init__(code, detail)


class TooManyAttempts(DomainError):
    def __init__(self) -> None:
        super().__init__(
            "too_many_attempts", "Muitas tentativas. Tente novamente em alguns minutos."
        )


@dataclass(frozen=True)
class Notice:
    """Aviso que acompanha uma operação bem-sucedida (ex.: saldo negativo)."""

    code: str
    detail: str
