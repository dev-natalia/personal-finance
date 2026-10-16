# syntax=docker/dockerfile:1
# Imagem única: o FastAPI serve a API e o frontend compilado na mesma origem.

# 1) Frontend: build do Vite (PWA incluído).
FROM node:24-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2) Backend: dependências travadas no uv.lock, sem as de desenvolvimento.
FROM python:3.14-slim AS app
COPY --from=ghcr.io/astral-sh/uv:0.11.19 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend-dist

# O venv já vem pronto: em produção roda direto, sem `uv run`.
ENV PATH=/app/backend/.venv/bin:$PATH \
    FRONTEND_DIST=/app/frontend-dist
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2)"]
CMD ["sh", "scripts/start.sh"]
