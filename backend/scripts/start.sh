#!/bin/sh
# Entrada da imagem: aplica as migrações e sobe o servidor.
# FORWARDED_ALLOW_IPS: IPs do proxy reverso em quem confiar para X-Forwarded-* (ver README).
set -eu

alembic upgrade head
exec uvicorn --factory app.main:create_app \
  --host 0.0.0.0 --port 8000 \
  --proxy-headers --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-127.0.0.1}"
