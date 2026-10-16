"""Imprime o contrato OpenAPI da API (usado para gerar os tipos do frontend).

Uso (em backend/): uv run python scripts/export_openapi.py > ../frontend/openapi.json
Não conecta ao banco: as configurações abaixo são fictícias.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.main import create_app


def main() -> None:
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        database_url="postgresql+psycopg://openapi:openapi@127.0.0.1:1/openapi",
        secret_key="x" * 32,
        app_origin="http://localhost",
        enable_docs=True,
    )
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    print(json.dumps(create_app(settings).openapi(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
