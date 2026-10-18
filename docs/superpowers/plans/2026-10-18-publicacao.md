# Publicação — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar o app no ar no Fly.io + Neon, com publicação automática a partir da `main`, backup diário criptografado no Cloudflare R2 (com aviso no app) e registro das frases que o app não entendeu.

**Architecture:**
- **Backend:**
  - tabela e API de frases não entendidas;
  - registro de backup (o job de backup avisa o app por um endpoint protegido por token, porque o usuário de banco do backup só lê);
  - módulo `app.backup` que gera o dump, criptografa com `age` e envia ao R2.
- **Frontend:** registra as frases nos três momentos da spec e mostra a lista e o status do backup em "Mais", com aviso na tela inicial.
- **Infra:**
  - `fly.toml`;
  - job de deploy no CI existente;
  - máquina agendada no Fly para o backup;
  - roteiro no README para os passos que dependem das contas da usuária.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (Neon), pytest; React, TanStack Query, Vitest + MSW; Docker, Fly.io, GitHub Actions, Cloudflare R2 (API S3), `age`, `pg_dump`.

**Spec:** `docs/superpowers/specs/2026-10-18-publicacao-design.md`

## Global Constraints

- **Hospedagem:** app no Fly.io, região `gru`, uma máquina sempre ligada, endereço `<app>.fly.dev` com HTTPS obrigatório. Banco no Neon gratuito, região mais próxima disponível.
- **Segredos do app:** a senha do banco do app e a `SECRET_KEY` ficam só nos segredos do Fly.
- **Segredos no GitHub:** só o token de publicação do Fly.
- **Backup:**
  - usa um usuário do Neon só de leitura;
  - a chave privada `age` fica só com a usuária, nunca no repositório, no GitHub ou no Fly;
  - retenção de 30 diários e 12 mensais;
  - aviso quando passar de **2 dias** sem backup.
- **Frases não entendidas:**
  - **Registra quando:** nada entendido, campo pendente (ao abrir o comprovante), campo mudado ou item desmarcado (ao confirmar).
  - **Não conta:** a categoria.
  - **Uma vez por frase:** a mesma frase em menos de **10 minutos** junta os motivos no mesmo registro.
  - **Ficam só no banco da usuária.**
- **Copy, exatamente como na spec:** "Não entendi essa frase. Tente como '42 mercado pix itaú'." e "Frases não entendidas".
- **Publicação:** só a partir de push na `main`, depois de os jobs `backend` e `frontend` do CI passarem. Depois de publicar, só `GET /api/v1/health` (sem login, sem gravar nada).
- **Nenhuma mudança** no comportamento do registro, além da mensagem nova para frase sem nenhum item.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Conexão derrubada pelo Neon ao dormir:** a primeira requisição depois disso responde normalmente, sem 500. Teste: Tarefa 1 (`dropped connection is replaced transparently`).
2. **Mesma frase aberta, fechada e enviada de novo:** um registro só, com os motivos somados. Teste: Tarefa 2 (`same phrase within ten minutes merges reasons`).
3. **Frase de outra pessoa ou id inexistente ao apagar:** 404, nunca apaga dados de outra usuária. Teste: Tarefa 2 (`other user cannot see or delete phrases`).
4. **Relatório de backup sem token, ou com token errado:** recusado (401) e nada é gravado; com o token não configurado no servidor, o endpoint fica desligado (404). Teste: Tarefa 3 (`backup report requires the configured token`).
5. **Backup que falha no meio (dump, criptografia ou envio):** não avisa sucesso ao app, sai com erro e não deixa arquivo sem criptografia no disco. Teste: Tarefa 4 (`failed step reports nothing and leaves no plaintext`).

---

### Task 1: Configuração do Fly e reconexão ao banco

**Files:**
- Create: `fly.toml`
- Modify: `.github/workflows/ci.yml`
- Test: `backend/tests/test_db_reconnect.py`

**Interfaces — Produces:**
- `fly.toml` com app `<nome a definir no roteiro>`, `primary_region = "gru"` e `[http_service]` com:
  - `internal_port = 8000`, `force_https = true`;
  - `auto_stop_machines = "off"`, `min_machines_running = 1`;
  - check `GET /api/v1/health`.
- `[env]` com `COOKIE_SECURE = "true"`, `APP_ORIGIN = "https://<app>.fly.dev"` e `FORWARDED_ALLOW_IPS` no valor que a documentação do Fly indicar como seguro. Registrar a decisão no ledger: no Fly, a porta não fica exposta fora do proxy.
- **Máquina:** `shared-cpu-1x`, 512 MB. Ruling no ledger se mudar para 256 MB após medir.
- **Job `deploy` no `ci.yml`:**
  - `needs: [backend, frontend]` e `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`;
  - `superfly/flyctl-actions/setup-flyctl` + `flyctl deploy --remote-only` com `FLY_API_TOKEN` dos segredos do GitHub;
  - depois, `curl --fail --retry 10 --retry-delay 6 https://<app>.fly.dev/api/v1/health`;
  - `concurrency` que não cancela um deploy em andamento.

- [ ] **Step 1: Teste que falha (ou confirma)** — `dropped connection is replaced transparently`.
  - Abrir uma sessão pela engine de `app/db.py`, pegar o pid com `select pg_backend_pid()`, devolver a conexão ao pool.
  - Derrubar esse pid por outra conexão (`pg_terminate_backend`), como o Neon faz ao dormir.
  - Fazer `GET /api/v1/health` (ou uma consulta pela mesma engine): resposta normal, sem erro.
- [ ] **Step 2:** `uv run pytest tests/test_db_reconnect.py -q`. Expected: PASS, porque `pool_pre_ping=True` já existe. Se passar de primeira, registrar no ledger que o teste confirma comportamento existente. Fazer uma mutação temporária (`pool_pre_ping=False`) para ver o teste falhar e voltar.
- [ ] **Step 3:** Criar o `fly.toml` e o job `deploy`. Validar o YAML localmente: `python -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))"` sem erro.
- [ ] **Step 4:** `bash scripts/check.sh` verde.
- [ ] **Step 5: Commit** — `chore: configuração do Fly.io e publicação automática pela main`.

---

### Task 2: Frases não entendidas (backend)

**Files:**
- Create:
  - `backend/app/models/misread_phrase.py`
  - `backend/migrations/versions/0004_misread_phrases.py`
  - `backend/app/services/misread_phrases.py`
  - `backend/app/api/schemas/misread_phrases.py`
  - `backend/app/api/routes/misread_phrases.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/api/routes/__init__.py`
- Test: `backend/tests/services/test_misread_phrases.py`, `backend/tests/api/test_misread_phrases_api.py`

**Interfaces — Produces:**
- **Enum `MisreadReason` (StrEnum):**
  - nada entendido: `NOTHING_PARSED`;
  - pendências: `PENDING_AMOUNT`, `PENDING_DESCRIPTION`, `PENDING_ACCOUNT`, `PENDING_PAYMENT_METHOD`;
  - mudanças: `CHANGED_TYPE`, `CHANGED_AMOUNT`, `CHANGED_DESCRIPTION`, `CHANGED_DATE`, `CHANGED_SOURCE`, `CHANGED_PAYMENT_METHOD`, `CHANGED_INSTALLMENTS`;
  - item desmarcado: `UNCHECKED_ITEM`.
- **Modelo `MisreadPhrase(OwnedModel)`:** `text: str` (até 500), `reasons: list[str]` (ARRAY de texto, ordenado e sem repetição), `created_at`, `updated_at`.
- **Serviços:**
  - `record(session, ctx, text: str, reasons: Sequence[MisreadReason]) -> MisreadPhrase`. Se existir registro da usuária com o mesmo `text` (após `strip()`) e `updated_at` nos últimos **10 minutos**, junta os motivos nele e atualiza `updated_at`; senão cria. Texto vazio ou sem motivo → `RuleViolation("invalid_misread_phrase", ...)`.
  - `list_phrases(session, ctx) -> list[MisreadPhrase]`, mais recentes primeiro.
  - `delete_phrase(session, ctx, phrase_id)`, que dá `NotFound` se for de outra pessoa.
  - `delete_all(session, ctx) -> int`.
- **API:**
  - `POST /api/v1/misread-phrases {text, reasons}` → 201 `MisreadPhraseOut {id, text, reasons, created_at, updated_at}`;
  - `GET /api/v1/misread-phrases` → lista;
  - `DELETE /api/v1/misread-phrases/{id}` → 204;
  - `DELETE /api/v1/misread-phrases` → 204.
  - Exige login e os cabeçalhos de CSRF como as demais rotas de escrita.

- [ ] **Step 1: Testes que falham:**
  - `records a phrase with its reasons`;
  - `same phrase within ten minutes merges reasons` (PENDING_AMOUNT e depois CHANGED_DATE → um registro com os dois);
  - `same phrase after ten minutes is a new record` (relógio fixo avançado com `FixedClock`);
  - `empty text or no reasons is rejected`;
  - `lists newest first`, `delete one and delete all`;
  - API: `misread phrases endpoints`, `other user cannot see or delete phrases`, `invalid reason is rejected` (422).
- [ ] **Step 2:** `uv run pytest tests/services/test_misread_phrases.py tests/api/test_misread_phrases_api.py -q`. Expected: FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar modelo, migração 0004 (com `downgrade`), serviço e rotas. A migração sobe e desce no teste de migrações existente.
- [ ] **Step 4:** `bash scripts/check.sh` verde.
- [ ] **Step 5: Commit** — `feat(api): frases não entendidas`.

---

### Task 3: Registro e status do backup (backend)

**Files:**
- Create: `backend/app/models/backup_report.py`, `backend/migrations/versions/0005_backup_reports.py`, `backend/app/services/backups.py`, `backend/app/api/routes/backups.py`
- Modify: `backend/app/config.py` (`backup_report_token: SecretStr | None = None`), `backend/app/models/__init__.py`, `backend/app/api/routes/__init__.py`
- Test: `backend/tests/api/test_backups_api.py`

**Interfaces — Produces:**
- **Modelo `BackupReport`:** sem dono; o backup é do banco inteiro. Campos: `id`, `finished_at`, `object_key`, `size_bytes`.
- **Serviços:**
  - `record_report(session, object_key: str, size_bytes: int, finished_at: datetime) -> BackupReport`;
  - `backup_status(session, now: datetime) -> BackupStatus(last_success_at: datetime | None, stale: bool)`, com `stale = last is None or now − last > 2 dias`.
- **Rotas:**
  - **`POST /api/v1/internal/backup-report`:**
    - recebe `{object_key, size_bytes}` e o cabeçalho `Authorization: Bearer <BACKUP_REPORT_TOKEN>`;
    - não exige login nem CSRF;
    - token ausente ou errado → 401, com comparação em tempo constante (`hmac.compare_digest`);
    - `backup_report_token` não configurado → 404;
    - sucesso → 204.
  - **`GET /api/v1/backup-status`:** exige login e devolve `{last_success_at, stale}`.

- [ ] **Step 1: Testes que falham:**
  - `backup report requires the configured token` (sem cabeçalho → 401, token errado → 401, sem token no servidor → 404, nada gravado nos três casos);
  - `backup report records and status is fresh`;
  - `status is stale after two days and when never run`;
  - `backup status requires login`.
- [ ] **Step 2:** `uv run pytest tests/api/test_backups_api.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implementar, incluindo a migração 0005 com `downgrade`.
- [ ] **Step 4:** `bash scripts/check.sh` verde.
- [ ] **Step 5: Commit** — `feat(api): registro e status do backup`.

---

### Task 4: Job de backup (`python -m app.backup`) e imagem

**Files:**
- Create: `backend/app/backup.py`
- Modify: `Dockerfile` (instalar `postgresql-client` da mesma versão maior do Neon, `age` e `curl`)
- Test: `backend/tests/test_backup_job.py`

**Interfaces — Produces:**
- `object_keys(day: date) -> list[str]`: `["daily/AAAA-MM-DD.sql.gz.age"]` e, no dia 1, também `"monthly/AAAA-MM.sql.gz.age"`.
- **`run(env: Mapping[str, str], runner=subprocess.run, today: date) -> int`:**
  - **Variáveis de ambiente:** `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `APP_URL`, `BACKUP_REPORT_TOKEN`.
  - **Passos:**
    1. `pg_dump --no-owner --no-privileges` → `gzip` → `age -r <recipient>`, num diretório temporário. O arquivo sem criptografia nunca é gravado: tudo vai por pipe.
    2. Envio de cada chave por `curl --fail --aws-sigv4 "aws:amz:auto:s3" --user KEY:SECRET -T arquivo <endpoint>/<bucket>/<chave>`.
    3. `POST {APP_URL}/api/v1/internal/backup-report`.
  - Devolve 0 se tudo deu certo, 1 em qualquer falha, sem relatório nesse caso.
  - Variável faltando → mensagem clara e saída 2.
- `main()` lê `os.environ` e `date.today()`; `python -m app.backup`.

- [ ] **Step 1: Testes que falham** (o `runner` é falso, sem rede nem banco):
  - `daily and monthly keys` (15/10 → só diário; 01/11 → diário e mensal);
  - `runs dump encrypt upload and report in order` (comandos e argumentos esperados, sem a senha na linha de comando: a URL do banco vai por variável de ambiente do processo);
  - `failed step reports nothing and leaves no plaintext` (falha em cada etapa: código 1, nenhum relatório, diretório temporário sem arquivo `.sql` nem `.gz` sem criptografia);
  - `missing variables exit with 2`.
- [ ] **Step 2:** `uv run pytest tests/test_backup_job.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implementar e ajustar o `Dockerfile`.
- [ ] **Step 4:** `bash scripts/check.sh` verde e `docker build .` sem erro. Dentro da imagem, `pg_dump --version`, `age --version` e `curl --version` respondem.
- [ ] **Step 5: Commit** — `feat: job de backup criptografado para o R2`.

---

### Task 5: Frases não entendidas e backup no frontend

**Files:**
- Modify:
  - `frontend/src/api/schema.d.ts` (gerado), `types.ts`, `endpoints.ts`, `queries.ts`
  - `frontend/src/features/home/HomePage.tsx`, `frontend/src/features/entry/ConfirmationCard.tsx`
  - `frontend/src/features/shell/MorePage.tsx`, `frontend/src/routes.tsx`
- Create: `frontend/src/features/entry/misread.ts`, `frontend/src/features/shell/MisreadPhrasesPage.tsx`
- Test:
  - `frontend/src/features/entry/misread.test.ts`
  - `frontend/src/features/home/HomePage.test.tsx`
  - `frontend/src/features/entry/ConfirmationCard.test.tsx`
  - `frontend/src/features/shell/MisreadPhrasesPage.test.tsx`

**Interfaces — Produces:**
- **`misread.ts`:**
  - `pendingReasons(parsed: ParsedItem[]): MisreadReason[]`, a partir de `pending` (`amount`, `description`, `account`, `paymentMethod`);
  - `changeReasons(initial: CardItem[], final: CardItem[]): MisreadReason[]`, que compara `type`, `amountText`, `description`, `occurredOn`, `accountId`/`cardId` (→ `CHANGED_SOURCE`), `paymentMethod`, `installments` e `included` (→ `UNCHECKED_ITEM`) e **ignora `categoryId`**.
- **`api.recordMisread({text, reasons})`:** "dispara e esquece". Erro de rede não atrapalha o registro do gasto.
- **Onde registra:**
  - **`HomePage.submit`:** se `parseEntry` devolve `[]`, mostra "Não entendi essa frase. Tente como '42 mercado pix itaú'." (`role="status"`), mantém o texto no campo e registra `NOTHING_PARSED`;
  - **`ConfirmationCard`:** ao abrir, registra `pendingReasons` se houver; ao confirmar, registra `changeReasons` se houver.
- **Tela `/mais/frases`, "Frases não entendidas":**
  - lista com a frase, a data e os motivos em português;
  - "Apagar" em cada uma e "Apagar todas", com confirmação.
- **"Mais":**
  - link "Frases não entendidas";
  - linha "Último backup: dd/mm às hh:mm", ou "Nenhum backup ainda".
- **Tela inicial:** quando `stale`, aviso em uma linha "O backup não roda há mais de 2 dias.", com link para "Mais".

- [ ] **Step 1: Testes que falham:**
  - `pending and change reasons ignore category`;
  - `phrase with nothing understood shows a hint and is recorded`;
  - `pending fields are recorded when the card opens`;
  - `edited and unchecked items are recorded on confirm`;
  - `understood and unchanged phrase records nothing`;
  - `recording failure does not block saving`;
  - `misread phrases page lists and deletes`;
  - `more page shows last backup`;
  - `home warns when backup is stale`;
  - axe nas telas novas.
- [ ] **Step 2:** `npx vitest run src/features/entry src/features/home src/features/shell`. Expected: FAIL.
- [ ] **Step 3:** `npm run api:types` e implementar.
- [ ] **Step 4:** `npm run check` verde e `bash scripts/e2e.sh` verde.
- [ ] **Step 5: Commit** — `feat(frontend): frases não entendidas e status do backup`.

---

### Task 6: Roteiro de publicação (com a usuária) e verificação

**Files:** Modify `README.md` (seção "Publicação").

O roteiro tem comandos prontos, um por vez. O executor conduz e a usuária faz os passos que dependem das contas dela:

- [ ] **Step 1: README "Publicação":**
  1. Contas no Fly.io, no Neon e no Cloudflare.
  2. **Neon:**
     - projeto na região mais próxima;
     - usuário do app;
     - usuário `backup_reader` com `GRANT pg_read_all_data`;
     - as duas URLs com `sslmode=require` no formato `postgresql+psycopg://`, e no formato `postgresql://` para o `pg_dump`.
  3. **R2:**
     - bucket;
     - regras de ciclo de vida (`daily/` apagado após 30 dias, `monthly/` após 365);
     - token de API restrito ao bucket.
  4. **Chave de backup:** `age-keygen`. A chave privada vai para o gerenciador de senhas; a pública vai como segredo.
  5. **Fly:**
     - `fly launch --no-deploy` com o `fly.toml`;
     - `fly secrets set DATABASE_URL=… SECRET_KEY=… BACKUP_REPORT_TOKEN=…`;
     - primeiro `fly deploy`.
  6. **GitHub:** segredo `FLY_API_TOKEN` (token de deploy do app).
  7. **Máquina de backup:** `fly machine run <imagem do app> --schedule daily --env …` e `fly secrets` com as variáveis da Tarefa 4, com o comando `python -m app.backup`.
  8. **Criar a usuária:** `fly ssh console -C "python -m app.cli create-user --email …"`, com a senha por variável `PF_NEW_PASSWORD`, nunca na linha de comando.
  9. **Instalar no celular:** abrir o endereço e escolher "Adicionar à tela inicial".
  10. **Restaurar um backup:** baixar, `age -d -i chave.txt arquivo | gunzip | psql <banco local>` e conferir o saldo.
- [ ] **Step 2: Executar o roteiro com a usuária.** Ela faz os passos de conta e token; o executor roda o resto.
- [ ] **Step 3: Verificação:**
  - push na `main` publica sozinho e o health check passa;
  - login no celular, um gasto registrado e anulado em seguida;
  - uma execução do backup aparece em "Último backup";
  - uma restauração testada localmente;
  - uma frase não entendida aparece na lista.
- [ ] **Step 4: Commit** — `docs: roteiro de publicação`.
