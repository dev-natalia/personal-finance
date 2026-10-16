#!/usr/bin/env bash
# Smoke ponta a ponta contra a imagem de produção (docker compose, perfil "app").
# Usa um banco próprio (finance_e2e), recriado a cada execução: os dados de desenvolvimento
# não são tocados. Requer Docker e as dependências do frontend instaladas (npm ci).
set -euo pipefail
cd "$(dirname "$0")/.."

random() { node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"; }

export APP_DB=finance_e2e
export SECRET_KEY="${SECRET_KEY:-$(random)$(random)}"
email="e2e@example.com"
password="$(random)"

docker compose up -d --wait db
docker compose exec -T db dropdb -U finance --if-exists --force "$APP_DB"
docker compose exec -T db createdb -U finance "$APP_DB"

trap 'docker compose --profile app stop app >/dev/null' EXIT
docker compose --profile app up -d --build --force-recreate --wait app
docker compose exec -T -e PF_NEW_PASSWORD="$password" app python -m app.cli create-user --email "$email"

cd frontend
npx playwright install chromium
E2E_BASE_URL=http://localhost:8080 E2E_EMAIL="$email" E2E_PASSWORD="$password" npx playwright test "$@"
