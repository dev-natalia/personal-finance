"""Serve o app compilado (SPA) na mesma origem da API."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

_NO_CACHE = {"Cache-Control": "no-cache"}
# Arquivos de `assets/` têm hash no nome: podem ficar em cache para sempre.
_IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}


def install_frontend(app: FastAPI, dist: Path) -> None:
    """Registra, depois das rotas da API, a rota que entrega arquivos do build ou o index.html."""
    root = dist.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"FRONTEND_DIST não contém index.html: {root}")

    # HEAD também: monitores de disponibilidade e balanceadores costumam checar com ele.
    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (root / path).resolve()
        # Só arquivos dentro do build; qualquer outro caminho é rota do SPA.
        if path and candidate.is_relative_to(root) and candidate.is_file():
            cache = _IMMUTABLE if candidate.parent == root / "assets" else _NO_CACHE
            return FileResponse(candidate, headers=cache)
        return FileResponse(index, headers=_NO_CACHE)
