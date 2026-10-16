# Subprojeto 2 — Cartões e faturas: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cartão de crédito no app: compras à vista e parceladas, faturas com ciclo, limite, conferência com o banco, pagamento total ou parcial (com restante levado adiante ou parcelado), estorno, e as telas que a usuária chamou de "focos centrais" — comprovante com impacto na fatura e no limite, tela do cartão e pagamento.

**Architecture:** Backend em camadas como no subprojeto 1: regras puras de ciclo e parcelas em `app/domain/cards.py`; cartões, faturas e itens em modelos novos; escrita em `app/services/cards.py` (cadastro e início), `app/services/invoices.py` (itens, pagamento, encargo, conferência) e `app/services/transactions.py` (compra/estorno/edição/anulação no cartão, delegando os itens a `invoices`); todas as somas de fatura, limite e consumo em `app/services/ledger.py` e `app/services/card_ledger.py` (única fonte das definições). Frontend sobre o PWA existente: tipos gerados do OpenAPI, interpretador estendido, comprovante com prévia vinda do backend, tela "Contas e cartões", tela do cartão e pagamento.

**Tech Stack:** o mesmo da `main` (Python 3.14, FastAPI, SQLAlchemy 2 síncrono, Alembic, PostgreSQL 17; React 19, TypeScript, Vite 8, TanStack Query, Tailwind v4, Vitest + MSW + axe, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-16-cartoes-e-faturas-design.md` (aprovada). Decisões globais: `docs/superpowers/specs/2026-10-15-visao-geral-design.md` (A1–A14). Branch: `feat/subprojeto-2-cartoes`.

## Global Constraints

- Tudo do subprojeto 1 continua valendo: dinheiro `Decimal`/`NUMERIC(14,2)`/string no JSON, nunca `float` nem `number` em JS; "hoje" vem do backend (`ctx.today()` / `entry-hints.today`); nada é apagado (anular, cancelar, arquivar); auditoria em toda escrita; idempotência por `Idempotency-Key` com hash do conteúdo; Problem Details com `code` estável e `detail` em português; escopo por usuária em toda consulta.
- O frontend **nunca calcula** fatura, limite, parcela ou consumo: mostra o que o backend devolve (inclusive a prévia do comprovante).
- Faturas fechadas (`closing_date ≤ hoje`) nunca são alteradas por estorno, edição ou anulação de compra.
- O limite **nunca** é somado a dinheiro e aparece sempre com o texto "Limite não é dinheiro." quando houver valor de conta por perto.
- Parcelas: 2 a 24; divisão pela A10 (truncado nos centavos, resto na primeira).
- Interface em camadas: o essencial à vista; detalhe atrás de um toque (`<details>`/seções recolhíveis), sem tudo aberto ao mesmo tempo.
- Direção visual "comprovante" e regras de texto do plano 1B (seção "Direção visual"): verbo primeiro nos botões, sem `·`, sem maiúsculas em rótulos, sem exclamação.
- Todo commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Compra no dia exato do fechamento** — cai na fatura seguinte, nunca na que está fechando. Teste: Tarefa 1 (`purchase on closing day goes to next invoice`).
2. **Fatura com mais crédito que débito** (estorno grande) — o saldo credor abate a fatura seguinte e não some do limite. Teste: Tarefa 5 (`credit balance carries into next invoice`).
3. **Pagamento repetido por rede instável** — a mesma `Idempotency-Key` devolve a mesma operação; nenhuma origem é debitada duas vezes. Teste: Tarefa 7 (`payment replay returns the same group`).
4. **Início do cartão com parcelada em andamento** — a parcela deste mês não aparece duas vezes (está no total da fatura aberta). Teste: Tarefa 4 (`opening with in-progress installments creates only the remaining ones`).
5. **"38 ifood nubank" com conta e cartão chamados Nubank** — não escolhe sozinho; pergunta "Como você pagou?". Teste: Tarefa 10 (`name shared by account and card stays pending`).

---

## Mapa de arquivos

```
backend/app/domain/cards.py                 ciclo, datas da fatura, parcelas, mês de consumo (puro)
backend/app/models/card.py                  Card
backend/app/models/invoice.py               Invoice, InvoiceItem, InvoiceItemKind, ItemDirection, ItemStatus
backend/app/models/transaction.py           tipos/meio/colunas novas e CHECK por tipo (alterado)
backend/migrations/versions/0002_cards_and_invoices.py
backend/app/services/cards.py               cadastro, início, edição de dias, arquivamento
backend/app/services/invoices.py            itens de fatura, pagamento, encargo, conferência, datas
backend/app/services/card_ledger.py         saldo da fatura, estado, limite, resumo, prévia
backend/app/services/ledger.py              saldos e consumo do mês com cartão (alterado)
backend/app/services/transactions.py        compra/estorno/edição/anulação no cartão (alterado)
backend/app/api/schemas/cards.py, invoices.py
backend/app/api/routes/cards.py, invoices.py
backend/app/api/schemas/{transactions,entry}.py, routes/{transactions,entry}.py (alterados)
frontend/src/api/{schema.d.ts,types.ts,endpoints.ts,queries.ts}      (alterados)
frontend/src/domain/parser.ts               crédito, cartão, "6x" (alterado)
frontend/src/features/entry/*               comprovante com cartão e prévia (alterado)
frontend/src/features/cards/                CardsSection, NewCardForm, CardPage, InvoicePaymentForm, InvoiceDetails
frontend/src/features/home/BalanceHeader.tsx  linha da fatura aberta (alterado)
frontend/src/features/form/TransactionForm.tsx, features/transactions/TransactionsPage.tsx (alterados)
frontend/e2e/smoke.spec.ts                  smoke com cartão (alterado)
```

---

### Task 1: Regras puras do cartão

**Files:**
- Create: `backend/app/domain/cards.py`
- Test: `backend/tests/domain/test_cards.py`

**Interfaces:**
- Produces:
  - `invoice_dates(reference_month: date, closing_day: int, due_day: int) -> tuple[date, date]` — (fechamento, vencimento) da fatura que vence no mês `reference_month` (sempre dia 1). Vencimento no mês de referência; fechamento no mesmo mês se `due_day > closing_day`, senão no mês anterior. Dia inexistente → último dia do mês (A7).
  - `invoice_month_for(purchase_date: date, closing_day: int, due_day: int) -> date` — `reference_month` da fatura que recebe a compra: a primeira fatura cuja data de fechamento é **posterior** à data da compra (A6).
  - `add_months(month: date, n: int) -> date` — soma meses a um dia 1.
  - `split_installments(total: Decimal, count: int) -> list[Decimal]` — A10.
  - `consumption_month(purchase_date: date, installment_number: int) -> date` — dia 1 do mês da compra + (k−1) meses.
  - `MIN_INSTALLMENTS = 2`, `MAX_INSTALLMENTS = 24`.

- [ ] **Step 1: Testes que falham** — tabela com o Nubank da usuária (fecha 3, vence 10) e um cartão que fecha 28 e vence 5:
  - `invoice_dates(date(2026,11,1), 3, 10) == (date(2026,11,3), date(2026,11,10))`; `invoice_dates(date(2026,11,1), 28, 5) == (date(2026,10,28), date(2026,11,5))`; `invoice_dates(date(2027,2,1), 31, 10) == (date(2027,1,31), date(2027,2,10))`; `invoice_dates(date(2026,11,1), 3, 31) == (date(2026,11,3), date(2026,11,30))` (A7).
  - `purchase on closing day goes to next invoice`: `invoice_month_for(date(2026,11,3), 3, 10) == date(2026,12,1)`; `invoice_month_for(date(2026,11,2), 3, 10) == date(2026,11,1)`; `invoice_month_for(date(2026,10,16), 3, 10) == date(2026,11,1)`.
  - `split_installments(Decimal("1200.00"), 6) == [Decimal("200.00")] * 6`; `split_installments(Decimal("100.00"), 3) == [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")]`; soma sempre igual ao total (Hypothesis, total de 0,02 a 999.999,99, contagem de 2 a 24, cada parcela ≥ 0,01 quando total ≥ contagem × 0,01).
  - `consumption_month(date(2026,10,16), 1) == date(2026,10,1)`; `consumption_month(date(2026,10,16), 4) == date(2027,1,1)`.

Run: `cd backend && uv run pytest tests/domain/test_cards.py` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar.** Reaproveite `calendar.monthrange` como em `app/domain/dates.py`; `quantize` de `app/domain/money.py` para o truncamento (truncar = `ROUND_DOWN` em centavos; a diferença vai para a primeira).
- [ ] **Step 3: Verificar** — `uv run pytest tests/domain/test_cards.py` passa; `bash scripts/check.sh` verde.
- [ ] **Step 4: Commit** — `feat(cards): regras de ciclo da fatura e divisão em parcelas`.

---

### Task 2: Modelo e migração

**Files:**
- Create: `backend/app/models/card.py`, `backend/app/models/invoice.py`, `backend/migrations/versions/0002_cards_and_invoices.py`
- Modify: `backend/app/models/transaction.py`, `backend/app/models/__init__.py`, `backend/tests/support.py`
- Test: `backend/tests/services/test_card_model.py`

**Interfaces:**
- Produces:
  - `Card(OwnedModel)`: `name: str (String(60))`, `credit_limit: Decimal`, `closing_day: int`, `due_day: int`, `opening_date: date`, `archived_at: datetime | None`. `UniqueConstraint("user_id", "name")`, CHECK `credit_limit > 0`, dias entre 1 e 31.
  - `Invoice(OwnedModel)`: `card_id`, `reference_month: date`, `closing_date: date`, `due_date: date`, `reported_total: Decimal | None`, `dates_edited: bool = False`. `UniqueConstraint("card_id", "reference_month")`, CHECK `reference_month` é dia 1 (`extract(day ...) = 1`), CHECK `closing_date < due_date`.
  - `InvoiceItemKind(StrEnum)`: `PURCHASE`, `CHARGE`, `REFUND_CREDIT`, `CARRYOVER`, `INVOICE_INSTALLMENT`, `OPENING_BALANCE`. `ItemDirection`: `DEBIT`, `CREDIT`. `ItemStatus`: `ACTIVE`, `CANCELLED`.
  - `InvoiceItem(OwnedModel)`: `invoice_id`, `kind`, `direction`, `amount: Decimal (>0)`, `transaction_id: UUID | None`, `installment_number/installment_count: int | None`, `consumption_month: date | None` (só `PURCHASE` de compra parcelada), `source_invoice_id: UUID | None` (`CARRYOVER`, `INVOICE_INSTALLMENT`), `payment_group_id: UUID | None`, `cancelled_by_id: UUID | None` (FK `transactions`: o estorno que cancelou a parcela), `status: ItemStatus = ACTIVE`. Índices `(invoice_id, status)`, `(transaction_id)`, `(payment_group_id)`.
  - `TransactionType` ganha `INVOICE_PAYMENT`, `CHARGE`; `PaymentMethod` ganha `CREDIT`.
  - `Transaction`: `account_id` passa a `UUID | None`; colunas novas `card_id`, `installments`, `remaining_installments`, `invoice_id`, `payment_group_id`; índices `(user_id, card_id, occurred_on)`, `(payment_group_id)`.
  - CHECK `shape_by_type` reescrito pela regra da spec (seção 4): `INCOME`/`TRANSFER` exigem conta e proíbem cartão; `EXPENSE` = conta (meio ≠ `CREDIT`, sem parcelas) **ou** cartão (meio `CREDIT`); `REFUND` = conta XOR cartão; `INVOICE_PAYMENT` = conta + `invoice_id` + `payment_group_id`, sem categoria; `CHARGE` = cartão + categoria, sem conta. Todos os tipos que não são `INVOICE_PAYMENT` têm `invoice_id` nulo; só `EXPENSE` no cartão tem `installments`. CHECKs extras: `installments BETWEEN 2 AND 24`; `remaining_installments BETWEEN 1 AND installments - 1`.
  - `tests/support.py`: `make_card(db, ctx, name="Nubank", credit_limit="11000.00", closing_day=3, due_day=10, opening_date=date(2026, 10, 1)) -> Card` (chama `cards.create_card`, que nasce na Tarefa 3 — até lá, insere pelo ORM).

- [ ] **Step 1: Testes que falham** — `test_card_model.py`, inserindo pelo ORM e esperando `IntegrityError` com o nome do CHECK:
  - `expense on card without account is accepted` (cartão, meio `CREDIT`, `installments=6`).
  - `expense with both account and card is rejected`; `card expense with pix is rejected`; `account expense with credit is rejected`.
  - `invoice payment requires invoice and group`; `charge requires card and category`.
  - `installments out of range is rejected` (1 e 25); `remaining installments must be below installments`.
  - `invoice reference month must be first day`; `two invoices for the same month are rejected`.

Run: `uv run pytest tests/services/test_card_model.py` → FAIL.

- [ ] **Step 2: Implementar modelos e a migração `0002`.** Gere com `uv run alembic revision --autogenerate -m "cards and invoices"`, renomeie para `0002_cards_and_invoices.py` (`revision = "0002"`) e confira à mão como na 0001: os enums são `VARCHAR + CHECK` (`enum_type`), então os CHECKs `ck_transactions_transaction_type` e `ck_transactions_payment_method` precisam ser recriados com os valores novos, e `ck_transactions_shape_by_type` recriado com a regra nova; remova CHECKs de enum duplicados que o autogenerate criar (aconteceu na 0001). `downgrade` desfaz tudo.
- [ ] **Step 3: Verificar** — testes passam; `uv run alembic upgrade head` e `downgrade -1` no banco de testes sem erro; `bash scripts/check.sh` verde (os 239 testes antigos continuam passando com `account_id` anulável).
- [ ] **Step 4: Commit** — `feat(cards): modelo de cartões, faturas e itens`.

---

### Task 3: Cadastro do cartão e início

**Files:**
- Create: `backend/app/services/cards.py`, `backend/app/services/invoices.py` (só `get_or_create_invoice` e `add_item` nesta tarefa)
- Test: `backend/tests/services/test_cards.py`

**Interfaces:**
- Consumes: Tarefa 1 (`invoice_dates`, `invoice_month_for`, `add_months`, `split_installments`), Tarefa 2 (modelos).
- Produces:
  - `invoices.get_or_create_invoice(session, card: Card, reference_month: date) -> Invoice` — cria com datas de `invoice_dates`; usa `INSERT … ON CONFLICT DO NOTHING` + `SELECT` (mesmo padrão de `resolve_merchant`), seguro em concorrência.
  - `invoices.add_item(session, ctx, invoice: Invoice, *, kind, direction, amount, **links) -> InvoiceItem` — grava e audita.
  - `cards.open_invoice_month(card: Card, today: date) -> date` — `invoice_month_for(today, …)`.
  - `@dataclass(frozen=True) OpeningState`: `open_invoice_total: Decimal | None = None`, `closed_invoice_total: Decimal | None = None`, `closed_invoice_due_date: date | None = None`.
  - `cards.create_card(session, ctx, *, name, credit_limit, closing_day, due_day, opening_date, opening: OpeningState | None = None) -> Card` — `OPENING_BALANCE` (débito) na fatura de `invoice_month_for(opening_date)` e, se informada, na fatura anterior (fechada).
  - `cards.update_card(session, ctx, card_id, changes: Mapping[str, Any]) -> Card` — nome, limite, dias. Mudar dia recalcula `closing_date/due_date` das faturas **abertas ou futuras** sem `dates_edited` e move itens `PURCHASE` à vista que passarem a cair em outra fatura; faturas fechadas não mudam.
  - `cards.archive_card(session, ctx, card_id) -> CardArchiveResult` (`card`, `notices`; aviso `archived_with_balance` se há saldo devedor, como em contas), `cards.list_cards(session, ctx, *, include_archived=False) -> list[Card]`, `cards.get_active_card(session, ctx, card_id) -> Card` (erro `card_archived`: "O cartão {nome} está arquivado.").
  - Compra parcelada em andamento: entra pela Tarefa 4 (`NewCardExpense` com `remaining_installments`); esta tarefa só garante a abertura.
  - Erros: nome repetido → `Conflict("name_already_exists", "Já existe um cartão com esse nome.")`; dias fora de 1–31 e limite ≤ 0 → 422 na API (validação de schema na Tarefa 8).

- [ ] **Step 1: Testes que falham** (hoje = 15/10/2026, Nubank fecha 3, vence 10):
  - `create card without opening state creates no invoice`.
  - `opening open invoice total becomes an opening item` — `OpeningState(open_invoice_total=Decimal("1240.00"))` → fatura de novembro/2026 com um item `OPENING_BALANCE` de 1.240,00.
  - `opening closed invoice uses the previous month` — `closed_invoice_total=Decimal("2380.00")` → item na fatura de outubro/2026 (fechou em 3/10).
  - `same name as an account is allowed` (conta "Nubank" + cartão "Nubank").
  - `duplicate card name is rejected`.
  - `changing closing day moves open invoice dates but not closed ones`.
  - `edited invoice dates survive a change of closing day` (`dates_edited=True`).
  - `get_or_create_invoice is idempotent` (duas chamadas, uma fatura).
  - `archive with balance returns a notice`.
  - `other user cannot see the card` (`NotFound`).

Run: `uv run pytest tests/services/test_cards.py` → FAIL.

- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** — `bash scripts/check.sh`.
- [ ] **Step 4: Commit** — `feat(cards): cadastro do cartão e início com faturas em andamento`.

---

### Task 4: Compra no cartão

**Files:**
- Modify: `backend/app/services/transactions.py`, `backend/app/services/invoices.py`, `backend/app/services/ledger.py` (`top_payment_options`)
- Test: `backend/tests/services/test_card_purchases.py`

**Interfaces:**
- Consumes: Tarefa 3 (`get_active_card`, `get_or_create_invoice`, `add_item`).
- Produces:
  - `@dataclass(frozen=True) NewCardExpense`: `amount`, `occurred_on`, `description`, `card_id: UUID`, `installments: int | None = None`, `remaining_installments: int | None = None`, `category_id`, `merchant`, `notes` (mesmos tipos de `NewExpense`). Entra no `NewTransaction` e no `match` de `create_transaction` (idempotência e categoria como `NewExpense`; `payment_method = CREDIT`, `account_id = None`).
  - `invoices.bill_purchase(session, ctx, tx: Transaction, card: Card) -> list[InvoiceItem]`:
    - à vista: 1 item `PURCHASE` na fatura de `invoice_month_for(tx.occurred_on)`, sem `consumption_month`;
    - parcelada: n itens (A10), parcela k na fatura `add_months(primeira, k−1)`, `consumption_month = consumption_month(data, k)`;
    - em andamento (`remaining_installments = r`): só as parcelas `n−r+1 … n`, a primeira delas na fatura **seguinte** à aberta do `opening_date` do cartão.
  - Regras: `occurred_on ≥ card.opening_date`, exceto em andamento (que exige `occurred_on < opening_date`); senão `RuleViolation("purchase_before_card_opening", "A compra é anterior ao início do cartão. Para parcelas que já estavam correndo, informe quantas faltam.")`. Parcelas fora de 2–24 → `installments_out_of_range`.
  - Avisos (`WriteResult.notices`): `credit_limit_exceeded` quando o limite disponível fica negativo — "O limite do cartão {nome} ficou negativo em R$ X." (usa `card_ledger.limit_status` da Tarefa 5; até lá, deixe o teste do aviso marcado para a Tarefa 5).
  - `ledger.PaymentOption` passa a `account_id: UUID | None`, `card_id: UUID | None`, `name: str`, `payment_method: PaymentMethod`; `top_payment_options` inclui compras no cartão (`CREDIT`), cartões arquivados fora.

- [ ] **Step 1: Testes que falham:**
  - `card purchase creates one item in the right invoice` (16/10 → novembro).
  - `installment purchase creates one item per invoice` (1200 em 6x → 200,00 de novembro/2026 a abril/2027; `consumption_month` de outubro/2026 a março/2027).
  - `installment amounts follow A10` (100,00 em 3x → 33,34 / 33,33 / 33,33).
  - `opening with in-progress installments creates only the remaining ones` — cartão iniciado em 01/10 com `open_invoice_total=3000`; compra de 07/2026, 10x de 100,00, `remaining_installments=5` → itens 6 a 10 em dezembro/2026 … abril/2027; nada em novembro.
  - `purchase before card opening is rejected`; `in-progress purchase after opening is rejected`.
  - `archived card rejects purchases` (`card_archived`).
  - `card purchase does not change account balances`.
  - `replayed card purchase does not bill twice` (mesma chave).
  - `top payment options include the card`.

Run: `uv run pytest tests/services/test_card_purchases.py` → FAIL.

- [ ] **Step 2: Implementar.** `bill_purchase` roda dentro de `create_transaction`, depois do `_insert`, na mesma transação de banco; em replay, nada é recriado.
- [ ] **Step 3: Verificar** — `bash scripts/check.sh`.
- [ ] **Step 4: Commit** — `feat(cards): compras à vista e parceladas no cartão`.

---

### Task 5: Saldo da fatura, limite e consumo

**Files:**
- Create: `backend/app/services/card_ledger.py`
- Modify: `backend/app/services/ledger.py` (`month_summary`, docstrings)
- Test: `backend/tests/services/test_card_ledger.py`, `backend/tests/services/test_ledger.py` (casos novos)

**Interfaces:**
- Produces (em `card_ledger`, todas puramente de leitura):
  - `class InvoiceState(StrEnum)`: `FUTURE`, `OPEN`, `CLOSED`, `PAID`.
  - `@dataclass(frozen=True) InvoiceTotals`: `invoice: Invoice`, `debits`, `credits`, `payments`, `moved_out` (itens `CARRYOVER`/`INVOICE_INSTALLMENT` cuja `source_invoice_id` é esta), `credit_from_previous`, `balance` (= débitos − créditos − pagamentos − movido − crédito anterior), `state: InvoiceState`.
  - `invoice_totals(session, card: Card, today: date) -> list[InvoiceTotals]` — em ordem de mês; saldo negativo de uma fatura fechada vira `credit_from_previous` da seguinte e a fatura fica `PAID` (Review Focus 2).
  - Estado: `OPEN` se `today < closing_date` e é a fatura de `open_invoice_month`; `FUTURE` se posterior a ela; `CLOSED` se `closing_date ≤ today` e `balance > 0`; `PAID` se `closing_date ≤ today` e `balance ≤ 0`.
  - `@dataclass(frozen=True) LimitStatus`: `limit`, `used`, `available`. `used = max(0, Σ débitos ativos − Σ créditos ativos − Σ pagamentos confirmados − Σ movido)` sobre todas as faturas do cartão (A14: parcelas futuras ocupam o limite).
  - `limit_status(session, card, today) -> LimitStatus`.
  - `@dataclass(frozen=True) CardSummary`: `card`, `open_invoice: InvoiceTotals | None`, `payable: InvoiceTotals | None` (a mais antiga `CLOSED`), `future: list[InvoiceTotals]`, `limit: LimitStatus`.
  - `card_summary(session, card, today) -> CardSummary`.
  - `@dataclass(frozen=True) InvoiceImpact`: `reference_month`, `before`, `after`. `@dataclass(frozen=True) PurchasePreview`: `invoice: InvoiceImpact`, `following: list[InvoiceImpact]`, `limit_before`, `limit_after`.
  - `preview_purchase(session, card, *, amount: Decimal, installments: int | None, occurred_on: date, today: date) -> PurchasePreview` — não grava nada (calcula as parcelas com `split_installments` e soma aos totais atuais).
- `ledger.month_summary` passa a calcular consumo assim (só confirmados):
  despesas via conta e despesas no cartão **à vista** pela data; itens `PURCHASE` ativos de compras parceladas pelo `consumption_month`; `CHARGE` pela data; menos estornos via conta pela data; menos estornos no cartão pela data **descontado o valor das parcelas que cada estorno cancelou** (`cancelled_by_id`). Itens `OPENING_BALANCE`, `CARRYOVER`, `INVOICE_INSTALLMENT` e `INVOICE_PAYMENT` nunca entram.
- `ledger.account_balances`: `INVOICE_PAYMENT` é saída da conta (já acontece pelo `else` do `case`; o teste fixa). Lançamentos sem conta são ignorados.

- [ ] **Step 1: Testes que falham:**
  - `open invoice total sums its purchases`; `future invoices list installments`.
  - `limit counts all future installments` (limite 11.000; 1200 em 6x → usado 1.200).
  - `paid invoice releases limit` (depois da Tarefa 7 também; aqui, com `INVOICE_PAYMENT` inserido pelo ORM).
  - `invoice states by date` (aberta, futura, fechada, paga).
  - `credit balance carries into next invoice` — fatura de outubro fechada com 100 de débito e 150 de crédito → outubro `PAID`, novembro com `credit_from_previous = 50`.
  - `preview shows before and after for each affected invoice` (1200 em 6x sobre faturas com 1.240 e 3.000 → novembro 1.240→1.440, dezembro 3.000→3.200; limite antes/depois).
  - Em `test_ledger.py`: `card purchase counts as consumption on purchase date`; `installment counts one installment per month` (outubro 200, novembro 200 …); `charge counts as financial charges`; `golden rule: card purchase plus invoice payment counts once` (compra 300 no cartão em outubro + pagamento 300 da Itaú em novembro → consumo de outubro 300, de novembro 0; saldo da Itaú −300 em novembro); `opening balance is not consumption`.

Run: `uv run pytest tests/services/test_card_ledger.py tests/services/test_ledger.py` → FAIL.

- [ ] **Step 2: Implementar.** Ative o aviso `credit_limit_exceeded` da Tarefa 4 e o teste dele.
- [ ] **Step 3: Verificar** — `bash scripts/check.sh`.
- [ ] **Step 4: Commit** — `feat(cards): saldo da fatura, limite, prévia e consumo com cartão`.

---

### Task 6: Estorno, anulação e edição no cartão

**Files:**
- Modify: `backend/app/services/transactions.py`, `backend/app/services/invoices.py`
- Test: `backend/tests/services/test_card_changes.py`

**Interfaces:**
- Consumes: Tarefas 4 e 5.
- Produces:
  - `create_refund` aceita despesa no cartão: `REFUND` com `card_id` da original e `account_id = None` (o `account_id` de `NewRefund` é recusado para despesa no cartão: `refund_account_not_allowed`). Efeito via `invoices.apply_card_refund(session, ctx, refund, original) -> None`: cancela parcelas inteiras ainda em faturas **não fechadas**, da última para a primeira, enquanto o valor da parcela couber no que falta (marca `cancelled_by_id`); o resto vira um item `REFUND_CREDIT` na fatura aberta **hoje**.
  - `void_transaction`:
    - compra no cartão: se alguma parcela ativa está em fatura fechada → `RuleViolation("void_blocked_by_closed_invoice", "Esta compra já está em fatura fechada. Registre um estorno.")`; senão cancela todos os itens;
    - estorno no cartão: bloqueado se o `REFUND_CREDIT` está em fatura fechada; senão cancela o crédito e reativa as parcelas que ele cancelou;
    - `CHARGE`: mesma regra da compra à vista;
    - `INVOICE_PAYMENT`: recusado — `RuleViolation("void_payment_group", "Pagamentos de fatura são anulados pela operação inteira.")` (anulação pela Tarefa 7).
  - `update_transaction` (`_EDITABLE` por tipo + forma):
    - compra no cartão: `description`, `notes`, `merchant`, `category_id` sempre; `amount`, `occurred_on`, `installments`, `card_id` só sem parcela em fatura fechada (itens cancelados e recriados por `bill_purchase` na mesma transação); senão `void_blocked_by_closed_invoice` com a mesma mensagem; `account_id`/`payment_method` recusados (`field_not_editable`: trocar conta ↔ cartão é anular e registrar de novo);
    - `CHARGE`: `amount`, `occurred_on`, `description`, `notes` com a mesma regra;
    - `INVOICE_PAYMENT`: nenhum campo editável.

- [ ] **Step 1: Testes que falham:**
  - `refund of cash purchase credits the open invoice` (compra em outubro, estorno hoje → crédito em novembro).
  - `refund of installment cancels whole installments from the last` (500 numa 6x de 200 → canceladas a 6ª e a 5ª, crédito de 100).
  - `small refund of installment becomes credit only` (150 → nenhuma cancelada, crédito 150).
  - `refund never touches closed invoices`.
  - `refund consumption excludes cancelled installments` (estorno 500: consumo do mês do estorno −100; parcelas canceladas somem dos seus meses).
  - `void card purchase cancels its items`; `void blocked when an installment is in a closed invoice`.
  - `void card refund restores installments`.
  - `edit amount of open card purchase rebuilds installments`; `edit amount blocked by closed invoice`; `switching account and card is not an edit`; `invoice payment is not editable`.

Run: `uv run pytest tests/services/test_card_changes.py` → FAIL.

- [ ] **Step 2: Implementar.** `transactions.py` já tem 552 linhas: as regras de itens ficam em `invoices.py`; `transactions.py` só decide e delega.
- [ ] **Step 3: Verificar** — `bash scripts/check.sh`.
- [ ] **Step 4: Commit** — `feat(cards): estorno, anulação e edição de lançamentos no cartão`.

---

### Task 7: Pagamento, encargo e conferência

**Files:**
- Modify: `backend/app/services/invoices.py`
- Test: `backend/tests/services/test_invoice_payments.py`

**Interfaces:**
- Consumes: Tarefas 3–6.
- Produces:
  - `@dataclass(frozen=True) PaymentSource`: `account_id: UUID`, `amount: Decimal`.
  - `@dataclass(frozen=True) InstallmentPlan`: `count: int`, `installment_amount: Decimal`.
  - `Remainder = Literal["NONE", "CARRY_OVER"] | InstallmentPlan`.
  - `@dataclass(frozen=True) NewInvoicePayment`: `occurred_on: date`, `sources: tuple[PaymentSource, ...]` (1 a 5), `remainder: Remainder = "NONE"`.
  - `@dataclass(frozen=True) PaymentResult`: `group_id: UUID`, `payments: list[Transaction]`, `charge: Transaction | None`, `replayed: bool`, `notices: list[Notice]`.
  - `pay_invoice(session, ctx, invoice_id, data: NewInvoicePayment, *, idempotency_key: str | None) -> PaymentResult`:
    - trava a fatura (`for_update`); cada origem vira um `INVOICE_PAYMENT` (conta ativa, data ≥ abertura da conta, `payment_group_id` comum); a chave e o hash do conteúdo inteiro ficam **no primeiro** pagamento do grupo; replay devolve o grupo existente (Review Focus 3);
    - soma das origens > saldo devedor → `invoice_payment_exceeds_balance` ("O pagamento passa do saldo da fatura (R$ X).");
    - `CARRY_OVER`: item `CARRYOVER` com o restante na fatura seguinte (`source_invoice_id`, `payment_group_id`);
    - `InstallmentPlan`: `count × installment_amount ≥ restante`, senão `invoice_installments_below_remainder`; N itens `INVOICE_INSTALLMENT` nas faturas seguintes; se houver diferença, um `CHARGE` (Encargos financeiros, data do pagamento, descrição "Juros do parcelamento da fatura de {mês}") com `payment_group_id`, **sem item próprio**;
    - aviso de saldo negativo nas contas de origem (como hoje).
  - `void_payment_group(session, ctx, group_id) -> list[Transaction]` — anula pagamentos e o `CHARGE` do grupo e cancela os itens criados; recusado (`void_blocked_by_closed_invoice`) se algum item criado está em fatura fechada.
  - `add_charge(session, ctx, card_id, *, amount, occurred_on, description, idempotency_key) -> WriteResult` — `CHARGE` + item `CHARGE` na fatura da data.
  - `update_invoice(session, ctx, invoice_id, changes) -> Invoice` — `reported_total` (pode voltar a nulo), `closing_date`, `due_date` (marca `dates_edited`; fechamento < vencimento).

- [ ] **Step 1: Testes que falham:**
  - `full payment from one account marks invoice paid`.
  - `payment split between two accounts` (2.000 Itaú + 200 poupança; saldos de cada conta).
  - `payment replay returns the same group` (mesma chave, mesmo corpo → mesmos ids; corpo diferente → `idempotency_key_reused`).
  - `payment above balance is rejected`.
  - `partial payment keeps invoice closed with balance`.
  - `carry over moves remainder to next invoice` (fatura atual `PAID`, próxima com item de 180).
  - `invoice installments create items and a charge` (restante 180, 3x de 65 → 3 itens de 65, `CHARGE` de 15 em Encargos financeiros, consumo 15).
  - `installments below remainder are rejected`.
  - `void payment group restores the invoice`; `void blocked when created items are in a closed invoice`.
  - `charge adds a debit to the invoice of its date`.
  - `reported total and difference` (via `card_ledger.invoice_totals`: 2.380 informado, 2.300 calculado).
  - `edited dates are kept`.

Run: `uv run pytest tests/services/test_invoice_payments.py` → FAIL.

- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** — `bash scripts/check.sh` (inclua um caso em `tests/services/test_concurrency.py`: dois pagamentos simultâneos com a mesma chave geram um único grupo).
- [ ] **Step 4: Commit** — `feat(cards): pagamento de fatura, encargos e conferência com o banco`.

---

### Task 8: API

**Files:**
- Create: `backend/app/api/schemas/cards.py`, `backend/app/api/schemas/invoices.py`, `backend/app/api/routes/cards.py`, `backend/app/api/routes/invoices.py`
- Modify: `backend/app/api/routes/__init__.py`, `backend/app/api/schemas/transactions.py`, `backend/app/api/routes/transactions.py`, `backend/app/api/schemas/entry.py`, `backend/app/api/routes/entry.py`
- Test: `backend/tests/api/test_cards_api.py`, `backend/tests/api/test_invoices_api.py`

**Interfaces:**
- Consumes: Tarefas 3–7.
- Produces (contrato da spec, seção 6; dinheiro como string, datas ISO):
  - `CardIn { name (1–60), credit_limit: PositiveMoney, closing_day: 1–31, due_day: 1–31, opening_date: ApiDate, open_invoice_total?: PositiveMoney, closed_invoice?: { total: PositiveMoney, due_date: ApiDate } }`, `CardPatch { name?, credit_limit?, closing_day?, due_day? }`, `CardOut { id, name, credit_limit, closing_day, due_day, opening_date, archived_at }`.
  - `GET/POST /cards`, `PATCH /cards/{id}`, `POST /cards/{id}/archive` (`{ card, warnings }`).
  - `GET /cards/summary` → `[CardSummaryOut { card, open_invoice: InvoiceSummaryOut | null, payable: InvoiceSummaryOut | null, future: InvoiceSummaryOut[], limit: { limit, used, available } }]`; `InvoiceSummaryOut { id, reference_month, closing_date, due_date, state, total (= débitos − créditos), balance, reported_total, difference (reported_total − total, null sem informado) }`.
  - `GET /cards/{id}/invoices?before=<reference_month>&limit=12` → `{ open, future, previous: InvoiceSummaryOut[], next_before }`.
  - `GET /invoices/{id}` → `InvoiceDetailOut { invoice: InvoiceSummaryOut, items: [{ id, kind, direction, amount, description, occurred_on, installment_number, installment_count, transaction_id, status }], payments: TransactionOut[] }` (itens ativos; descrição do item = descrição do lançamento ou texto fixo: "Saldo inicial", "Saldo da fatura de {mês}", "Parcelamento da fatura de {mês} ({k}/{n})").
  - `PATCH /invoices/{id}` (`reported_total`, `closing_date`, `due_date`).
  - `POST /invoices/{id}/payments` (Idempotency-Key) com `{ occurred_on, sources: [{account_id, amount}] (1–5), remainder: "NONE" | "CARRY_OVER" | { installments: 2–24, installment_amount } }` → 201 `{ group_id, payments, charge, warnings }` (200 em replay).
  - `POST /payment-groups/{id}/void` → `{ group_id, payments }`.
  - `POST /cards/{id}/charges` (Idempotency-Key) `{ amount, occurred_on, description }` → `TransactionWriteOut`.
  - `POST /cards/{id}/preview` `{ amount, installments?, occurred_on }` → `{ invoice: {reference_month, before, after}, following: [...], limit_before, limit_after }`.
  - `ExpenseIn` passa a ter `account_id?` + `payment_method?` **ou** `card_id` + `installments?` + `remaining_installments?` (validação de modelo: um dos dois, com mensagem em português); `TransactionOut` ganha `card_id`, `installments`, `remaining_installments`, `invoice_id`, `payment_group_id`, e `account_id` passa a anulável; `TransactionPatch` ganha `installments`, `card_id`; `GET /transactions` ganha filtro `card_id`.
  - `EntryHintsOut` ganha `cards: [{ id, name }]`; `PaymentOptionOut` vira `{ account_id, card_id, name, payment_method }`.

- [ ] **Step 1: Testes que falham** (fluxos pela API, com `auth_client`):
  - `create card with opening state and read summary` (fatura aberta 1.240, limite).
  - `card purchase via transactions endpoint` (1200 em 6x → summary com futuras).
  - `expense needs account or card` (422 com campo e mensagem em português); `expense with both account and card is rejected`.
  - `preview does not write`.
  - `pay invoice with two sources and carry over`; `payment replay returns 200`.
  - `invoice detail lists items with installment labels`.
  - `void payment group`; `void purchase in closed invoice returns 422 with code void_blocked_by_closed_invoice`.
  - `entry hints include cards and card payment options`.
  - `other user cannot read card or invoice` (404).
  - `card routes require csrf headers` (sem `X-Requested-With` → 403, como as demais).

Run: `uv run pytest tests/api/test_cards_api.py tests/api/test_invoices_api.py` → FAIL.

- [ ] **Step 2: Implementar.** Rotas finas, como as existentes: chamam o service, `db.commit()`, convertem com `model_validate`.
- [ ] **Step 3: Verificar** — `bash scripts/check.sh`; `cd frontend && npm run api:types` gera os tipos sem erro (o frontend ainda não compila contra eles; isso é a Tarefa 9).
- [ ] **Step 4: Commit** — `feat(api): cartões, faturas, pagamento, encargo e prévia`.

---

### Task 9: Tipos e acesso à API no frontend

**Files:**
- Modify: `frontend/src/api/schema.d.ts` (gerado), `frontend/src/api/types.ts`, `frontend/src/api/endpoints.ts`, `frontend/src/api/queries.ts`, `frontend/src/test/fixtures.ts`, e o uso de `PaymentOptionOut` em `frontend/src/features/entry/ItemEditor.tsx` (só o necessário para compilar: `account_name` → `name`, `account_id` anulável)
- Test: `frontend/src/api/endpoints.test.ts` (novo)

**Interfaces:**
- Produces:
  - Tipos: `CardOut`, `CardIn`, `CardPatch`, `CardSummaryOut`, `InvoiceSummaryOut`, `InvoiceDetailOut`, `InvoicePaymentIn`, `InvoicePaymentOut`, `PurchasePreviewOut`, `InvoiceState`.
  - `api.cards()`, `api.cardsSummary()`, `api.createCard(body)`, `api.updateCard(id, patch)`, `api.archiveCard(id)`, `api.cardInvoices(id, before?)`, `api.invoice(id)`, `api.updateInvoice(id, patch)`, `api.payInvoice(id, body, key)`, `api.voidPaymentGroup(id)`, `api.addCharge(cardId, body, key)`, `api.previewPurchase(cardId, body)`.
  - `queryKeys.cards`, `queryKeys.cardsSummary`, `queryKeys.cardInvoices(id)`, `queryKeys.invoice(id)`, `queryKeys.preview(cardId, amount, installments, date)`.
  - Hooks: `useCards()`, `useCardsSummary()`, `useCardInvoices(cardId)`, `useInvoice(invoiceId)`, `usePurchasePreview(input | null)` (desligado com `null`; `placeholderData: keepPreviousData` para não piscar).
  - `useInvalidateLedger` passa a invalidar também `cards`, `cardsSummary`, faturas e prévias.
  - Fixtures: `CARDS.nubank` (`card-nubank`, "Nubank", limite `11000.00`, fecha 3, vence 10), `CARDS_SUMMARY`, `PREVIEW`, `HINTS` com `cards` e o atalho `{ card_id: 'card-nubank', name: 'Nubank', payment_method: 'CREDIT' }` em primeiro.

- [ ] **Step 1: Testes que falham** — `payInvoice sends the idempotency key and remainder`, `previewPurchase posts installments only when set`.
- [ ] **Step 2: Implementar** (`npm run api:types` primeiro).
- [ ] **Step 3: Verificar** — `npm run check` (os 195 testes existentes continuam passando).
- [ ] **Step 4: Commit** — `feat(frontend): tipos e acesso à API de cartões e faturas`.

---

### Task 10: Interpretador com cartão

**Files:**
- Modify: `frontend/src/domain/parser.ts`
- Test: `frontend/src/domain/parser.test.ts`

**Interfaces:**
- Produces:
  - `PaymentMethod` ganha `'CREDIT'`. `ParseContext` ganha `cards: EntryCard[]` (`{ id, name }`). `ParsedItem` ganha `cardId: string | null` e `installments: number | null`.
  - Regras:
    - "credito"/"cartao" (normalizados) → meio `CREDIT`;
    - nome de cartão casa como nome de conta (sem acento, sem maiúscula, nomes de várias palavras primeiro);
    - nome só de cartão → `cardId`, meio `CREDIT`;
    - nome de conta **e** cartão: com `CREDIT` → cartão; com `PIX`/`DEBIT`/`CASH`/`BOLETO` → conta; sem meio → `accountId = cardId = null` e `pending` com `paymentMethod`;
    - "6x", "em 6x", "6 vezes" → `installments = 6` e meio `CREDIT`; fora de 2–24 → não reconhecido (fica na descrição);
    - `CREDIT` sem cartão nomeado: se há um único cartão, ele; senão `pending` com `paymentMethod`;
    - receita (`recebi …`) nunca vira cartão.

- [ ] **Step 1: Testes que falham** (contexto com conta "Nubank", conta "Itaú" e cartão "Nubank"):
  - `credit word picks the card`: `"38 ifood crédito nubank"` → `cardId: 'card-nubank'`, `accountId: null`, meio `CREDIT`.
  - `pix keeps the account`: `"38 ifood pix nubank"` → conta Nubank, `PIX`.
  - `name shared by account and card stays pending`: `"38 ifood nubank"` → ambos nulos, `pending` contém `paymentMethod`.
  - `installments imply the card`: `"1200 celular nubank 6x"`, `"1200 celular em 6x nubank"`, `"1200 celular nubank 6 vezes"` → `installments: 6`, cartão, descrição `"celular"`.
  - `25x is not installments` → descrição contém `"25x"`.
  - `credit without card name uses the only card`; `credit with two cards stays pending`.
  - `card name only matches card` (cartão "Inter" sem conta Inter → cartão).

Run: `npx vitest run src/domain/parser.test.ts` → FAIL.

- [ ] **Step 2: Implementar.** Os testes existentes do interpretador não mudam (contexto antigo ganha `cards: []`).
- [ ] **Step 3: Verificar** — `npm run check`.
- [ ] **Step 4: Commit** — `feat(frontend): interpretador reconhece cartão, crédito e parcelas`.

---

### Task 11: Comprovante com cartão e prévia

**Files:**
- Modify: `frontend/src/features/entry/cardState.ts`, `ItemEditor.tsx`, `ConfirmationCard.tsx`, `describe.ts`
- Create: `frontend/src/features/entry/CardImpact.tsx`
- Test: `frontend/src/features/entry/ConfirmationCard.test.tsx`, `cardState.test.ts`, `describe.test.ts`

**Interfaces:**
- Consumes: Tarefas 9 e 10.
- Produces:
  - `CardItem` ganha `cardId: string | null`, `installments: number | null`; `EditableFields` idem. `missingFields`: pagamento completo = (conta + meio que não é `CREDIT`) ou cartão. `toRequestBody`: com cartão → `{ type: 'EXPENSE', …, card_id, installments? }`, sem `account_id`/`payment_method`.
  - "Como você pagou?": atalhos de `top_payment_options` (cartão aparece como "Crédito Nubank"); seletor "Conta ou cartão" com grupos `<optgroup label="Contas">` e `<optgroup label="Cartões">`; com cartão, o campo "Meio" some e aparece "Parcelas" (`<select>` com "À vista" e 2x a 24x).
  - `CardImpact({ cardId, amount, installments, occurredOn })`, abaixo da divisória do pagamento quando há cartão e valor válido:
    - "Fatura de {mês}: R$ antes → R$ depois";
    - "Limite disponível: R$ antes → R$ depois";
    - "Limite não é dinheiro.";
    - limite depois < 0: aviso em `--color-stamp` "Esta compra passa do limite em R$ X.";
    - parcelada: `<details>` "Ver como ficam as próximas faturas", com a lista mês a mês;
    - números só de `usePurchasePreview`; enquanto carrega, "Calculando…"; se a prévia falha, nada de números inventados ("Não foi possível calcular o impacto na fatura.").
  - `describeSaved` para despesa no cartão: `"Despesa registrada: R$ 38,00 em Alimentação, no crédito Nubank."` e parcelada `"Despesa registrada: R$ 1.200,00 em Compras diversas, no crédito Nubank em 6x de R$ 200,00."`. A frase ganha `" Fatura de novembro: R$ 1.278,00."` com o `invoice.after` da **última prévia mostrada** para aquele item (é exatamente o total depois da compra); sem prévia, a frase termina sem essa parte.

- [ ] **Step 1: Testes que falham:**
  - `card item posts card_id and installments without account`.
  - `shows invoice and limit impact from the preview` (fixture `PREVIEW`: "R$ 1.240,00 → R$ 1.440,00", "R$ 1.560,00 → R$ 360,00", "Limite não é dinheiro.").
  - `installment impact opens next invoices on demand` (fechado por padrão; ao abrir, "dezembro").
  - `over limit shows warning without blocking` (Confirmar continua habilitado).
  - `preview failure shows no numbers`.
  - `choosing the card shortcut fills card and hides method`.
  - `describe card purchase` e `describe installment purchase`.
  - `confirmation card with card has no accessibility violations`.

Run: `npx vitest run src/features/entry` → FAIL.

- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** — `npm run check`; no navegador (tamanho de celular), "1200 celular crédito nubank 6x" com o backend local.
- [ ] **Step 4: Commit** — `feat(frontend): comprovante mostra impacto na fatura e no limite`.

---

### Task 12: Contas e cartões; novo cartão

**Files:**
- Create: `frontend/src/features/cards/CardsSection.tsx`, `frontend/src/features/cards/NewCardForm.tsx`
- Modify: `frontend/src/features/accounts/AccountsPage.tsx` (título "Contas e cartões", inclui `CardsSection`), `frontend/src/features/shell/AppShell.tsx` (rótulo da navegação continua "Contas")
- Test: `frontend/src/features/cards/NewCardForm.test.tsx`, `frontend/src/features/accounts/AccountsPage.test.tsx`

**Interfaces:**
- Produces:
  - `CardsSection`: `<section>` "Cartões" com uma linha por cartão (nome, "Fatura aberta R$ X", "Limite disponível R$ Y"), link para `/cartoes/:id`, e o formulário "Novo cartão" recolhido atrás do botão "Adicionar cartão".
  - `NewCardForm` em dois passos no mesmo formulário:
    - **Cartão**: Nome, Limite (`MoneyInput`), "Fecha no dia", "Vence no dia" (`<select>` 1–31), "Começa a acompanhar em" (padrão: dia 1 do mês de `hints.today`);
    - **Como está hoje** (`<fieldset>`, opcional, "Pular por enquanto"): "Total da fatura aberta agora", "Tem fatura fechada sem pagar?" (total e vencimento), "Parceladas em andamento" (linhas com descrição, valor total, parcelas, data da compra, "Quantas faltam depois da fatura atual"; "Adicionar outra parcelada");
    - ao salvar: `api.createCard` e, para cada parcelada, `api.createTransaction` com `remaining_installments` (cada uma com sua chave, mesma regra de `useIdempotencyKey`);
    - se uma parcelada falhar, o cartão já criado não é refeito: a mensagem diz qual linha falhou, e "Tentar de novo" reenvia só ela.

- [ ] **Step 1: Testes que falham:**
  - `creates card with opening totals` (corpo com `open_invoice_total` e `closed_invoice`).
  - `in-progress installments are sent after the card` (`remaining_installments: 5`, `card_id` do cartão criado).
  - `failed installment line can be retried alone`.
  - `skipping the opening step creates only the card`.
  - `accounts page lists cards with open invoice and available limit`.
  - axe sem violações.

Run: `npx vitest run src/features/cards src/features/accounts` → FAIL.

- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** — `npm run check`.
- [ ] **Step 4: Commit** — `feat(frontend): contas e cartões, com novo cartão e início`.

---

### Task 13: Tela do cartão

**Files:**
- Create: `frontend/src/features/cards/CardPage.tsx`, `frontend/src/features/cards/InvoiceDetails.tsx`, `frontend/src/features/cards/ChargeForm.tsx`
- Modify: `frontend/src/routes.tsx` (`cartoes/:id`)
- Test: `frontend/src/features/cards/CardPage.test.tsx`

**Interfaces:**
- Consumes: Tarefa 9.
- Produces — `CardPage` (`/cartoes/:id`, título = nome do cartão), na ordem da spec (seção 7):
  - **Topo**: "Fatura de {mês}, aberta", total em destaque, "Fecha em {d/m}, vence em {d/m}"; barra de limite (`<meter>` com rótulo) e "Limite usado R$ X", "disponível R$ Y"; botão "Pagar fatura de {mês}" quando `payable` existe (abre o formulário da Tarefa 14 na própria página).
  - **Fatura fechada a pagar** (quando existe): "Calculado aqui", campo "Total no Nubank" (`MoneyInput`, salva com `api.updateInvoice` ao sair do campo), diferença com a frase da spec ("Faltam R$ 80,00: alguma compra pode não ter sido registrada." / "Sobram R$ 80,00: confira se alguma compra foi registrada em dobro."), atalhos "Registrar compra" (`/lancamentos/novo?card={id}&date={fechamento − 1 dia}`) e "Registrar encargo" (`ChargeForm`).
  - **Seções recolhíveis** (`<details>`): "Faturas futuras" (mês e total), "Compras desta fatura" (`InvoiceDetails` da aberta: livro-caixa com "1 de 6"), "Faturas anteriores" (lista; cada uma abre `InvoiceDetails` com itens e pagamentos, e "Anular pagamento" por grupo).
  - Datas da fatura editáveis em `InvoiceDetails` ("Editar datas": fechamento e vencimento).
  - Rodapé da página: "Editar cartão" (nome, limite, dias, inline como em Contas) e "Arquivar cartão" (confirmação; aviso do servidor se houver saldo; volta para `/contas`).

- [ ] **Step 1: Testes que falham:**
  - `shows open invoice, dates and limit`.
  - `future invoices are collapsed by default`.
  - `reported total shows the missing difference` (2.300 calculado, 2.380 informado → "Faltam R$ 80,00…").
  - `register purchase shortcut opens the form with card and date`.
  - `charge form posts with idempotency key`.
  - `void payment group asks for confirmation`.
  - `edit and archive card` (PATCH com os campos alterados; arquivar pede confirmação e mostra o aviso).
  - axe sem violações.

Run: `npx vitest run src/features/cards/CardPage.test.tsx` → FAIL.

- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** — `npm run check`; captura no navegador em celular e desktop contra a direção visual.
- [ ] **Step 4: Commit** — `feat(frontend): tela do cartão com fatura, limite e conferência`.

---

### Task 14: Pagar fatura

**Files:**
- Create: `frontend/src/features/cards/InvoicePaymentForm.tsx`
- Modify: `frontend/src/features/cards/CardPage.tsx`
- Test: `frontend/src/features/cards/InvoicePaymentForm.test.tsx`

**Interfaces:**
- Produces — `InvoicePaymentForm({ invoice: InvoiceSummaryOut, cardName, onDone })`:
  - "Pagar fatura de {mês}", "Total" = saldo devedor;
  - "De onde sai o dinheiro": primeira linha com a conta mais usada e o total preenchido; "Adicionar outra conta" (até 5); "Data" (padrão hoje);
  - "Pagando" e "Faltam" vêm de somar strings canônicas com `addMoney` — **criar** `addMoney(a: string, b: string): string` e `subtractMoney` em `src/domain/money.ts`, com teste, sem `number`;
  - Faltando > 0: "O que fazer com os R$ X?" (`<fieldset>` de rádios): "Só pagar esta parte agora", "Deixar para a próxima fatura", "Parcelar com o {cartão}"; parcelar mostra "Parcelas" e "Valor de cada parcela" e, quando preenchidos, "Juros que serão registrados: R$ Y" (da diferença; texto informativo, o backend recalcula e é a fonte);
  - "Registrar pagamento"; chave pela regra de `useIdempotencyKey`; erros do servidor no alerta e nos campos; ao concluir, mensagem de status "Pagamento registrado." e foco na mensagem.

- [ ] **Step 1: Testes que falham:**
  - `addMoney and subtractMoney work on canonical strings` (em `money.test.ts`).
  - `pays full invoice from one account`.
  - `split between two accounts shows what is missing`.
  - `carry over sends CARRY_OVER`.
  - `installments send count and amount and show interest`.
  - `payment above balance shows the server message`.
  - `retry reuses the key`.
  - axe sem violações.

Run: `npx vitest run src/features/cards/InvoicePaymentForm.test.tsx src/domain/money.test.ts` → FAIL.

- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** — `npm run check`.
- [ ] **Step 4: Commit** — `feat(frontend): pagamento de fatura com divisão e restante`.

---

### Task 15: Tela inicial, formulário completo e lançamentos com cartão

**Files:**
- Modify: `frontend/src/features/home/BalanceHeader.tsx`, `frontend/src/features/home/Timeline.tsx` (`ledgerDetail`), `frontend/src/features/form/TransactionForm.tsx`, `frontend/src/features/transactions/TransactionsPage.tsx`
- Test: `frontend/src/features/home/HomePage.test.tsx`, `frontend/src/features/form/TransactionForm.test.tsx`, `frontend/src/features/transactions/TransactionsPage.test.tsx`

**Interfaces:**
- Produces:
  - **Tela inicial**: `BalanceHeader` mostra, abaixo do saldo e separado dele, uma linha por cartão ativo: "Fatura aberta {cartão} R$ X", link para `/cartoes/:id` (de `useCardsSummary`).
  - **Livro-caixa**: `ledgerDetail` mostra "{categoria}, crédito {cartão}" e, em parcelada, "{categoria}, crédito {cartão} em 6x"; `INVOICE_PAYMENT` como "Pagamento da fatura de {mês} ({cartão})" com valor de saída; `CHARGE` como "Encargos financeiros, {cartão}".
  - **Formulário completo**: em despesa, "Conta ou cartão" com grupos; com cartão: "Parcelas" e o mesmo `CardImpact`; aceita `?card=` e `?date=` na URL (atalho da Tarefa 13). Edição respeita as regras da spec: com cartão, o seletor de conta não aparece; erros `void_blocked_by_closed_invoice` aparecem no alerta.
  - **Lançamentos**: filtro "Cartão"; "Estornar" funciona para compra no cartão sem o campo "Devolvido em" (o crédito vai para a fatura); "Anular" mostra a mensagem do servidor quando bloqueado.

- [ ] **Step 1: Testes que falham:**
  - `home shows open invoice line per card`.
  - `full form sends a card purchase with installments`; `full form reads card and date from the URL`.
  - `transactions filter by card`; `card refund has no account field`.
  - `ledger detail describes card purchases and invoice payments`.

Run: `npx vitest run src/features/home src/features/form src/features/transactions` → FAIL.

- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** — `npm run check`.
- [ ] **Step 4: Commit** — `feat(frontend): cartão na tela inicial, no formulário e em lançamentos`.

---

### Task 16: Smoke, README e verificação manual

**Files:**
- Modify: `frontend/e2e/smoke.spec.ts`, `README.md`

- [ ] **Step 1: Smoke** — novo teste `card: opening, installment purchase and payment`:
  1. cria a conta Itaú (R$ 5.000,00);
  2. cria o cartão Nubank (limite 11.000, fecha 3, vence 10) com fatura aberta de R$ 1.240,00 e uma parcelada em andamento (faltam 2);
  3. registra "1200 celular crédito nubank 6x" e vê o impacto no comprovante;
  4. confirma; na tela do cartão, vê a fatura aberta e, em "Faturas futuras", os meses com parcelas;
  5. paga a fatura aberta inteira pela Itaú e vê "Pagamento registrado.".

Run: `bash scripts/e2e.sh` → 2 testes passando.

- [ ] **Step 2: README** — seção "Cartões e faturas": como cadastrar o cartão e o início (fatura aberta pelo total, parceladas em andamento compra por compra), como a frase reconhece cartão ("crédito", "6x"), conferência e pagamento.
- [ ] **Step 3: Verificação manual** contra a imagem de produção (`scripts/e2e.sh` deixa o banco `finance_e2e`), em celular e desktop:
  - início do cartão;
  - "38 ifood nubank" pergunta como pagou;
  - parcelada com prévia;
  - estorno de parcelada;
  - fatura fechada com total do banco diferente;
  - pagamento dividido entre duas contas, com restante levado adiante e com parcelamento;
  - anulação de pagamento;
  - teclado e leitor de tela nas telas novas;
  - nenhum erro no console.
- [ ] **Step 4: Commit** — `docs: cartões e faturas no README`.
