# Assistente Financeiro Pessoal

Aplicação pessoal de controle financeiro com registro por frases curtas e, futuramente, assistente de IA.

- Decisões e regras financeiras: `docs/superpowers/specs/2026-10-15-visao-geral-design.md`
- Subprojeto 1 (fundação e lançamentos): `docs/superpowers/specs/2026-10-15-fundacao-e-lancamentos-design.md`

## Requisitos

- Docker (com Compose)
- [uv](https://docs.astral.sh/uv/) — instala o Python 3.14 automaticamente
- Node.js 24 (para o frontend)
- No Windows, use o Git Bash para os comandos abaixo

## Rodando o backend

```bash
docker compose up -d db
cd backend
uv sync
cp .env.example .env          # ajuste SECRET_KEY
uv run alembic upgrade head
uv run python -m app.cli create-user --email voce@example.com
uv run uvicorn --factory app.main:create_app --reload
```

- API em `http://localhost:8000/api/v1`; documentação em `http://localhost:8000/docs` (com `ENABLE_DOCS=true`).
- Não existe cadastro público: usuárias são criadas só pelo comando `create-user`.
- Toda requisição que altera dados precisa dos cabeçalhos `Origin` (igual a `APP_ORIGIN`) e `X-Requested-With` — proteção contra CSRF. Por isso o botão "Try it out" da documentação não funciona para POST/PATCH; use `curl`:

```bash
curl -i -c cookies.txt -H "Origin: http://localhost:5173" -H "X-Requested-With: curl" \
  -H "Content-Type: application/json" \
  -d '{"email":"voce@example.com","password":"SUA_SENHA"}' \
  http://localhost:8000/api/v1/auth/login
```

## Rodando o frontend

Com o backend rodando (passo anterior), em outro terminal:

```bash
cd frontend
npm install
npm run dev
```

Abra `http://localhost:5173`. O Vite repassa `/api` para o backend na porta 8000, então navegador e API ficam na mesma origem. O `.env` do backend precisa ter `APP_ORIGIN=http://localhost:5173` e `COOKIE_SECURE=false` (já é o que vem no `.env.example`): sem HTTPS local, um cookie `Secure` não seria gravado.

```bash
npm run check        # tipos, testes (Vitest) e build
```

### Gerando os tipos da API

Os tipos TypeScript em `frontend/src/api/schema.d.ts` vêm do OpenAPI do backend. Depois de mudar qualquer rota ou schema da API:

```bash
cd frontend
npm run api:types
```

## Imagem de produção

Uma imagem só: o FastAPI serve a API e o frontend compilado na mesma origem, e aplica as migrações ao iniciar.

```bash
SECRET_KEY=<pelo menos 32 caracteres> docker compose --profile app up -d --build
docker compose exec app python -m app.cli create-user --email voce@example.com
```

Abra `http://localhost:8080` (a porta 8000 continua livre para o backend de desenvolvimento). Por padrão usa o mesmo banco `finance` do desenvolvimento; `APP_DB=outro_banco` troca.

Teste ponta a ponta (Playwright, celular) contra a imagem, num banco próprio recriado a cada execução:

```bash
bash scripts/e2e.sh
```

Em produção, defina `DATABASE_URL`, `SECRET_KEY`, `APP_ORIGIN` (o endereço HTTPS público), deixe `COOKIE_SECURE` no padrão (`true`) e configure `FORWARDED_ALLOW_IPS` conforme a seção sobre proxy abaixo.

## Instalando no celular

O app é um PWA. Abra o endereço HTTPS do servidor no celular e escolha "Adicionar à tela inicial" (Chrome no Android) ou Compartilhar → "Adicionar à Tela de Início" (Safari no iPhone). Ele abre em tela cheia, como um aplicativo.

Só a estrutura do app fica guardada no aparelho; saldos e lançamentos vêm sempre do servidor. Sem conexão, o app avisa e o texto digitado é preservado, mas nada é registrado até a conexão voltar.

## Administração

```bash
uv run python -m app.cli set-password --email voce@example.com     # troca a senha e encerra sessões
uv run python -m app.cli revoke-sessions --email voce@example.com  # encerra todas as sessões
```

## Implantação atrás de proxy (nuvem)

Plataformas como Railway, Render e Fly.io colocam um proxy na frente da aplicação. Sem a configuração abaixo, todas as requisições parecem vir do IP do proxy, e o limite de tentativas de login por IP vira um limite único para todo mundo:

```bash
uv run uvicorn --factory app.main:create_app --host 0.0.0.0 --port 8000 \
  --proxy-headers --forwarded-allow-ips="<IP ou faixa do proxy da plataforma>"
```

Use em `--forwarded-allow-ips` só o endereço do proxy da plataforma (nunca `*` com a porta exposta diretamente), senão qualquer cliente pode falsificar o próprio IP pelo cabeçalho `X-Forwarded-For`. Na imagem de produção, o mesmo valor vai na variável `FORWARDED_ALLOW_IPS`.

## Testes e verificação

```bash
bash scripts/check.sh
```

Roda ruff, mypy e pytest. Os testes usam o banco `finance_test` do docker compose (porta 5433). Para o frontend, `npm run check` em `frontend/`; para o teste ponta a ponta, `bash scripts/e2e.sh`.
