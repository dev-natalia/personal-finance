"""Configuração por variáveis de ambiente (ou arquivo .env em desenvolvimento)."""

from functools import lru_cache

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    secret_key: SecretStr
    app_origin: str
    cookie_secure: bool = True
    enable_docs: bool = False
    session_idle_days: int = 30
    session_max_days: int = 90
    log_level: str = "INFO"
    # Cabeçalho com o IP real definido pelo proxy da hospedagem (no Fly.io: "Fly-Client-IP").
    # Vazio = IP da conexão. Só configure quando o app não for alcançável fora desse proxy.
    client_ip_header: str | None = None
    # Pasta do build do frontend (frontend/dist). Vazio = só a API (desenvolvimento).
    frontend_dist: str | None = None

    @field_validator("secret_key")
    @classmethod
    def _secret_long_enough(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("SECRET_KEY deve ter pelo menos 32 caracteres.")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
