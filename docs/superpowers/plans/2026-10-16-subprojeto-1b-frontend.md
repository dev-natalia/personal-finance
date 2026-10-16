# Subprojeto 1B — Frontend (PWA) de fundação e lançamentos: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o app instalável (PWA) do subprojeto 1: login, tela inicial em formato de conversa com interpretador de frases e cartão de confirmação, formulário completo, telas de Lançamentos, Contas e Categorias — servido pelo mesmo serviço FastAPI do backend (plano 1A).

**Architecture:** `frontend/` com Vite + React + TypeScript. Regras puras em `src/domain/` (dinheiro como string, datas ISO, interpretador) testadas com Vitest; acesso à API em `src/api/` (cliente `fetch` + tipos gerados do OpenAPI + hooks TanStack Query); telas em `src/features/<tela>/`. O build vai para `frontend/dist`, que o FastAPI serve na mesma origem (`FRONTEND_DIST`). Uma imagem Docker única junta os dois.

**Tech Stack:** Node ≥ 24, Vite, React, TypeScript (strict), React Router, TanStack Query, Tailwind CSS v4, vite-plugin-pwa, Vitest + jsdom + Testing Library + MSW + axe-core, openapi-typescript, Playwright (smoke).

**Spec:** `docs/superpowers/specs/2026-10-15-fundacao-e-lancamentos-design.md` (seção 8, Frontend; seções 6–7 para contrato da API e erros). Backend já implementado: branch `feat/subprojeto-1a-backend` (PR dev-natalia/personal-finance#1).

## Global Constraints

- Textos de interface em português; identificadores e nomes de arquivo em inglês.
- **Dinheiro nunca vira `number` em JavaScript.** Valores trafegam e são manipulados como string canônica da API (`"1234.56"`); nada de `parseFloat`, `Number(...)` ou `toFixed` em código de dinheiro.
- Datas são strings `AAAA-MM-DD` na data local da usuária; "hoje" vem sempre de `GET /api/v1/entry-hints` (`today`), nunca do relógio do navegador.
- Toda requisição que altera dados envia `X-Requested-With: fetch` (o navegador envia `Origin` sozinho). Cookies `same-origin`.
- Cada item do cartão de confirmação tem sua própria `Idempotency-Key` (`crypto.randomUUID()`), reaproveitada em "Tentar de novo".
- Só `sessionStorage` guarda algo no navegador, e só o texto não enviado do campo da tela inicial (chave `pf:draft`). Sem fila offline.
- `category_id` só é enviado quando a usuária **alterou** a categoria sugerida (é o que ensina a memória do backend).
- Acessibilidade: elementos nativos (`button`, `select`, `input`, `dialog`) com rótulos; foco vai para o cartão quando ele aparece; `aria-live` para confirmações e erros; sinal "−" em negativos (não só cor); erros ligados aos campos (`aria-describedby`); inputs com fonte ≥ 16px; contraste AA.
- Em desenvolvimento, o Vite (porta 5173) faz proxy de `/api` para `http://127.0.0.1:8000`; o backend roda com `APP_ORIGIN=http://localhost:5173` e `COOKIE_SECURE=false`.
- Todo commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Direção visual (aprovada): "comprovante"

O app é um caderno de gastos; toda compra no Brasil termina num comprovante. O **cartão de confirmação é um comprovante impresso** — o único elemento ousado da interface. Todo o resto é quieto: a linha do tempo e as listas são um livro-caixa (linhas finas, sem caixinhas, sem sombras), com valores alinhados à direita em algarismos tabulares.

| Token (`@theme`) | Valor | Uso |
|---|---|---|
| `--color-paper` | `#F3F5F2` | fundo do app |
| `--color-ink` | `#1B2340` | texto principal |
| `--color-ink-soft` | `#4A5373` | texto secundário (contraste AA sobre o papel) |
| `--color-pen` | `#2440C4` | ação principal, foco, item ativo da navegação |
| `--color-stamp` | `#B8322A` | saídas e erros (sempre com o sinal `−` ou com texto) |
| `--color-income` | `#1F7A4D` | entradas |
| `--color-rule` | `#D5DBD6` | linhas do livro-caixa e divisórias |
| `--color-slip` | `#FFFFFF` | papel do comprovante |
| `--color-highlight` | `#FFF3C4` | data destacada quando não é hoje |

- **Tipografia:** uma família, Recursive (variável), embutida pelo pacote `@fontsource-variable/recursive` (a CSP `default-src 'self'` bloqueia fontes externas). Interface com `MONO 0, CASL 0`; **dentro do comprovante**, `MONO 1` para valores e campos. Algarismos tabulares (`font-variant-numeric: tabular-nums`) em todo valor. Escala: 13 / 14 / 16 (corpo) / 20 / 34 px (saldo); pesos 400, 600 e 650 (saldo e totais).
- **Comprovante:** fundo `--color-slip`, bordas superior e inferior picotadas (gradiente radial repetido na cor do papel), divisória tracejada antes do pagamento, uma única sombra de 1px. **Único movimento automático:** ao aparecer, o comprovante desce como se saísse da impressora (cerca de 220 ms, `clip-path`/`translate`), desativado com `prefers-reduced-motion: reduce`.
- **Livro-caixa:** linha = descrição (16px) + categoria e pagamento em segunda linha (13px, `--color-ink-soft`, separados por vírgula); valor à direita com sinal (`−18,00` em `--color-stamp`, `+3.000,00` em `--color-income`). Cabeçalhos de dia em 13px, peso 600, sem maiúsculas.
- **Texto:** frases naturais, verbo primeiro nos botões ("Confirmar", "Tentar de novo", "Criar conta"), sem "por favor", sem exclamação, sem rótulos em maiúsculas e sem separadores `·` ou travessão entre fragmentos. Erros dizem o que aconteceu e o que fazer. Estados vazios convidam a agir.
- **Piso de qualidade:** foco visível em `--color-pen` (contorno de 3px), alvo de toque de pelo menos 44px, `prefers-reduced-motion` respeitado, layout de 360px a desktop.

### Desvios deliberados em relação à spec

- **Sem Radix e sem react-hook-form.** Os formulários são pequenos e os elementos nativos (`<select>`, `<dialog>`, `<input type="date">`) já são acessíveis por teclado e leitor de tela. Menos dependências para manter; se algum componente nativo se mostrar insuficiente, Radix entra pontualmente.
- **Ajustes no backend antes do frontend** (Tarefas 1 e 2): erros fora da validação passam ao padrão em português, o caminho do campo deixa de trazer o prefixo `EXPENSE.`, respostas 500 ganham `X-Request-ID`, e o FastAPI passa a servir o build — pendências conhecidas do PR do backend que o frontend consome.

## Review Focus

1. **Rede cai ao confirmar e a usuária toca "Tentar de novo"** — a segunda tentativa usa a mesma `Idempotency-Key`; nunca nasce uma duplicata. Teste: Tarefa 9 (`retry after network failure reuses the same idempotency key`).
2. **Sessão expira enquanto a usuária digita** — após o login, o texto digitado volta ao campo. Teste: Tarefa 10 (`draft survives the redirect to login`).
3. **Nome de conta digitado sem acento ou em maiúsculas** ("ITAU", "itau") — reconhecido como a conta "Itaú". Teste: Tarefa 5 (`matches account names ignoring case and accents`).
4. **"dia 31" num mês de 30 dias, ou dia ainda no futuro** — cai no mês anterior em vez de virar data inválida ou futura. Teste: Tarefa 4 (`day of month in the future or missing falls back to previous month`).
5. **Lote em que um item falha** — os outros são gravados, o que falhou continua editável, e "Tentar de novo" não reenvia os já gravados. Teste: Tarefa 9 (`batch with one failure keeps the others saved and retries only the failed one`).

---

## Mapa de arquivos

```
backend/app/api/security_headers.py     cabeçalhos de segurança (compartilhado)
backend/app/api/frontend.py             serve frontend/dist (SPA)
backend/scripts/export_openapi.py       imprime o OpenAPI (gera os tipos do frontend)
Dockerfile, .dockerignore               imagem única (build do frontend + backend)
.claude/launch.json                     servidores de desenvolvimento (backend + frontend)
frontend/
  package.json  tsconfig.json  vite.config.ts  index.html  playwright.config.ts
  public/icons/                         ícones do PWA (192, 512, maskable)
  e2e/smoke.spec.ts                     smoke ponta a ponta
  src/
    main.tsx  App.tsx  routes.tsx  index.css
    domain/   text.ts money.ts dates.ts labels.ts parser.ts (+ *.test.ts)
    api/      schema.d.ts (gerado) types.ts client.ts endpoints.ts queries.ts queryClient.ts
    ui/       styles.ts  MoneyInput.tsx  OfflineBanner.tsx  useOnlineStatus.ts
    features/
      auth/        LoginPage.tsx RequireAuth.tsx useUnauthenticatedRedirect.ts
      shell/       AppShell.tsx MorePage.tsx
      entry/       cardState.ts describe.ts ConfirmationCard.tsx ItemEditor.tsx
      home/        HomePage.tsx BalanceHeader.tsx Timeline.tsx Composer.tsx draft.ts
      form/        TransactionForm.tsx FullFormPage.tsx
      transactions/ TransactionsPage.tsx RefundDialog.tsx
      accounts/    AccountsPage.tsx
      categories/  CategoriesPage.tsx
    test/     setup.ts server.ts render.tsx axe.ts fixtures.ts
```

---

### Task 1: Backend — erros no padrão do frontend

**Files:**
- Create: `backend/app/api/security_headers.py`
- Modify: `backend/app/api/errors.py`, `backend/app/api/middleware.py`
- Test: `backend/tests/api/test_errors_api.py`

**Interfaces:**
- Produces: `SECURITY_HEADERS: dict[str, str]` e `apply_security_headers(headers: MutableHeaders, *, skip_csp: bool = False) -> None` em `security_headers.py` (o middleware passa a usá-los). Contrato de erro novo, usado pelo frontend:

| Situação | HTTP | `code` | `detail` |
|---|---|---|---|
| Rota inexistente | 404 | `not_found` | `Endereço não encontrado.` |
| Método não permitido | 405 | `method_not_allowed` | `Método não permitido neste endereço.` |
| Corpo não é UTF-8 | 400 | `invalid_body` | `O corpo da requisição não pôde ser lido (envie JSON em UTF-8).` |
| JSON malformado | 422 | `invalid_body` | `O corpo da requisição não é um JSON válido.` (sem `errors`) |
| Erro inesperado | 500 | `internal_error` | (inalterado) — agora com `X-Request-ID` e cabeçalhos de segurança |

- Em `errors[].field`, os rótulos do union de lançamentos (`INCOME`, `EXPENSE`, `TRANSFER`, `REFUND` — valores de `TransactionType`) são removidos do caminho: `"EXPENSE.payment_method"` vira `"payment_method"`.

- [ ] **Step 1: Escrever os testes que falham** em `backend/tests/api/test_errors_api.py` (fixtures `client`, `auth_client`, `build_client` de `tests/api/conftest.py`):
  - `test_unknown_route_is_not_found_in_portuguese`: `GET /api/v1/nao-existe` → 404, `code == "not_found"`, `detail == "Endereço não encontrado."`.
  - `test_wrong_method_is_method_not_allowed`: `POST /api/v1/health` → 405, `code == "method_not_allowed"`.
  - `test_body_not_utf8_is_invalid_body`: `POST /api/v1/auth/login` com `content=b'{"email": "\xff@x.com", "password": "x"}'` e `Content-Type: application/json` → 400, `code == "invalid_body"`.
  - `test_malformed_json_is_invalid_body`: mesmo endpoint com `content=b'{"email": '` → 422, `code == "invalid_body"`, `"errors" not in body`.
  - `test_union_field_path_has_no_type_tag`: com conta criada, `POST /api/v1/transactions` de despesa sem `payment_method` (cabeçalho `Idempotency-Key`) → 422 e `[e["field"] for e in errors] == ["payment_method"]`.
  - `test_server_error_keeps_request_id_and_security_headers`: rota `boom` (como em `test_auth_api.py`) com `raise_server_exceptions=False` → 500 e cabeçalhos `x-request-id` (32 caracteres) e `content-security-policy` presentes.

- [ ] **Step 2: Rodar e confirmar a falha**

Run (em `backend/`): `uv run pytest tests/api/test_errors_api.py -v`
Expected: FAIL nos 6 testes (códigos `http_error`, campo `EXPENSE.payment_method`, 500 sem cabeçalhos).

- [ ] **Step 3: Implementar**
  - Mover `SECURITY_HEADERS` de `middleware.py` para `security_headers.py` e criar `apply_security_headers` (usa `headers.setdefault`; `skip_csp=True` pula só a CSP — usado no `/docs`).
  - Em `errors.py`: tabela `status → (code, detail)` para 400/404/405 no tratador de `StarletteHTTPException` (outros status mantêm `http_error`); no tratador de validação, se algum erro tiver `type == "json_invalid"`, responder `invalid_body` sem lista; função `_field_path(loc)` que descarta `loc[0]` e qualquer parte igual a um valor de `TransactionType`; no tratador de erro inesperado, acrescentar `X-Request-ID` e `apply_security_headers` à resposta.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `uv run pytest -q` (em `backend/`)
Expected: todos passam (os testes antigos de erro continuam válidos).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api backend/tests/api/test_errors_api.py
git commit -m "fix(api): erros 400/404/405 e JSON inválido no padrão em português; 500 com X-Request-ID" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Backend — servir o frontend compilado e exportar o OpenAPI

**Files:**
- Create: `backend/app/api/frontend.py`, `backend/scripts/export_openapi.py`
- Modify: `backend/app/config.py` (campo `frontend_dist`), `backend/app/main.py`
- Test: `backend/tests/api/test_frontend_api.py`

**Interfaces:**
- Produces: `Settings.frontend_dist: str | None = None` (variável `FRONTEND_DIST`); `install_frontend(app: FastAPI, dist: Path) -> None` (chamado por `create_app` depois das rotas da API, só quando `frontend_dist` está definido). `uv run python scripts/export_openapi.py` imprime o JSON do OpenAPI em stdout (usa `Settings` fictícias com `enable_docs=True`; não conecta ao banco).
- Regras do `install_frontend`: rota `GET /{path:path}` fora do schema; caminhos `api` ou `api/...` → 404 (vira `not_found`); arquivo existente dentro de `dist` → servido (`Cache-Control: public, max-age=31536000, immutable` se estiver em `assets/`, senão `no-cache`); qualquer outro caminho → `index.html` com `no-cache` (rotas do SPA). Caminho que resolve para fora de `dist` nunca é servido. Sem `index.html` em `dist` → `RuntimeError` na criação do app.

- [ ] **Step 1: Escrever os testes que falham** em `test_frontend_api.py`. Fixture `dist` em `tmp_path` com `index.html` (`<!doctype html><title>PF</title>`), `assets/app-123.js`, `sw.js`; fixture `spa_client` = `build_client(settings.model_copy(update={"frontend_dist": str(dist)}), db, clock)`.
  - `test_root_serves_index_without_cache`: `GET /` → 200, `text/html`, `cache-control == "no-cache"`, cabeçalho CSP presente.
  - `test_spa_route_serves_index`: `GET /lancamentos` → corpo de `index.html`.
  - `test_assets_are_immutable`: `GET /assets/app-123.js` → `immutable` em `cache-control`.
  - `test_root_files_are_served`: `GET /sw.js` → `// sw`.
  - `test_unknown_api_path_is_still_problem`: `GET /api/v1/nao-existe` → 404, `code == "not_found"`.
  - `test_path_traversal_is_not_served`: arquivo `segredo.txt` em `tmp_path.parent`; `GET /..%2Fsegredo.txt` → corpo não contém o conteúdo do segredo.
  - `test_missing_index_fails_fast`: `create_app` com `frontend_dist` apontando para pasta vazia → `RuntimeError`.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/api/test_frontend_api.py -v`
Expected: FAIL (`frontend_dist` não existe em `Settings`).

- [ ] **Step 3: Implementar** `frontend.py` com as regras acima (usar `Path.resolve()` + `is_relative_to`), o campo em `Settings`, a chamada em `create_app`, e `scripts/export_openapi.py` (`json.dumps(create_app(settings).openapi(), ensure_ascii=False, indent=2)`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `uv run pytest -q` e `uv run python scripts/export_openapi.py | head -c 200`
Expected: todos passam; o comando imprime o início de um JSON com `"openapi"`.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/scripts backend/tests/api/test_frontend_api.py
git commit -m "feat(api): servir o frontend compilado (SPA) e exportar o OpenAPI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fundação do frontend e CI

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/test/setup.ts`, `frontend/src/test/server.ts`, `frontend/src/test/axe.ts`, `frontend/src/test/render.tsx`
- Modify: `.github/workflows/ci.yml` (job `frontend`), `backend/.env.example` (`APP_ORIGIN=http://localhost:5173`)
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: scripts npm `dev`, `build` (`tsc --noEmit && vite build`), `typecheck`, `test` (`vitest run`), `check` (`typecheck` + `test` + `vite build`); `server` (MSW `setupServer()` iniciado no `setup.ts` com `onUnhandledRequest: "error"`); `renderWithProviders(ui: ReactElement, options?: { route?: string }) -> RenderResult & { queryClient: QueryClient }` (QueryClient com `retry: false` + `MemoryRouter`); `expectNoA11yViolations(container: Element) -> Promise<void>` (axe-core, regras `color-contrast` e `region` desligadas — o jsdom não calcula contraste e o container de teste não é a página inteira).

- [ ] **Step 1: Criar `package.json` e instalar dependências** (em `frontend/`, versões mais recentes; ficam no `package-lock.json`):

```bash
npm install react react-dom react-router @tanstack/react-query @fontsource-variable/recursive
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom msw axe-core openapi-typescript vite-plugin-pwa @playwright/test
```

- [ ] **Step 2: Configuração**
  - `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `noEmit`, `types: ["vite/client", "node"]`, `include: ["src", "vite.config.ts", "playwright.config.ts", "e2e"]`.
  - `vite.config.ts` (via `defineConfig` de `vitest/config`): plugins `react()` e `tailwindcss()`; `server.port = 5173`; proxy `/api` → `http://127.0.0.1:8000`; `test.environment = "jsdom"`, `test.setupFiles = ["./src/test/setup.ts"]`, `test.exclude` inclui `e2e/**`.
  - `index.html`: `lang="pt-BR"`, `viewport` com `viewport-fit=cover`, `theme-color #F3F5F2`, título `Finanças`.
  - `index.css`: `@import "@fontsource-variable/recursive";`, `@import "tailwindcss";` e os tokens da seção **Direção visual** em `@theme` (mais `--font-sans: "Recursive Variable", system-ui, sans-serif`); `body` com `--color-paper` e `--color-ink`, `font-variation-settings: "MONO" 0, "CASL" 0`; utilitários `.slip-mono` (`"MONO" 1`) e `.tabular` (`tabular-nums`); `:focus-visible` com contorno de 3px `--color-pen`; `input, select, textarea { font-size: 1rem }`; bloco `@media (prefers-reduced-motion: reduce)` zerando animações e transições.

- [ ] **Step 3: Escrever o teste que falha** `src/App.test.tsx`: `renders the app name` — `render(<App />)` mostra o heading `Finanças`.

Run: `npm test` → FAIL (`App` não existe).

- [ ] **Step 4: Implementar** `main.tsx` (renderiza `<App />` em `StrictMode`) e `App.tsx` provisório (heading "Finanças"; a Tarefa 7 o substitui pelas rotas), mais os utilitários de teste.

- [ ] **Step 5: Verificar**

Run: `npm run check`
Expected: tipos ok, 1 teste passando, build gera `dist/index.html`.

- [ ] **Step 6: CI** — novo job `frontend` em `.github/workflows/ci.yml`: `actions/setup-node@v4` com `node-version: 24`, cache npm por `frontend/package-lock.json`, `npm ci` e `npm run check` com `working-directory: frontend`.

- [ ] **Step 7: Commit**

```bash
git add frontend .github/workflows/ci.yml backend/.env.example
git commit -m "chore(frontend): fundação com Vite, React, TypeScript, Tailwind e Vitest" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Domínio do frontend — texto, dinheiro, datas e rótulos

**Files:**
- Create: `frontend/src/domain/text.ts`, `money.ts`, `dates.ts`, `labels.ts`
- Test: `frontend/src/domain/money.test.ts`, `dates.test.ts`, `text.test.ts`

**Interfaces:**
- `normalize(text: string): string` — igual ao backend: NFKD, sem marcas combinantes, minúsculas, pontuação vira espaço, espaços compactados (`"Pão-de-Açúcar!"` → `"pao de acucar"`).
- `class InvalidMoney extends Error`; `parseMoney(text: string): string` — mesmas regras do `parse_money` do backend (vírgula decimal; um ponto com 1–2 dígitos é decimal, com 3 é milhar; prefixo `R$`; máximo 12 dígitos inteiros; mais de 2 casas é erro), retornando a string canônica com 2 casas, sem zeros à esquerda (`"007"` → `"7.00"`). `tryParseMoney(text): string | null`; `isPositive(amount: string): boolean`; `formatBRL(amount: string): string` com `−` (U+2212) em negativos e sem sinal em zero (`"-1234.5"` → `"−R$ 1.234,50"`); `toInputAmount(amount: string): string` (`"42.50"` → `"42,50"`).
- `addDays(iso: string, days: number): string`; `firstDayOfMonth(iso: string): string`; `matchDate(words: string[], index: number, today: string): { date: string; consumed: number } | null` reconhecendo `hoje`, `ontem`, `anteontem`, `dia N` (consome 2) e `D/M`; `dayLabel(iso: string, today: string): string` (`"Hoje"`, `"Ontem"`, `"03/10"`, ou `"20/12/2025"` em outro ano). Aritmética só com `Date.UTC`/`getUTC*` sobre a string ISO.
- `labels.ts`: `PAYMENT_METHOD_LABELS` (`PIX: "Pix"`, `DEBIT: "Débito"`, `CASH: "Dinheiro"`, `BOLETO: "Boleto"`, `OTHER: "Outro"`), `ACCOUNT_TYPE_LABELS` (`CHECKING: "Conta corrente"`, `SAVINGS: "Poupança"`, `CASH: "Carteira"`), `TRANSACTION_TYPE_LABELS` (`EXPENSE: "Despesa"`, `INCOME: "Receita"`, `TRANSFER: "Transferência"`, `REFUND: "Estorno"`).

- [ ] **Step 1: Escrever os testes que falham**
  - `money.test.ts`: as mesmas tabelas de aceitos/recusados do `backend/tests/domain/test_money.py` (resultado em string canônica: `"1.234,56"` → `"1234.56"`, `"42.5"` → `"42.50"`, `"1.234"` → `"1234.00"`, `"R$ 42"` → `"42.00"`; recusa `"42,505"`, `"1.2345"`, `",50"`, `"-5"`, `"1.000.000.000.000,00"`); `formatBRL` com `"0"` → `"R$ 0,00"`, `"1000000"` → `"R$ 1.000.000,00"`, `"-32.00"` → `"−R$ 32,00"`, `"-0.00"` → `"R$ 0,00"`; `isPositive("0.00") === false`; `money module never converts money to number` — o texto de `money.ts` (lido com `readFileSync(new URL("./money.ts", import.meta.url))`) não contém `parseFloat`, `Number(` nem `toFixed`.
  - `dates.test.ts` (today `2026-10-15`): `hoje`/`ontem`/`anteontem`; `["dia","3"]` → `2026-10-03`, consumed 2; **`day of month in the future or missing falls back to previous month`**: `["dia","20"]` → `2026-09-20` e, com today `2026-11-15`, `["dia","31"]` → `2026-10-31`; `"3/10"` → `2026-10-03`; `"20/12"` → `2025-12-20`; `"31/02"` → `null`; `addDays("2028-02-28", 1) === "2028-02-29"`; `dayLabel`.
  - `text.test.ts`: `"DROGASIL"` → `"drogasil"`, `"Pão-de-Açúcar!"` → `"pao de acucar"`, `"  Uber   Eats "` → `"uber eats"`.

Run: `npm test` → FAIL (módulos inexistentes).

- [ ] **Step 2: Implementar os quatro módulos.**

- [ ] **Step 3: Verificar** — `npm run check` → tudo passa.

- [ ] **Step 4: Commit** — `feat(frontend): domínio de texto, dinheiro, datas e rótulos`.

---

### Task 5: Interpretador de frases

**Files:**
- Create: `frontend/src/domain/parser.ts`
- Test: `frontend/src/domain/parser.test.ts`

**Interfaces:**
- Tipos: `PaymentMethod = "PIX" | "DEBIT" | "CASH" | "BOLETO" | "OTHER"`; `EntryType = "EXPENSE" | "INCOME"`; `PendingField = "amount" | "description" | "account" | "paymentMethod"`; `EntryAccount { id: string; name: string; type: "CHECKING" | "SAVINGS" | "CASH" }`; `ParseContext { today: string; accounts: EntryAccount[] }`; `ParsedItem { raw: string; type: EntryType; amount: string | null; description: string | null; occurredOn: string; accountId: string | null; paymentMethod: PaymentMethod | null; pending: PendingField[] }`.
- `parseEntry(text: string, ctx: ParseContext): ParsedItem[]` — itens separados por `;` ou quebra de linha (vazios ignorados).
- Regras por item, nesta ordem (cada token usado sai da descrição):
  1. **Tipo:** `+` no início do primeiro token, ou primeira palavra `recebi`/`ganhei` → `INCOME`; `gastei`/`paguei`/`comprei` no início são descartados.
  2. **Data:** primeira expressão reconhecida por `matchDate` (palavras normalizadas); padrão = `today`.
  3. **Valor:** token isolado `R$` é descartado; tokens em que `tryParseMoney` funciona são candidatos. Exatamente um candidato positivo → valor; zero ou vários → `amount = null` e os candidatos ficam na descrição.
  4. **Conta:** nome da conta normalizado procurado como sequência contígua de palavras; nomes mais longos primeiro, sem sobreposição. Exatamente uma conta → `accountId`; várias → `null` (as palavras ficam na descrição).
  5. **Meio (só despesa):** `pix`, `debito`, `dinheiro`/`especie`, `boleto`. Um meio distinto → definido; vários → `null`.
  6. **Inferência de carteira:** meio `CASH` sem conta e exatamente uma conta `CASH` → essa conta; conta `CASH` sem meio → meio `CASH`.
  7. **Descrição:** tokens restantes (texto original), sem palavras de ligação nas pontas (`no, na, nos, nas, em, com, via, pelo, pela, de, do, da, pra, para, o, a, um, uma, e`); vazia → `null`.
  8. **Pendências:** `amount`, `description`, `account`, e `paymentMethod` só para despesa.

- [ ] **Step 1: Escrever os testes que falham** — tabela com contas `Itaú` (CHECKING), `Nubank` (CHECKING), `Carteira` (CASH) e today `2026-10-15`:

| Entrada | Esperado |
|---|---|
| `42 mercado pix itaú` | despesa, `42.00`, `"mercado"`, hoje, Itaú, PIX, sem pendências |
| `42,50 padaria` | `42.50`, `"padaria"`, pendências `account`, `paymentMethod` |
| `gastei 120 na farmácia ontem no débito nubank` | `120.00`, `"farmácia"`, `2026-10-14`, Nubank, DEBIT |
| `dia 3: 35 ifood` | `35.00`, `"ifood"`, `2026-10-03` |
| `+120 reembolso` | receita, `120.00`, `"reembolso"`, pendência só `account` |
| `recebi 3000 salário itaú` | receita, Itaú, sem pendências |
| `50 dinheiro feira` | CASH, conta Carteira, `"feira"`, sem pendências |
| `R$ 42 mercado` | `42.00`, `"mercado"` |
| `42 pão de açúcar pix` | `"pão de açúcar"` |
| `2 cafés 15` | `amount` nulo, `"2 cafés 15"` |
| `42` | `description` nula |
| `mercado pix` | `amount` nulo |

  e ainda: **`matches account names ignoring case and accents`** (`42 mercado pix ITAU` → Itaú); `prefers the longest account name` (contas `Itaú` e `Itaú PJ`: `10 lanche itaú pj pix` → Itaú PJ); `ambiguous accounts stay pending` (`42 mercado itaú nubank pix` → `accountId` nulo); `splits batch by semicolon and newline` (`"hoje: almoço 30; café 8\nuber 22"` → 3 itens).

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar `parseEntry`.**

- [ ] **Step 3: Verificar** — `npm run check` → tudo passa.

- [ ] **Step 4: Commit** — `feat(frontend): interpretador de frases de lançamento`.

---

### Task 6: Cliente da API, tipos gerados e consultas

**Files:**
- Create: `frontend/src/api/schema.d.ts` (gerado), `types.ts`, `client.ts`, `endpoints.ts`, `queries.ts`, `queryClient.ts`
- Modify: `frontend/package.json` (script `api:types`), `frontend/src/test/fixtures.ts` (dados de exemplo para MSW)
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Script `api:types`: `uv --directory ../backend run python scripts/export_openapi.py > openapi.json && openapi-typescript openapi.json -o src/api/schema.d.ts` (`openapi.json` no `.gitignore` do frontend; `schema.d.ts` é commitado).
- `types.ts`: aliases de `components["schemas"]` — `UserOut`, `AccountOut`, `AccountIn`, `BalancesOut`, `CategoryOut`, `CategoryIn`, `MerchantOut`, `TransactionOut`, `TransactionWriteOut`, `TransactionPage`, `IncomeIn`, `ExpenseIn`, `TransferIn`, `RefundIn`, `TransactionPatch`, `EntryHintsOut`, `EntryChecksOut`, `MonthSummaryOut`.
- `client.ts`: `FieldError { field: string; message: string }`; `class ApiError extends Error { status: number; code: string; detail: string; fieldErrors: FieldError[]; requestId: string | null }`; `UNAUTHENTICATED_EVENT = "pf:unauthenticated"`; `apiFetch<T>(path: string, options?: { method?: "GET" | "POST" | "PATCH"; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }): Promise<T>` — URL `new URL(path, window.location.origin)`, `credentials: "same-origin"`, `Accept` e `X-Requested-With: fetch` sempre, `Content-Type` só com corpo; 204 → `undefined`; resposta não-ok → `ApiError` a partir do Problem Details (corpo ilegível → `code "http_error"`, `detail "Erro inesperado. Tente de novo."`); falha de rede → `ApiError(0, "network_error", "Sem conexão com o servidor. Verifique a internet e tente de novo.")`; 401 dispara `UNAUTHENTICATED_EVENT` em `window`. `newIdempotencyKey(): string` = `crypto.randomUUID()`.
- `endpoints.ts`: objeto `api` com `me`, `login(email, password)`, `logout`, `entryHints`, `accounts(includeArchived?)`, `balances`, `createAccount(body)`, `updateAccount(id, body)`, `archiveAccount(id)`, `categories(kind?, includeArchived?)`, `createCategory(body)`, `updateCategory(id, body)`, `archiveCategory(id)`, `merchants(q)`, `transactions(params)`, `createTransaction(body, key)`, `updateTransaction(id, patch)`, `voidTransaction(id)`, `refund(id, body, key)`, `entryChecks(items)`, `monthSummary(month)` — cada um um `apiFetch` com o caminho e método do contrato da spec.
- `queries.ts`: `queryKeys` (`me`, `hints`, `accounts`, `balances`, `categories(kind)`, `merchant(q)`, `transactions(params)`); hooks `useMe`, `useEntryHints`, `useAccounts`, `useBalances`, `useCategories`, `useMerchantSuggestion(description)`, `useTransactions(params)` (infinita por `next_cursor`), `useRecentTransactions()` (limite 30); `useInvalidateLedger(): () => Promise<void>` invalida saldos, lançamentos e `entry-hints`.
- `queryClient.ts`: `createQueryClient()` — sem nova tentativa para `ApiError` com status < 500; no máximo 2 para o resto.

- [ ] **Step 1: Gerar os tipos** — com o backend da Tarefa 2: `npm run api:types` → cria `src/api/schema.d.ts`.

- [ ] **Step 2: Escrever os testes que falham** em `client.test.ts` (MSW):
  - `returns parsed JSON and sends the CSRF header` (o handler confere `X-Requested-With === "fetch"`).
  - `turns Problem Details into ApiError` (409 `idempotency_key_reused` → `status`, `code`, `detail`, `requestId`).
  - `keeps field errors` (422 com `errors` → `fieldErrors`).
  - `network failure becomes network_error` (`HttpResponse.error()` → `status 0`, `code "network_error"`).
  - `401 dispatches the unauthenticated event`.
  - `sends the idempotency key header` (via `api.createTransaction`).

Run: `npm test` → FAIL.

- [ ] **Step 3: Implementar** `client.ts`, `types.ts`, `endpoints.ts`, `queries.ts`, `queryClient.ts`.

- [ ] **Step 4: Verificar** — `npm run check` → tudo passa.

- [ ] **Step 5: Commit** — `feat(frontend): cliente da API com tipos gerados do OpenAPI`.

---

### Task 7: Login, proteção de rotas e casca de navegação

**Files:**
- Create: `frontend/src/routes.tsx`, `src/features/auth/LoginPage.tsx`, `RequireAuth.tsx`, `useUnauthenticatedRedirect.ts`, `src/features/shell/AppShell.tsx`, `MorePage.tsx`, `src/ui/styles.ts`; páginas provisórias (`HomePage`, `AccountsPage`, `TransactionsPage`, `CategoriesPage` exibindo só o título — substituídas nas tarefas seguintes)
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/features/auth/auth.test.tsx`

**Interfaces:**
- `AppRoutes()` — rotas: `/login`; dentro de `RequireAuth` + `AppShell`: `/` (Início), `/lancamentos`, `/lancamentos/novo` (formulário completo, Tarefa 12), `/contas`, `/mais`, `/mais/categorias`; `*` → `/`. `App` = `QueryClientProvider` + `BrowserRouter` + `AppRoutes`.
- `RequireAuth({ children })`: carregando → `role="status"` "Carregando…"; 401 → `<Navigate to="/login" state={{ from: location.pathname }} replace />`; outro erro → alerta com "Tentar de novo".
- `LoginPage`: campos "E-mail" e "Senha" (`autocomplete` `username`/`current-password`), botão "Entrar"; sucesso grava o usuário em `queryKeys.me` e navega para `state.from ?? "/"`; erro mostra `ApiError.detail` em `role="alert"`.
- `useUnauthenticatedRedirect()`: ouve `UNAUTHENTICATED_EVENT` e, **só se houver usuária em cache**, faz `resetQueries(queryKeys.me)` (evita laço de 401).
- `AppShell`: `<nav aria-label="Principal">` fixa embaixo no celular e lateral a partir de `md`: Início, Lançamentos, Contas, Mais; `Outlet`. `MorePage`: links "Categorias" e botão "Sair" (`api.logout`, limpa o cache, vai para `/login`).
- `styles.ts`: classes compartilhadas `inputClass`, `primaryButtonClass` (fundo `--color-pen`), `secondaryButtonClass` (contorno), `chipClass` (pílula com contorno `--color-pen`; com `aria-pressed="true"` fica preenchida), `ledgerRowClass` (linha do livro-caixa com borda inferior `--color-rule`), `slipClass` (comprovante). Alvos de toque de pelo menos 44px. Navegação: item ativo em `--color-pen`, peso 650.

- [ ] **Step 1: Escrever os testes que falham** (`renderWithProviders(<AppRoutes />, { route })` + MSW):
  - `unauthenticated visit shows the login page` (`/auth/me` 401 → heading "Entrar") e `login page has no accessibility violations`.
  - `successful login goes to the requested page` (rota inicial `/contas` → após login, heading "Contas").
  - `wrong password shows the server message` (401 `invalid_credentials` → alerta "E-mail ou senha incorretos.").
  - `logout returns to login` (em `/mais`, clicar "Sair").
  - `navigation exposes the main sections` (links Início, Lançamentos, Contas, Mais).

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): login, rotas protegidas e navegação`.

---

### Task 8: Estado do cartão de confirmação

**Files:**
- Create: `frontend/src/features/entry/cardState.ts`
- Test: `frontend/src/features/entry/cardState.test.ts`

**Interfaces:**
- `ItemStatus = "draft" | "sending" | "saved" | "error"`.
- `CardItem { key: string; included: boolean; type: EntryType; amountText: string; description: string; occurredOn: string; accountId: string | null; paymentMethod: PaymentMethod | null; categoryId: string | null; status: ItemStatus; error: string | null; warnings: string[]; savedLine: string | null; duplicates: number }` — `amountText` é o que a usuária vê (`"42,50"`); `categoryId` só quando ela escolheu.
- `CardAction`: `edit { index, patch }` (campos editáveis: `amountText`, `description`, `occurredOn`, `accountId`, `paymentMethod`, `categoryId`), `toggle { index }`, `duplicates { index, count }`, `sending { index }`, `saved { index, line, warnings }`, `failed { index, message }`.
- `initCard(parsed: ParsedItem[]): CardItem[]` (nova chave por item); `cardReducer(state, action): CardItem[]`; `amountOf(item): string | null` (string canônica positiva ou `null`); `missingFields(item): PendingField[]`; `canConfirm(items): boolean` (há item incluído não gravado, nenhum enviando, nenhum incompleto); `toRequestBody(item): IncomeIn | ExpenseIn` (lança erro se incompleto; omite `category_id` quando `null`; receita sem `payment_method`).
- Regras: item `saved` não muda mais (edit/toggle ignorados); **editar um item que falhou gera nova `key`** (o conteúdo mudou, então é outra intenção); `sending` e `failed` mantêm a `key` (é a mesma tentativa).

- [ ] **Step 1: Escrever os testes que falham** — `initCard maps parsed items` (`amountText "42,00"`, `included true`, chaves distintas), `edit updates amount and clears error`, `missingFields reflects pending fields`, `canConfirm requires complete included items`, `unchecked items are ignored by canConfirm`, `editing a failed item creates a new key`, `failure keeps the key for retry`, `saved items are immutable`, `toRequestBody builds expense and income bodies` (com e sem `categoryId`).

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): estado do cartão de confirmação`.

---

### Task 9: Cartão de confirmação

**Files:**
- Create: `frontend/src/features/entry/describe.ts`, `ConfirmationCard.tsx`, `ItemEditor.tsx`
- Test: `frontend/src/features/entry/ConfirmationCard.test.tsx`

**Interfaces:**
- `SavedEntry { line: string; warnings: string[] }`.
- `describeSaved(tx: TransactionOut, names: { accounts: Map<string, string>; categories: Map<string, string> }): string` → `"Despesa registrada: R$ 42,00 em Mercado, paga com Pix Itaú."`; receita: `"Receita registrada: R$ 3.000,00 em Salário, recebida na Itaú."`.
- `ConfirmationCard({ parsed: ParsedItem[]; hints: EntryHintsOut; onSaved: (entries: SavedEntry[]) => void; onClose: () => void })`:
  - Visual de **comprovante** (seção Direção visual: `slipClass`, bordas picotadas, `slip-mono` nos campos, valor em 20px peso 650, divisória tracejada antes do pagamento, entrada "de impressora" desativada por `prefers-reduced-motion`).
  - `useReducer(cardReducer, parsed, initCard)`; heading "Confirmar lançamento" (ou "Confirmar lançamentos" com mais de um item) recebe foco ao montar (`tabIndex={-1}`).
  - Por item (`ItemEditor`): caixa "Incluir" quando há mais de 1 item; campos Valor (texto), Descrição, Data (`type="date"`, destacada quando ≠ hoje); **pagamento (despesa):** pergunta "Como você pagou?" com até 3 botões de `hints.top_payment_options` (rótulo `"Pix Itaú"`, meio seguido da conta, `aria-pressed`) e, sempre, selects "Conta" e "Meio"; **receita:** só select "Conta"; **categoria:** select da categoria do tipo, com valor = escolha da usuária ?? sugestão (`useMerchantSuggestion(description)` = `default_category_id` do estabelecimento de nome normalizado igual) ?? "A classificar" do tipo; trocar o select grava `categoryId`.
  - Ao montar: `api.entryChecks` para os itens com valor e descrição → `duplicates`; item com duplicata mostra "Possível duplicata: já existe um lançamento igual em ±2 dias."
  - Botão principal "Confirmar" (ou "Tentar de novo" se algum item falhou), habilitado por `canConfirm`; envia **em sequência** só os itens incluídos e não gravados, cada um com sua `key`; sucesso → `saved` com `describeSaved` e `warnings[].detail`; erro → `failed` com `ApiError.detail`. Ao final: se houve gravações, `useInvalidateLedger()` e `onSaved(entries)`; se todos os incluídos estão gravados, `onClose()`.
  - "Cancelar" chama `onClose()`. Mensagens de envio em região `aria-live="polite"`; erro de item com `role="alert"`.

- [ ] **Step 1: Escrever os testes que falham** (MSW com `hints` e categorias de `fixtures.ts`):
  - `shows the parsed values` (valor `42,00`, descrição `mercado`, chip "Pix Itaú" pressionado).
  - `confirm stays disabled until payment is chosen` (item sem pagamento; clicar no chip habilita).
  - `confirm posts with an idempotency key and reports the saved line` (handler grava o cabeçalho; `onSaved` recebe `"Despesa registrada: R$ 42,00 em Mercado, paga com Pix Itaú."`).
  - **`retry after network failure reuses the same idempotency key`** (1ª resposta `HttpResponse.error()`, 2ª 201; as duas chaves capturadas são iguais; o botão mostra "Tentar de novo" entre elas).
  - **`batch with one failure keeps the others saved and retries only the failed one`** (2 itens; o 2º recebe 422 na 1ª vez; na nova tentativa só 1 requisição é feita).
  - `unchecked items are not sent`.
  - `sends category_id only when the user changed the category`.
  - `shows the duplicate warning`.
  - `shows the negative balance warning` (resposta com `warnings`).
  - `card has no accessibility violations`.

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): cartão de confirmação com lote, duplicatas e nova tentativa`.

---

### Task 10: Tela inicial

**Files:**
- Create: `frontend/src/features/home/HomePage.tsx`, `BalanceHeader.tsx`, `Timeline.tsx`, `Composer.tsx`, `draft.ts`, `src/ui/useOnlineStatus.ts`, `src/ui/OfflineBanner.tsx`
- Test: `frontend/src/features/home/HomePage.test.tsx`

**Interfaces:**
- `draft.ts`: `DRAFT_KEY = "pf:draft"`; `loadDraft(): string`; `saveDraft(text: string): void` (texto vazio remove a chave); ambos tolerantes a `sessionStorage` indisponível (try/catch).
- `useOnlineStatus(): boolean` (`navigator.onLine` + eventos `online`/`offline`); `OfflineBanner` com `role="status"`: "Sem conexão. O que você digitar fica guardado aqui até a conexão voltar."
- `BalanceHeader`: "Saldo em contas" (14px, `--color-ink-soft`) e `formatBRL(total)` em 34px, peso 650, algarismos tabulares: o maior texto da tela.
- `Timeline({ sessionEntries: SavedEntry[] })`: livro-caixa (seção Direção visual) com os lançamentos de `useRecentTransactions()` agrupados por `occurred_on` (cabeçalho `dayLabel`); cada linha com descrição e, em segunda linha, categoria (ou "Transferência") e pagamento separados por vírgula; valor à direita com sinal (`−` despesa/transferência em `--color-stamp`, `+` receita/estorno em `--color-income`); abaixo, as linhas confirmadas nesta sessão com seus avisos. Vazia: "Anote seu primeiro gasto. Digite algo como “42 mercado pix itaú”."
- `Composer({ onSubmit: (text: string) => void; disabled: boolean })`: `textarea` com rótulo "Novo lançamento" e placeholder `Ex.: 42 mercado pix itaú`; Enter envia, Shift+Enter quebra linha; botão "Enviar"; restaura `loadDraft()` ao montar e chama `saveDraft` a cada alteração; limpa ao enviar. Link "Formulário completo" para `/lancamentos/novo`.
- `HomePage`: `BalanceHeader`, `Timeline`, `ConfirmationCard` (quando há itens interpretados por `parseEntry(text, { today: hints.today, accounts: hints.accounts })`), `OfflineBanner` (quando offline) e `Composer` fixo acima da navegação no celular.

- [ ] **Step 1: Escrever os testes que falham**
  - `shows balance and groups the timeline by day` (lançamentos de hoje e ontem → cabeçalhos "Hoje" e "Ontem"; linha com `−42,00` e "Mercado, Pix Itaú").
  - `typing a phrase opens the confirmation card` (digitar `42 mercado pix itaú` + Enter → heading "Confirmar lançamento").
  - `empty text does nothing`.
  - **`draft survives the redirect to login`**: com `/auth/me` 200, digitar `42 padaria` (sem enviar); trocar `/auth/me` para 401 e disparar `UNAUTHENTICATED_EVENT`; fazer login de novo → o campo volta com `42 padaria`.
  - `offline shows the banner and keeps the text`.
  - `home has no accessibility violations`.

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): tela inicial com saldo, linha do tempo e campo de lançamento`.

---

### Task 11: Contas

**Files:**
- Create: `frontend/src/features/accounts/AccountsPage.tsx`, `frontend/src/ui/MoneyInput.tsx`
- Test: `frontend/src/features/accounts/AccountsPage.test.tsx`

**Interfaces:**
- `MoneyInput({ id, label, value, onChange, allowNegative?, error? })`: input de texto (`inputMode="decimal"`) com rótulo e erro ligado por `aria-describedby`; quem usa converte com `tryParseMoney` (e trata o `-` inicial quando `allowNegative`).
- `AccountsPage`: lista de `useBalances()` (contas não arquivadas; nome, tipo, saldo formatado) e total; formulário "Nova conta" — Nome, Tipo (select com `ACCOUNT_TYPE_LABELS`), Saldo de abertura (`MoneyInput` com negativo), Data de abertura (padrão `firstDayOfMonth(hints.today)`); envia `api.createAccount` com o valor canônico; erros: `fieldErrors` no campo correspondente e `detail` em alerta. Cada conta tem ações "Editar" (nome e tipo, em `<dialog>`) e "Arquivar" (confirmação; mostra o aviso `archived_with_balance` quando vier).

- [ ] **Step 1: Escrever os testes que falham** — `lists accounts with formatted balances`, `creates an account sending the canonical amount` (`"1.000,50"` → corpo com `"1000.50"`; `"-250"` → `"-250.00"`), `shows the server message for duplicate names` (409 `name_already_exists`), `archiving shows the balance warning`, `accounts page has no accessibility violations`.

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): tela de contas`.

---

### Task 12: Formulário completo

**Files:**
- Create: `frontend/src/features/form/TransactionForm.tsx`, `FullFormPage.tsx`
- Test: `frontend/src/features/form/TransactionForm.test.tsx`

**Interfaces:**
- `TransactionForm({ initial?: TransactionOut; onDone: (tx: TransactionOut) => void })`: seletor de tipo (Despesa, Receita, Transferência — oculto ao editar), Valor (`MoneyInput`), Data, Descrição, Notas, Estabelecimento (opcional; vazio = a descrição), conta (ou contas de origem e destino na transferência), Meio (despesa), Categoria (despesa/receita; só enviada se alterada). **Criação:** `api.createTransaction` com chave gerada **uma vez por abertura do formulário** e reaproveitada em nova tentativa. **Edição:** `api.updateTransaction` enviando só os campos alterados (comparação com `initial`). Erros: `fieldErrors` nos campos, `detail` em alerta, avisos (`warnings`) exibidos após salvar.
- `FullFormPage` (`/lancamentos/novo`): título "Novo lançamento", `TransactionForm` e, ao concluir, volta para `/` com a linha de confirmação.

- [ ] **Step 1: Escrever os testes que falham** — `creates a transfer between two accounts`, `transfer requires a destination different from the origin` (mensagem do backend `transfer_same_account` exibida), `creates an income without payment method`, `editing sends only changed fields` (mudar só as notas → corpo `{ "notes": … }`), `retry reuses the form idempotency key`, `form has no accessibility violations`.

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): formulário completo de lançamento`.

---

### Task 13: Lançamentos

**Files:**
- Create: `frontend/src/features/transactions/TransactionsPage.tsx`, `RefundDialog.tsx`
- Test: `frontend/src/features/transactions/TransactionsPage.test.tsx`

**Interfaces:**
- `TransactionsPage` (`/lancamentos`): filtros — período (De/Até), conta, categoria, tipo, situação (`CONFIRMED` padrão, `VOIDED`, `ALL` = "Todos") — refletidos na URL (`useSearchParams`); lista em formato de livro-caixa (mesmas linhas da tela inicial) de `useTransactions(filtros)` com "Carregar mais" enquanto houver `next_cursor`; por lançamento: "Editar" (abre `TransactionForm` com `initial` em `<dialog>`), "Anular" (confirmação; erro `has_active_refunds` exibido), "Estornar" (só despesas confirmadas).
- `RefundDialog({ expense: TransactionOut; onDone })`: Valor (padrão = valor da despesa), Data (padrão hoje), conta (padrão a da despesa); chave por abertura do diálogo; erro `refund_exceeds_original` exibido.

- [ ] **Step 1: Escrever os testes que falham** — `filters are kept in the URL`, `load more appends the next page` (usa `next_cursor`), `voided items are hidden by default and shown with Todos`, `void shows the server message when refunds exist`, `refund sends amount and idempotency key`, `transactions page has no accessibility violations`.

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): tela de lançamentos com filtros, edição, anulação e estorno`.

---

### Task 14: Categorias

**Files:**
- Create: `frontend/src/features/categories/CategoriesPage.tsx`
- Test: `frontend/src/features/categories/CategoriesPage.test.tsx`

**Interfaces:**
- `CategoriesPage` (`/mais/categorias`): duas seções, "Despesas" e "Receitas"; cada categoria com nome, marcação "Essencial" (checkbox que chama `api.updateCategory` com `is_essential`), "Renomear" e "Arquivar" — **ocultos para categorias de sistema** (`is_system`), que mostram o selo "Do sistema"; formulário "Nova categoria" (nome, tipo, essencial).

- [ ] **Step 1: Escrever os testes que falham** — `groups categories by kind`, `system categories cannot be renamed or archived` (sem botões), `toggling essential sends is_essential`, `creating a duplicate shows the server message`, `categories page has no accessibility violations`.

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check`.

- [ ] **Step 4: Commit** — `feat(frontend): tela de categorias`.

---

### Task 15: PWA

**Files:**
- Create: `frontend/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- Modify: `frontend/vite.config.ts`, `frontend/src/main.tsx`
- Test: `frontend/src/pwa.test.ts`

**Interfaces:**
- `VitePWA` com `registerType: "autoUpdate"`, `injectRegister: "script"` (arquivo externo, compatível com a CSP `default-src 'self'`), manifesto: `name "Finanças"`, `short_name "Finanças"`, `lang "pt-BR"`, `start_url "/"`, `display "standalone"`, `theme_color "#0f766e"`, `background_color "#f8fafc"` e os três ícones. Workbox: só o esqueleto do app em cache (`globPatterns` de `js,css,html,svg,png,webmanifest`), `navigateFallback: "/index.html"` com `navigateFallbackDenylist: [/^\/api\//]` — **nenhuma resposta de `/api` é guardada em cache**.
- Ícones: gerados por um script descartável (fora do repositório) ou desenhados — quadrado com fundo `#0f766e` e o símbolo "R$" em branco; o maskable com margem de segurança de 20%.

- [ ] **Step 1: Escrever o teste que falha** — `pwa.test.ts` lê o `vite.config.ts` como texto e confere: `navigateFallbackDenylist` contém `/^\/api\//`, `injectRegister: "script"`, `display: "standalone"` e os três ícones existem em `public/icons/`.

Run: `npm test` → FAIL.

- [ ] **Step 2: Implementar.**

- [ ] **Step 3: Verificar** — `npm run check` e conferir que `dist/` contém `manifest.webmanifest`, `sw.js` e `registerSW.js`.

- [ ] **Step 4: Commit** — `feat(frontend): PWA instalável sem cache de dados da API`.

---

### Task 16: Imagem única e smoke ponta a ponta

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `backend/scripts/start.sh`, `frontend/playwright.config.ts`, `frontend/e2e/smoke.spec.ts`, `.claude/launch.json`
- Modify: `docker-compose.yml` (serviço `app`, opcional, para rodar a imagem localmente)

**Interfaces:**
- `Dockerfile` multi-estágio: (1) `node:24-slim` roda `npm ci` e `npm run build` em `frontend/`; (2) `python:3.14-slim` com `uv` (`COPY --from=ghcr.io/astral-sh/uv`), `uv sync --locked --no-dev` em `backend/`, copia `frontend/dist` para `/app/frontend-dist`, `ENV FRONTEND_DIST=/app/frontend-dist` e `PATH=/app/backend/.venv/bin:$PATH` (o venv vem pronto; nada de `uv run` em produção), usuário sem privilégios, `CMD` com `uvicorn --factory app.main:create_app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-127.0.0.1}"` e `alembic upgrade head` antes (script de entrada `backend/scripts/start.sh`).
- `docker-compose.yml`: serviço `app` (perfil `app`, para não subir por padrão) com a imagem, `DATABASE_URL` apontando para `db`, `APP_ORIGIN=http://localhost:8000`, `COOKIE_SECURE=false`, porta `127.0.0.1:8000:8000`.
- `playwright.config.ts`: `baseURL` `http://localhost:8000`, projeto Chromium com viewport de celular (390×844); `webServer` não usado (o teste roda contra a imagem do compose).
- `e2e/smoke.spec.ts` — `login, record a phrase and see the balance`: login com usuária criada pelo CLI; criar conta "Itaú" com R$ 1.000,00 na tela Contas; na tela inicial, digitar `42 mercado pix itaú`, confirmar; a linha "Despesa registrada: R$ 42,00" aparece e o saldo vira `R$ 958,00`.
- `.claude/launch.json`: configurações `backend` (uvicorn em `backend/`, porta 8000, com `APP_ORIGIN=http://localhost:5173` e `COOKIE_SECURE=false`) e `frontend` (`npm run dev`, porta 5173).

- [ ] **Step 1: Construir e subir**

Run: `docker compose --profile app up -d --build` e criar a usuária: `docker compose exec -e PF_NEW_PASSWORD=… app python -m app.cli create-user --email e2e@example.com` 
Expected: `curl -s localhost:8000/api/v1/health` → `{"status":"ok"}`; `curl -sI localhost:8000/` → `text/html`.

- [ ] **Step 2: Escrever e rodar o smoke**

Run (em `frontend/`): `npx playwright install chromium` e `E2E_EMAIL=e2e@example.com E2E_PASSWORD=… npx playwright test`
Expected: 1 teste passando.

- [ ] **Step 3: Commit** — `feat: imagem Docker única e smoke ponta a ponta`.

---

### Task 17: README e verificação manual no navegador

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — seções "Rodando o frontend" (backend com `APP_ORIGIN=http://localhost:5173` e `COOKIE_SECURE=false`; `cd frontend && npm install && npm run dev`; abrir `http://localhost:5173`), "Gerando os tipos da API" (`npm run api:types` após mudar a API), "Imagem de produção" (`docker compose --profile app up --build`) e "Instalando no celular" (abrir pelo HTTPS do servidor e "Adicionar à tela inicial").

- [ ] **Step 2: Verificação manual** com os servidores de `.claude/launch.json` no navegador do app, em viewport de celular (375×812) e desktop:
  - login; criar conta Itaú (R$ 1.000,00) e Carteira (R$ 50,00);
  - digitar `42 mercado pix itaú` → cartão com os valores certos → Confirmar → linha "Despesa registrada…" e saldo R$ 1.008,00;
  - digitar `dia 3: 35 ifood; 18 uber` → cartão com 2 itens e a pergunta "Como você pagou?" → escolher o atalho → Confirmar;
  - lançamento em lote com um item desmarcado; edição pela tela Lançamentos; estorno; anulação;
  - navegação só por teclado (Tab/Enter/Esc) na tela inicial e no cartão;
  - modo avião: aviso de sem conexão e texto preservado;
  - revisão visual por captura de tela contra a seção Direção visual (paleta, comprovante, livro-caixa, foco visível), também com `prefers-reduced-motion` ativo.
Expected: todos os itens funcionam; nenhum erro no console do navegador.

- [ ] **Step 3: Commit** — `docs: frontend no README`.
