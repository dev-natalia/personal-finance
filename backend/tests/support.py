"""Constantes e fábricas compartilhadas pelos testes."""

from datetime import UTC, datetime, timedelta

from app.services.auth import SessionPolicy

PASSWORD = "senha-super-secreta"
FIXED_NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)  # 12h00 em São Paulo
POLICY = SessionPolicy(secret_key=b"k" * 32, idle=timedelta(days=30), max_age=timedelta(days=90))
