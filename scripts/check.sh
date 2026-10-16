#!/usr/bin/env bash
# Roda lint, checagem de tipos e testes do backend. Requer o Postgres do docker compose no ar.
set -euo pipefail
cd "$(dirname "$0")/../backend"
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest -q
