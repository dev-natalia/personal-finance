# Assistente Financeiro Pessoal

Aplicação pessoal de controle financeiro com registro por frases curtas e, futuramente, assistente de IA.

- Decisões e regras financeiras: `docs/superpowers/specs/2026-10-15-visao-geral-design.md`
- Subprojeto 1 (fundação e lançamentos): `docs/superpowers/specs/2026-10-15-fundacao-e-lancamentos-design.md`
- Subprojeto 2 (cartões e faturas): `docs/superpowers/specs/2026-10-16-cartoes-e-faturas-design.md`
- Subprojeto 3 (análise): `docs/superpowers/specs/2026-10-17-analise-design.md`

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

Em produção, defina `DATABASE_URL`, `SECRET_KEY`, `APP_ORIGIN` (o endereço HTTPS público), deixe `COOKIE_SECURE` no padrão (`true`) e configure o IP do cliente conforme a seção sobre proxy abaixo (no Fly.io, ver "Publicação").

## Cartões e faturas

**Cadastro.** Em "Contas e cartões" → "Adicionar cartão": nome, limite, dia de fechamento e dia de vencimento. O cartão começa a ser acompanhado numa data (padrão: hoje); compras antes dela não entram como compra normal. O passo opcional "Como está hoje" traz o que já existe sem lançar o passado compra por compra:

- **Total da fatura aberta agora**: entra como saldo inicial da fatura atual.
- **Fatura fechada sem pagar**: total e vencimento, para pagá-la pelo app.
- **Parceladas em andamento**: uma linha por compra (valor total, número de parcelas, data da compra e quantas faltam depois da fatura atual). Só as parcelas que faltam entram nas próximas faturas.

**Registro.** A frase reconhece cartão por "crédito" ou "cartão" e parcelas por "6x" ou "6 vezes" (de 2 a 24): `1200 celular crédito nubank 6x`. Quando o nome é o mesmo de uma conta (Nubank conta e Nubank cartão), o comprovante pergunta como foi pago. Antes de confirmar, o comprovante mostra a fatura e o limite antes e depois da compra; os valores vêm do backend. Uma compra no dia do fechamento ou depois cai na fatura seguinte; parcelas são arredondadas para baixo no centavo e a sobra vai na primeira.

**Tela do cartão** (`/cartoes/:id`): fatura aberta, datas, limite usado e disponível (o limite conta também as parcelas futuras). Na fatura fechada a pagar, o campo "Total no {cartão}" compara o total do banco com o calculado aqui e diz quanto falta ou sobra; os atalhos registram a compra esquecida (na véspera do fechamento) ou um encargo (juros, IOF). Faturas futuras, compras da fatura e faturas anteriores ficam em seções recolhíveis.

**Pagamento.** "Pagar fatura de {mês}" aceita até 5 contas de origem. Se faltar algo numa fatura fechada: só pagar a parte, levar o restante para a próxima fatura, ou parcelar com o cartão (os juros, a diferença entre parcelas e restante, viram um encargo). "Anular pagamento" desfaz o pagamento inteiro, inclusive o parcelamento.

**Estorno e anulação.** O estorno de uma compra no cartão vira crédito na fatura: cancela parcelas inteiras a partir da última (só em faturas não fechadas) e o resto entra como crédito na fatura aberta. Fatura fechada nunca muda: anular ou editar uma compra que já está nela é recusado ("Registre um estorno").

## Análise

A aba **Análise** mostra para onde foi o dinheiro, somando contas, cartões, Pix e dinheiro. Só gastos: receitas, transferências entre contas e pagamentos de fatura não entram; estornos abatem do lugar e da categoria da compra.

- **Período**: Mês, Semana (de segunda a domingo) ou Ano, com setas para o anterior e o seguinte. O mês e a semana atuais mostram tudo o que já está registrado para eles; o ano atual vai até o fim do mês atual.
- **Pelas parcelas / Pela compra**: no padrão, cada parcela conta no seu mês (o celular de R$ 1.200 em 6x pesa R$ 200 por mês, no mesmo dia do mês da compra); "pela compra" põe o valor inteiro na data da compra. O total do mês pelas parcelas é o mesmo consumo do mês do resto do app.
- **Em que você gastou**: rosca por categoria (as 5 maiores e "Outras"); tocar numa categoria filtra os lugares e o calendário.
- **Onde você mais gastou**: lugares do maior para o menor, com número de compras e categoria. Lançamento sem estabelecimento (um encargo "IOF") aparece pelo nome.
- **Seus dias**: calendário mais escuro onde se gastou mais, com o dia mais caro e os dias sem gasto; tocar num dia lista o que foi gasto nele.
- **Filtro "Cartão ou conta"** (arquivados inclusive) e o atalho "Ver análise deste cartão" na tela do cartão.
- **Tela do lugar**: esta semana, este mês e este ano, média por compra e todas as compras de lá, com filtro por cartão ou conta.

Período, modo e filtros ficam na URL: voltar ou recarregar mantém a vista.

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

Quando a plataforma informa o IP real num cabeçalho próprio, que o proxy dela sempre sobrescreve, prefira `CLIENT_IP_HEADER` (só para o limite de login) e deixe `FORWARDED_ALLOW_IPS` no padrão. É o que o `fly.toml` faz, com `CLIENT_IP_HEADER=Fly-Client-IP`: com `--forwarded-allow-ips="*"`, o uvicorn usaria o IP mais à esquerda do `X-Forwarded-For`, que o próprio cliente escolhe.

## Publicação

O app roda no **Fly.io** (São Paulo, uma máquina sempre ligada), com o banco no **Neon** (plano gratuito, São Paulo). Uma cópia diária do banco vai criptografada para o **Cloudflare R2**. Cada merge na `main` com o CI verde publica sozinho (job `deploy` do `ci.yml`), aplicando as migrações.

São dois apps no Fly, cada um só com os segredos de que precisa:

| App | O que roda | Segredos |
|---|---|---|
| `caderno-de-gastos` | o site e a API (`fly.toml`) | `DATABASE_URL`, `SECRET_KEY`, `BACKUP_REPORT_TOKEN` |
| `caderno-de-gastos-backup` | uma máquina agendada, uma vez por dia (`scripts/backup.sh`) | `BACKUP_DATABASE_URL` (só leitura), chaves do R2, `BACKUP_AGE_RECIPIENT`, `APP_URL`, `BACKUP_REPORT_TOKEN` |

Nenhum segredo vai na linha de comando: o `fly secrets import` lê `NOME=valor` da entrada (cole as linhas e termine com Ctrl+Z e Enter no Windows, Ctrl+D no Linux/macOS).

### 1. Contas e ferramentas

- **Fly.io** (pede cartão) e `flyctl`: no PowerShell, `iwr https://fly.io/install.ps1 -useb | iex`; depois `fly auth login`.
- **Neon** (sem cartão).
- **Cloudflare**, com o R2 ativado (pede cartão; os primeiros 10 GB são gratuitos).

### 2. Banco (Neon)

1. Crie o projeto na região **AWS São Paulo (`aws-sa-east-1`)**.
2. Em "Connect", copie a conexão **direta** (sem "pooled": o app já tem o próprio pool). Troque `postgresql://` por `postgresql+psycopg://`; o resultado é o `DATABASE_URL` do app, com `sslmode=require`.
3. Usuário de backup, só leitura, no SQL Editor (criado por SQL, ele não herda os poderes de administrador que os usuários do painel recebem):

   ```sql
   CREATE ROLE backup_reader WITH LOGIN PASSWORD '<senha longa e aleatória>';
   GRANT pg_read_all_data TO backup_reader;
   ```

   O `BACKUP_DATABASE_URL` é a mesma conexão com `backup_reader` e essa senha, no formato `postgresql://` (é o `pg_dump` que usa).

### 3. Armazenamento do backup (R2)

1. Crie o bucket `financas-backup`.
2. Em Settings → Object lifecycle rules: apagar objetos com prefixo `daily/` depois de 30 dias e com prefixo `monthly/` depois de 365 dias.
3. Em "Manage API tokens", crie um token **Object Read & Write** só para esse bucket. Guarde o Access Key ID, o Secret Access Key e o endpoint `https://<id da conta>.r2.cloudflarestorage.com`.

### 4. Chave do backup

A imagem do app já traz o `age`; construa-a uma vez localmente (ela serve também para restaurar):

```bash
docker build -t financas-local .
docker run --rm --entrypoint age-keygen financas-local
```

A saída tem a chave privada (`AGE-SECRET-KEY-1…`): guarde-a **só** no gerenciador de senhas. Sem ela nenhum backup pode ser aberto; ela nunca vai para o repositório, o GitHub ou o Fly. A linha `# public key: age1…` é o `BACKUP_AGE_RECIPIENT`.

### 5. App

```bash
fly apps create caderno-de-gastos
fly secrets import -a caderno-de-gastos --stage        # DATABASE_URL, SECRET_KEY, BACKUP_REPORT_TOKEN
fly deploy --remote-only --ha=false                     # --ha=false: uma máquina só (o padrão cria duas)
curl https://caderno-de-gastos.fly.dev/api/v1/health
```

`SECRET_KEY` e `BACKUP_REPORT_TOKEN`: 32 caracteres aleatórios ou mais cada (`python -c "import secrets; print(secrets.token_urlsafe(32))"`). Se o nome `caderno-de-gastos` estiver ocupado, troque-o junto em `fly.toml` (`app` e `APP_ORIGIN`) e no health check do `ci.yml`.

**Publicação automática.** Token de deploy só deste app como segredo do GitHub:

```bash
fly tokens create deploy -a caderno-de-gastos | gh secret set FLY_API_TOKEN
```

### 6. Sua usuária

```bash
fly ssh console -a caderno-de-gastos
python -m app.cli create-user --email voce@example.com   # dentro da máquina; a senha é pedida sem aparecer
```

### 7. Backup diário

```bash
fly apps create caderno-de-gastos-backup
fly secrets import -a caderno-de-gastos-backup --stage
#   BACKUP_DATABASE_URL, BACKUP_AGE_RECIPIENT, R2_ENDPOINT, R2_BUCKET,
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, APP_URL=https://caderno-de-gastos.fly.dev,
#   BACKUP_REPORT_TOKEN (o mesmo do app)
fly deploy --build-only --push --remote-only -a caderno-de-gastos-backup --image-label backup
fly machine run registry.fly.io/caderno-de-gastos-backup:backup sh scripts/backup.sh \
  -a caderno-de-gastos-backup --region gru --vm-memory 256 \
  --schedule daily --restart on-fail
```

O Fly roda a máquina uma vez por dia, contando a partir da criação (sem horário fixo); `--restart on-fail` faz ela parar depois de cada execução (sem ele, reiniciaria sem fim) e tentar de novo se falhar. Para rodar agora: `fly machine start <id> -a caderno-de-gastos-backup`; o resultado aparece em `fly logs -a caderno-de-gastos-backup` e em "Mais" → "Último backup". O app avisa na tela inicial quando o último backup tem mais de 2 dias.

A máquina usa a imagem do momento em que foi criada. Se `app/backup.py` mudar, repita o `fly deploy --build-only …` e troque a imagem: `fly machine update <id> -a caderno-de-gastos-backup --image registry.fly.io/caderno-de-gastos-backup:backup`.

### 8. Restaurar um backup

1. Baixe um arquivo `.sql.gz.age` no painel do R2.
2. Num banco vazio (por exemplo, um novo no Postgres do `docker compose`):

   ```bash
   age -d -i chave.txt 2026-10-18.sql.gz.age | gunzip | psql postgresql://finance:finance@127.0.0.1:5433/restaurado
   ```

   `chave.txt` tem a chave privada; apague o arquivo em seguida. Sem `age` e `psql` instalados, rode o mesmo comando dentro da imagem local, com a pasta do arquivo montada e o banco em `host.docker.internal`:

   ```bash
   docker run --rm -v "<pasta>:/data" --entrypoint bash financas-local -c      "age -d -i /data/chave.txt /data/2026-10-18.sql.gz.age | gunzip | psql postgresql://finance:finance@host.docker.internal:5433/restaurado"
   ```
3. Confira o saldo: aponte o app local para o banco restaurado (`DATABASE_URL`) e compare com o do celular.

## Testes e verificação

```bash
bash scripts/check.sh
```

Roda ruff, mypy e pytest. Os testes usam o banco `finance_test` do docker compose (porta 5433). Para o frontend, `npm run check` em `frontend/`; para o teste ponta a ponta, `bash scripts/e2e.sh`.
