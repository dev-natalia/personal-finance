# Subprojeto 3 — Análise: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela de Análise (aba própria) com total do período, rosca por categoria, ranking de lugares, calendário de dias e tela de um lugar, somando todos os meios de pagamento, nos modos "pelas parcelas" e "pela compra".

**Architecture:** O backend ganha uma única consulta de gasto (`ledger.spending_rows`) que o `month_summary` passa a usar, um serviço `analysis` que agrega essa consulta por período, categoria, lugar e dia, e rotas de leitura `/api/v1/analysis/*`. O frontend ganha `features/analysis` com gráficos em SVG feitos à mão, estado de período/filtros na URL e nenhuma soma de dinheiro.

**Tech Stack:** FastAPI, SQLAlchemy 2, PostgreSQL, pytest; React 19, TypeScript, TanStack Query, React Router, Tailwind, Vitest + MSW + axe, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-analise-design.md`

## Global Constraints

- Dinheiro trafega como string canônica ("1234.56"); o frontend **não soma** dinheiro. `Number()` só para geometria de gráfico (ângulos, alturas, intensidade), nunca para texto.
- Todo total vem pronto do backend; o total do mês no modo "pelas parcelas", sem filtros, é **igual** a `ledger.month_summary(...).consumption_total` (inclusive no mês atual).
- Nunca entram: receitas, transferências, pagamentos de fatura, itens OPENING_BALANCE/CARRYOVER/INVOICE_INSTALLMENT, lançamentos anulados.
- Semana de **segunda a domingo**. Mês e semana atuais mostram tudo o que está registrado para eles; ano atual vai até o fim do **mês atual**.
- Parcela no modo "pelas parcelas" tem dia = mesmo dia do mês da compra, no mês de consumo; dia inexistente → último dia do mês (A7).
- Gráficos sem biblioteca nova (SVG à mão); cor nunca é a única informação; os números de cada gráfico também em texto acessível.
- Copy em pt-BR; direção visual "comprovante" (tokens de `index.css`, classes de `ui/styles.ts`); celular primeiro, sem rolagem horizontal em 375px; axe sem violações nas telas novas.
- Período, modo e filtros ficam na URL (`useSearchParams`, `replace: true`), como em Lançamentos.
- "Hoje" é `ctx.today()` no backend e `hints.today` no frontend.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Compra parcelada no dia 31** — no modo parcelas, a parcela de fevereiro cai no último dia de fevereiro, aparece no calendário e não some do total. Teste: Tarefa 2 (`installment day falls on last day of shorter month`).
2. **Estorno que cancelou parcelas** — modo parcelas abate `valor − parcelas canceladas`; modo compra abate o valor inteiro; nenhum dos dois conta duas vezes. Teste: Tarefa 2 (`refund that cancelled installments counts once in each mode`).
3. **Semana que atravessa o ano** (seg 28/12/2026 a dom 03/01/2027) — período, setas e dias corretos. Teste: Tarefa 1 (`week across new year`).
4. **Cartão ou conta arquivados** com gasto no período continuam no filtro e os gastos deles continuam somando. Teste: Tarefa 6 (`archived sources still listed in the filter`) e Tarefa 3 (`archived card spending still counts`).
5. **Anulados e pagamentos de fatura** nunca aparecem, nem no detalhe do dia nem na lista do lugar. Teste: Tarefa 4 (`day and place lists skip voided and invoice payments`).

---

## Mapa de arquivos

```
backend/app/domain/periods.py              (novo)   Period, PeriodKind, period_containing, shift_period
backend/app/services/ledger.py             (mudar)  SpendingMode, Source, spending_rows; month_summary usa spending_rows
backend/app/services/analysis.py           (novo)   summary, day_spending, place_detail, place_transactions
backend/app/api/schemas/analysis.py        (novo)
backend/app/api/routes/analysis.py         (novo)   /analysis/summary, /analysis/day, /analysis/places/{key}, /analysis/places/{key}/transactions
backend/tests/domain/test_periods.py, tests/services/test_spending_rows.py, tests/services/test_analysis.py, tests/api/test_analysis_api.py
frontend/src/features/analysis/            (novo)   AnalysisPage, useAnalysisParams, SpendingDonut, PlaceRanking, SpendingCalendar, DayDetails, PlacePage
frontend/src/features/shell/AppShell.tsx   (mudar)  aba "Análise"
frontend/src/routes.tsx                    (mudar)  /analise, /analise/lugar/:key
frontend/src/features/cards/CardPage.tsx   (mudar)  link "Ver análise deste cartão"
frontend/e2e/smoke.spec.ts, README.md      (mudar)
```

---

### Task 1: Períodos (domínio)

**Files:** Create `backend/app/domain/periods.py`; Test `backend/tests/domain/test_periods.py`

**Interfaces — Produces:**
- `class PeriodKind(StrEnum)`: `MONTH = "month"`, `WEEK = "week"`, `YEAR = "year"`.
- `@dataclass(frozen=True) class Period: kind: PeriodKind; start: date; end: date` (inclusivos).
- `period_containing(kind: PeriodKind, day: date, today: date) -> Period` — mês: 1º ao último dia; semana: segunda a domingo; ano: 1º/jan a 31/dez, **mas** se for o ano de `today`, `end` = último dia do mês de `today`.
- `shift_period(period: Period, steps: int, today: date) -> Period` — anterior (−1) ou seguinte (+1), recalculado com `period_containing`.
- `has_next(period: Period, today: date) -> bool` — falso quando `today` está no período.

- [ ] **Step 1: Testes que falham** — `month of october`, `week starts on monday` (`period_containing(WEEK, date(2026,10,15), …)` → 12/10 a 18/10), `week across new year` (31/12/2026 → 28/12/2026 a 03/01/2027; `shift_period(…, 1, today=date(2027,1,10))` → 04/01 a 10/01), `current year ends at end of current month` (today 15/10/2026 → 01/01 a 31/10/2026), `past year is complete` (2025 → até 31/12/2025), `no next period after today`.
- [ ] **Step 2:** `uv run pytest tests/domain/test_periods.py -q` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(api): períodos de mês, semana e ano para a análise`.

---

### Task 2: Consulta única de gasto (`spending_rows`) e `month_summary` sobre ela

**Files:** Modify `backend/app/services/ledger.py`; Test `backend/tests/services/test_spending_rows.py` (e os testes existentes de `test_ledger.py` continuam passando sem mudança).

**Interfaces — Produces (em `ledger.py`):**
- `class SpendingMode(StrEnum)`: `INSTALLMENTS = "installments"`, `PURCHASE = "purchase"`.
- `@dataclass(frozen=True) class Source: kind: Literal["account", "card"]; id: UUID`.
- `spending_rows(user_id: UUID, start: date, end: date, *, mode: SpendingMode = SpendingMode.INSTALLMENTS, source: Source | None = None, category_id: UUID | None = None) -> Subquery` com colunas: `transaction_id`, `day` (date), `amount` (Numeric; estornos negativos), `category_id`, `merchant_id`, `place_name` (nome do estabelecimento ou a descrição), `place_key` (`'m:' || merchant_id` ou `'d:' || lower(trim(description))`), `counts_as_purchase` (bool: verdadeiro para despesa e encargo, falso para estorno).
- `month_summary` passa a agregar `spending_rows(..., mode=INSTALLMENTS)` do mês por categoria (mesmo resultado de hoje).

**Regras (do spec, seção 3):**
- INSTALLMENTS: despesas via conta e à vista no cartão, encargos e estornos pela data (estorno = `−(amount − parcelas que ele cancelou)`, como hoje); parcelas ativas pelo `consumption_month`, com `day` = mesmo dia do mês da compra no mês de consumo, limitado ao último dia: `least(consumption_month + (extract(day from occurred_on) − 1) * interval '1 day', consumption_month + interval '1 month' − interval '1 day')`.
- PURCHASE: toda despesa (parcelada ou não, inclusive em andamento) pelo `occurred_on` com o valor inteiro; encargos pela data; estornos `−amount` pela data.
- `source` filtra por `Transaction.account_id` ou `Transaction.card_id` do próprio lançamento (o estorno de compra no cartão tem `card_id`; confirmar no modelo e, se não tiver, casar pelo `refund_of_id`).
- `category_id` filtra por `Transaction.category_id`.

- [ ] **Step 1: Testes que falham:**
  - `installments mode matches month summary` (compras à vista, parcelada 1200/6x, encargo, estorno; para out/2026 e nov/2026: soma de `spending_rows` = `month_summary(...).consumption_total`).
  - `purchase mode counts the whole purchase on its date` (1200 em 15/10 no modo compra; 200 em 15/10 e 200 em 15/11 no modo parcelas).
  - `installment day falls on last day of shorter month` (compra 31/01/2027 2x → parcela 2 com `day` = 28/02/2027).
  - `refund that cancelled installments counts once in each mode` (600 em 3x, estorno 200 que cancela a 3ª: parcelas soma 400 nos três meses; compra soma 600 − 200 = 400).
  - `source filter keeps only that card or account` e `category filter`.
  - `voided, transfers, income and invoice payments never appear`.
- [ ] **Step 2:** `uv run pytest tests/services/test_spending_rows.py -q` → FAIL.
- [ ] **Step 3:** Implementar `spending_rows` com `union_all` (como o `month_summary` atual) e reescrever `month_summary` sobre ela.
- [ ] **Step 4:** `bash scripts/check.sh` → tudo verde (inclusive `test_ledger.py` e os testes de cartão que usam `month_summary`).
- [ ] **Step 5: Commit** — `refactor(api): consulta única de gasto com modos parcelas e compra`.

---

### Task 3: Serviço de resumo da análise

**Files:** Create `backend/app/services/analysis.py`; Test `backend/tests/services/test_analysis.py`

**Interfaces:**
- Consumes: `Period`, `period_containing` (Task 1); `spending_rows`, `SpendingMode`, `Source` (Task 2).
- Produces:
  - `TOP_CATEGORIES = 5`; `TOP_PLACES` não existe (o backend devolve todos os lugares; o frontend mostra 5 e "Ver todos").
  - `@dataclass CategoryTotal(category_id: UUID | None, name: str, amount: Decimal)` — `category_id=None` só para "Outras".
  - `@dataclass PlaceTotal(key: str, name: str, amount: Decimal, purchases: int, category_name: str | None)`.
  - `@dataclass DayTotal(day: date, amount: Decimal)` — no período ANO, um por mês (`day` = dia 1).
  - `@dataclass AnalysisSummary(period: Period, total: Decimal, by_category: list[CategoryTotal], by_place: list[PlaceTotal], by_day: list[DayTotal], busiest: DayTotal | None)`.
  - `summary(session, user_id, period: Period, *, mode: SpendingMode, source: Source | None, category_id: UUID | None) -> AnalysisSummary`.

**Regras:**
- `total` e `by_category` **ignoram** `category_id` (a rosca continua inteira); `by_place`, `by_day` e `busiest` respeitam.
- `by_category`: maiores primeiro; da 6ª em diante somadas em `CategoryTotal(None, "Outras", soma)`; categorias com soma ≤ 0 saem.
- `by_place`: maiores primeiro; `purchases` = linhas com `counts_as_purchase` no período (parcela conta em cada mês); `category_name` = categoria mais frequente das linhas do lugar no período (empate: a de maior valor); lugares com soma ≤ 0 saem; `name` do lugar sem estabelecimento = a descrição mais recente.
- `by_day`: só dias (ou meses) com valor ≠ 0; `busiest` = o maior.
- Valores com `quantize`.

- [ ] **Step 1: Testes que falham:** `summary of october by category and place` (iFood 3 pedidos, Mercado Livre, Pão de Açúcar; valores e ordem exatos), `sixth category goes to Outras`, `category filter keeps the donut whole`, `place without merchant is grouped by description` (dois encargos "IOF"), `installment counts as a purchase in each month`, `year groups by month`, `empty period has zero total and no rows`, `archived card spending still counts`.
- [ ] **Step 2:** `uv run pytest tests/services/test_analysis.py -q` → FAIL.
- [ ] **Step 3:** Implementar com `GROUP BY` sobre `spending_rows` (sem somar em Python o que o banco soma).
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** — `feat(api): resumo da análise por categoria, lugar e dia`.

---

### Task 4: Dia e lugar (serviço)

**Files:** Modify `backend/app/services/analysis.py`; Test `backend/tests/services/test_analysis.py`

**Interfaces — Produces:**
- `@dataclass DaySpending(transaction: Transaction, amount: Decimal)` — `amount` é o que conta no dia (a parcela, no modo parcelas).
- `day_spending(session, user_id, day: date, *, mode, source, category_id) -> list[DaySpending]` (maior valor primeiro).
- `@dataclass PlaceTotals(amount: Decimal, purchases: int)`.
- `@dataclass PlaceDetail(key: str, name: str, category_name: str | None, week: PlaceTotals, month: PlaceTotals, year: PlaceTotals, average: Decimal | None)`.
- `place_detail(session, user_id, key: str, *, mode, source, today: date) -> PlaceDetail` — semana, mês e ano **atuais** (`period_containing(..., today, today)`); `average` = média dos valores **registrados** das compras (despesa e encargo) com `occurred_on` no ano atual, independente do modo; `None` sem compras. Chave inexistente para a usuária → `NotFound("o lugar")`.
- `place_transactions(session, user_id, key: str, *, source: Source | None, cursor: str | None, limit: int = 50) -> ledger.Page` — compras e estornos confirmados do lugar (EXPENSE, CHARGE, REFUND), data desc; reaproveita `ledger.list_transactions` acrescentando a `TransactionFilters` os campos `types: tuple[TransactionType, ...] | None` e `description_key: str | None` (compara `lower(trim(description))` com `merchant_id IS NULL`).

- [ ] **Step 1: Testes que falham:** `day spending shows the installment amount on its day`, `place detail has current week month and year` (TODAY = 2026-10-15), `average uses registered purchase value` (1200 em 6x → média 1200 no modo parcelas também), `unknown place is not found`, `day and place lists skip voided and invoice payments`, `place transactions filter by source`.
- [ ] **Step 2:** `uv run pytest tests/services/test_analysis.py -q` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `bash scripts/check.sh` → verde.
- [ ] **Step 5: Commit** — `feat(api): gasto do dia e detalhe do lugar`.

---

### Task 5: API da análise

**Files:** Create `backend/app/api/schemas/analysis.py`, `backend/app/api/routes/analysis.py`; Modify `backend/app/api/routes/__init__.py`, `frontend/src/api/schema.d.ts` (gerado), `frontend/src/api/types.ts`; Test `backend/tests/api/test_analysis_api.py`

**Interfaces — Produces (rotas, prefixo `/analysis`):**
- `GET /analysis/summary?period=month|week|year&date=AAAA-MM-DD&mode=installments|purchase&source=account:<uuid>|card:<uuid>&category_id=<uuid>` → `AnalysisSummaryOut { period: {kind, start, end, has_next}, total, by_category: [{category_id, name, amount}], by_place: [{key, name, amount, purchases, category_name}], by_day: [{day, amount}], busiest: {day, amount} | null }`. `date` padrão = hoje; `mode` padrão = installments.
- `GET /analysis/day?date=&mode=&source=&category_id=` → `[{ transaction: TransactionOut, amount }]`.
- `GET /analysis/places/{key}?mode=&source=` → `PlaceDetailOut { key, name, category_name, week: {amount, purchases}, month, year, average }`.
- `GET /analysis/places/{key}/transactions?source=&cursor=` → `TransactionPage`.
- `source` inválido (formato ou id de outra usuária) → 422 `invalid_source`; `period` inválido → 422 de validação.
- Tipos no frontend: `AnalysisSummaryOut`, `CategoryTotalOut`, `PlaceTotalOut`, `DayTotalOut`, `DaySpendingOut`, `PlaceDetailOut` em `types.ts`; regenerar com `npm run api:types`.

- [ ] **Step 1: Testes que falham:** `summary endpoint returns october`, `week and year periods`, `purchase mode`, `source and category filters`, `invalid source is rejected`, `day endpoint`, `place detail and transactions`, `other user's place is not found`.
- [ ] **Step 2:** `uv run pytest tests/api/test_analysis_api.py -q` → FAIL.
- [ ] **Step 3:** Implementar rotas e schemas (registrar o router); `cd frontend && npm run api:types`.
- [ ] **Step 4:** `bash scripts/check.sh` e `cd frontend && npm run check` → verdes.
- [ ] **Step 5: Commit** — `feat(api): rotas da análise`.

---

### Task 6: Aba Análise, período e filtros

**Files:** Create `frontend/src/features/analysis/AnalysisPage.tsx`, `frontend/src/features/analysis/useAnalysisParams.ts`; Modify `frontend/src/features/shell/AppShell.tsx`, `frontend/src/routes.tsx`, `frontend/src/api/endpoints.ts`, `frontend/src/api/queries.ts`; Test `frontend/src/features/analysis/AnalysisPage.test.tsx`

**Interfaces — Produces:**
- `api.analysisSummary(params: AnalysisQuery)`, `api.analysisDay(...)`, `api.analysisPlace(key, ...)`, `api.analysisPlaceTransactions(key, ...)`; `queryKeys.analysis(...)` com prefixo `'analysis'` (incluir em `useInvalidateLedger`).
- `useAnalysisParams(): { period: 'month'|'week'|'year'; date: string | null; mode: 'installments'|'purchase'; source: string | null; categoryId: string | null; set(patch): void }` — lê/grava `?period=&date=&mode=&source=&category=` com `replace: true`.
- Aba "Análise" entre "Lançamentos" e "Contas" (`/analise`).

**Tela:** título "Análise"; total em destaque: "Gasto em outubro" / "Gasto de 12/10 a 18/10" / "Gasto em 2026", valor `formatBRL`; chips Mês | Semana | Ano (`aria-pressed`); setas "‹ setembro" / "novembro ›" (seguinte só com `has_next`); chave "Pelas parcelas" / "Pela compra" (dois botões `aria-pressed`); select "Cartão ou conta" (Todos + contas e cartões de `useAccounts(true)` e `useCards(true)`, arquivados com "(arquivado/a)"); período sem gasto: "Nenhum gasto em outubro." no lugar dos gráficos.

- [ ] **Step 1: Testes que falham:** `analysis tab opens current month`, `period chips and arrows update the url`, `mode toggle sends purchase mode`, `source filter sends card`, `archived sources still listed in the filter`, `empty period shows one line`, axe.
- [ ] **Step 2:** `npx vitest run src/features/analysis` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run check` → verde.
- [ ] **Step 5: Commit** — `feat(frontend): aba Análise com período, modo e filtro`.

---

### Task 7: Rosca por categoria e ranking de lugares

**Files:** Create `frontend/src/features/analysis/SpendingDonut.tsx`, `frontend/src/features/analysis/PlaceRanking.tsx`; Modify `AnalysisPage.tsx`; Test `AnalysisPage.test.tsx`

- **Rosca** ("Em que você gastou"): SVG com uma fatia por item de `by_category` (ângulos por `Number(amount)/Number(total)`, só geometria), 6 cores de token + padrão/borda que distingue fatias sem depender só da cor; legenda com nome e `formatBRL(amount)`; cada fatia/linha da legenda é um botão "Filtrar por {categoria}" (`aria-pressed`) que grava `category`; "Outras" não filtra; "Limpar filtro" quando há categoria. Alternativa em texto = a própria legenda (lista).
- **Ranking** ("Onde você mais gastou"): linhas com nome, `formatBRL(amount)`, barra proporcional (`<meter>` ou div com largura, rótulo acessível), "{n} compra(s) · {categoria}"; mostra 5 e botão "Ver todos os {N} lugares"; cada nome é link para `/analise/lugar/{encodeURIComponent(key)}?mode=&source=`.

- [ ] **Step 1: Testes que falham:** `donut legend lists categories with amounts`, `tapping a category filters places and calendar` (envia `category_id`; rosca continua com todas), `Outras does not filter`, `ranking shows five and expands`, `place links carry mode and source`, axe.
- [ ] **Step 2:** `npx vitest run src/features/analysis` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run check` → verde.
- [ ] **Step 5: Commit** — `feat(frontend): rosca por categoria e ranking de lugares`.

---

### Task 8: Calendário de dias e detalhe do dia

**Files:** Create `frontend/src/features/analysis/SpendingCalendar.tsx`, `frontend/src/features/analysis/DayDetails.tsx`; Modify `AnalysisPage.tsx`; Test `AnalysisPage.test.tsx`

- **Seus dias**: Mês → grade de segunda a domingo; Semana → 7 células; Ano → 12 meses. Intensidade em 4 níveis por `Number(amount)/Number(max)`; cada célula é um botão com rótulo "{dd/mm}: R$ X" (ou "sem gasto"); a intensidade também aparece como texto/padrão, não só cor. Linha de destaque: "Dia mais caro: {dd/mm}, R$ X" (de `busiest`) e "Sem gasto: {n} dias" — contando só dias do período **até hoje** sem entrada em `by_day` (contagem de dias, não dinheiro).
- Tocar num dia abre `DayDetails` abaixo (`api.analysisDay`): lista com descrição, meio (mesma frase de `ledgerDetail`) e `formatBRL(amount)`; no Ano, tocar num mês muda para o período Mês daquele mês.

- [ ] **Step 1: Testes que falham:** `calendar starts on monday`, `busiest day and days without spending`, `tapping a day lists its spending`, `year shows months and opens the month`, `calendar cells have text labels`, axe.
- [ ] **Step 2:** `npx vitest run src/features/analysis` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run check` → verde.
- [ ] **Step 5: Commit** — `feat(frontend): calendário de gastos e detalhe do dia`.

---

### Task 9: Tela do lugar e atalho do cartão

**Files:** Create `frontend/src/features/analysis/PlacePage.tsx`; Modify `frontend/src/routes.tsx`, `frontend/src/features/cards/CardPage.tsx`; Test `frontend/src/features/analysis/PlacePage.test.tsx`, `frontend/src/features/cards/CardPage.test.tsx`

- `/analise/lugar/:key`: título = nome; categoria; três caixas "Esta semana" / "{mês}" / "{ano}" com `formatBRL` e "{n} compra(s)"; "Média por compra: R$ X" (oculta se `null`); "Compras": lista por dia (como Lançamentos: descrição, `ledgerDetail`, `LedgerAmount`), chips "Todas" + cartões/contas que aparecem nas compras do lugar, "Carregar mais" com cursor. Modo e source vêm da URL.
- Tela do cartão: link "Ver análise deste cartão" → `/analise?source=card:{id}`.

- [ ] **Step 1: Testes que falham:** `place page shows week month and year`, `average hidden without purchases`, `purchases filter by source and paginate`, `card page links to its analysis`, axe.
- [ ] **Step 2:** `npx vitest run src/features/analysis src/features/cards` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run check` → verde.
- [ ] **Step 5: Commit** — `feat(frontend): tela do lugar e atalho da análise no cartão`.

---

### Task 10: Smoke, README e verificação manual

**Files:** Modify `frontend/e2e/smoke.spec.ts`, `README.md`

- [ ] **Step 1: Smoke** — teste novo `analysis: month by category and place`: registra "42 mercado pix itaú" e "38 ifood crédito nubank" (com o cartão do teste de cartão ou criando conta/cartão próprios), abre a aba Análise, vê o total, a legenda com as categorias, o ranking com os dois lugares e abre o lugar "ifood" com as três caixas. Run: `bash scripts/e2e.sh` → todos passando.
- [ ] **Step 2: README** — seção "Análise": modos pelas parcelas/pela compra, períodos (semana de segunda a domingo; mês atual mostra tudo o que está registrado; ano até o mês atual), filtros, tela do lugar.
- [ ] **Step 3: Verificação manual** no app de teste (`app-e2e`, 127.0.0.1:8002, banco `finance_e2e` + seed), celular e desktop: total igual ao resumo do mês; parcelada nos dois modos; estorno; filtro por cartão e categoria; semana e ano; tela do lugar; teclado e leitor de tela; console sem erros.
- [ ] **Step 4: Commit** — `docs: análise no README` (e o smoke em `test(e2e): smoke da análise`).
