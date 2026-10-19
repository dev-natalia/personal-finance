# Ajustes de uso — rodada 1: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar as telas a partir do uso real. A tela inicial fica limpa e Cartões ganha aba própria. Contas passa a adicionar por uma janela. Lançamentos e Análise ganham filtros num bloco, com "Conta ou cartão" único e listas no lugar de botões. "Essencial" ganha explicação.

**Architecture:** Só frontend: React 19, react-router 8 e TanStack Query, sem mudança de API. Componentes novos pequenos:
- `Sheet`, a janela que sobe de baixo;
- `NavIcon`, ícones SVG;
- `SourceSelect`, o filtro "Conta ou cartão" compartilhado;
- `CardsPage`, `NewCardPage` e `SessionEntries`.

A tela de Contas perde a seção de cartões, que vira a aba Cartões.

**Tech Stack:** React + TypeScript + Tailwind 4, Vitest + Testing Library + MSW + axe e Playwright (`scripts/e2e.sh`).

**Spec:** `docs/superpowers/specs/2026-10-19-ajustes-de-uso-1-design.md`

## Global Constraints

- **Escopo:** só frontend. Nenhuma mudança de backend, API, regra de negócio ou dados.
- **Dependências:** nenhuma nova. Os ícones são SVG no próprio projeto, decorativos (`aria-hidden`).
- **Visual:** os tokens de `frontend/src/index.css` (paper, slip, ink, ink-soft, pen, stamp, rule) e as classes de `src/ui/styles.ts`. A direção "comprovante" e a fonte Recursive continuam.
- **Barra de baixo no celular:** seis itens, nesta ordem: Início, Lançam., Análise, Contas, Cartões, Mais.
  - Cada item tem ícone em cima e nome pequeno embaixo.
  - Todos cabem de 320 px de largura em diante, também com a letra a 130%.
  - "Lançamentos" é abreviado só na barra; o nome acessível do link continua "Lançamentos".
- **Barra lateral (md+):** os nomes completos.
- **Textos:** o que o documento fixa, em português, entre aspas:
  - "Formulário completo";
  - "+ Adicionar conta", "+ Adicionar cartão";
  - "Conta ou cartão";
  - "Período" com "Semana", "Mês" e "Ano";
  - "Compras parceladas" com "Uma parcela por mês" e "Valor total no dia da compra";
  - "O que você comprou?".
- **Acessibilidade:** axe sem violações em toda tela nova ou alterada. Foco visível. Janelas com foco preso, Esc fecha, o foco volta ao botão que abriu.
- **Check:** `npm run check` (dentro de `frontend/`) e `bash scripts/e2e.sh` verdes ao fim de cada tarefa que toca fluxos do e2e.
- **Não usar `npx prettier`.**

## Review Focus

1. **Barra com a letra aumentada:** em 320 px com a letra a 130%, "Mais" continua inteiro na tela. Verificado no navegador na Tarefa 1, com a medida da borda do último item, como no PR #6.
2. **Links antigos de Lançamentos:** `/lancamentos?account_id=…` ou `?card_id=…`, de favoritos ou do atalho da tela do cartão, continuam filtrando. Teste: Tarefa 4 (`old account_id and card_id links still filter`).
3. **Janela aberta e teclado:** com Tab, o foco não escapa para a página atrás. Esc fecha e o foco volta ao "+ Adicionar conta". Teste: Tarefa 2 (`sheet keeps focus inside and gives it back`).
4. **Confirmação na tela inicial sem a lista:** a primeira confirmação continua anunciada numa região ao vivo que já existia. Teste: Tarefa 3 (o existente `the first confirmation lands in a live region that already existed` passa sem mudar).
5. **Arquivar um cartão:** o aviso que a tela do cartão deixava em Contas aparece agora em Cartões. Teste: Tarefa 1 (`archiving a card returns to Cards with the message`).

---

### Task 1: Aba Cartões e barra de seis itens

**Files:**
- Create:
  - `frontend/src/ui/NavIcon.tsx`
  - `frontend/src/features/cards/CardsPage.tsx`
  - `frontend/src/features/cards/NewCardPage.tsx`
  - `frontend/src/features/cards/CardsPage.test.tsx`
- Modify:
  - `frontend/src/features/shell/AppShell.tsx`
  - `frontend/src/routes.tsx`
  - `frontend/src/features/cards/CardPage.tsx` (links e `navigate` de `/contas` para `/cartoes`; texto "Ver cartões")
  - `frontend/src/features/accounts/AccountsPage.tsx` (remove `<CardsSection>`)
  - `frontend/src/ui/focus.tsx` (passa a exportar `useMessageFromNavigation`, que hoje é local em `AccountsPage.tsx`)
  - `frontend/e2e/smoke.spec.ts` (cartão criado pela aba Cartões)
- Delete: `frontend/src/features/cards/CardsSection.tsx`. Os testes de cartão de `AccountsPage.test.tsx` vão para `CardsPage.test.tsx`.

**Interfaces — Produces:**
- `NavIcon({ name }: { name: 'home' | 'list' | 'chart' | 'wallet' | 'card' | 'more' }): JSX.Element`, um SVG `aria-hidden` de 20 px que usa `currentColor`.
- `useMessageFromNavigation(announce: Announce): void` em `src/ui/focus.tsx`, com o comportamento atual.
- Rotas `/cartoes` → `CardsPage` e `/cartoes/novo` → `NewCardPage`. `/cartoes/:id` continua.

- [ ] **Step 1: Testes que falham** (`CardsPage.test.tsx` e `HomePage.test.tsx`):
  - `cards tab lists each card with invoice, dates and free limit`. Com `CARDS_SUMMARY`, o bloco do Nubank mostra:
    - "Fatura de novembro (aberta)" e o total;
    - "Fecha 03/11 · vence 10/11";
    - "Limite livre R$ … de R$ 11.000,00";
    - link para `/cartoes/card-nubank`.
  - `closed invoice to pay shows what is left` (com `payable` cujo `balance` ≠ `total`, mostra o `balance` e o vencimento).
  - `add card opens its own page and returns to Cards` ("+ Adicionar cartão" → `/cartoes/novo`; criar volta para `/cartoes` com "Cartão Nubank criado.").
  - `archiving a card returns to Cards with the message` (fluxo de `CardPage.test.tsx` "edit and archive card", agora esperando a rota `/cartoes` e a mensagem lá).
  - `archived cards can be unarchived` (vindo de `AccountsPage.test.tsx`).
  - `cards page has no accessibility violations`.
  - Em `HomePage.test.tsx`, `navigation has six tabs` (substitui `navigation has the analysis tab`):

    ```ts
    const nav = await screen.findByRole('navigation', { name: 'Principal' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(
      ['Início', 'Lançam.', 'Análise', 'Contas', 'Cartões', 'Mais'])
    expect(within(nav).getByRole('link', { name: 'Lançamentos' })).toHaveAttribute('href', '/lancamentos')
    ```
- [ ] **Step 2:** `npx vitest run src/features/cards src/features/home src/features/accounts`. Expected: FAIL nos novos.
- [ ] **Step 3: Implementar.**
  - **AppShell:**
    - `SECTIONS` ganha `icon` e `short` (só "Lançam."); no celular o link mostra `NavIcon` + `short ?? label`, com `aria-label={label}` quando há `short`.
    - Seis colunas iguais (`flex-1`, `min-w-0`, texto centralizado de `clamp(10px, 3vw, 12px)`).
    - No md+, o texto completo ao lado do ícone, como hoje.
  - **CardsPage:** `Page title="Cartões"`, botão-link "+ Adicionar cartão" no alto (`primaryButtonClass`, `Link to="/cartoes/novo"`), uma `<li>` por cartão como bloco (`slipClass` ou bloco branco com borda, `rounded-xl`, sombra leve). O bloco mostra:
    - a barra de limite (`role="img"` com `aria-label="Limite usado: X de Y"`);
    - a fatura a pagar em `text-stamp`;
    - `ArchivedSection "Cartões arquivados"` no fim;
    - `useMessageFromNavigation`.
  - **NewCardPage:** `Page title="Novo cartão"`, link "‹ Cartões" e `<NewCardForm onCreated={(name) => navigate('/cartoes', { state: { message: \`Cartão ${name} criado.\` } })} onCancel={() => navigate('/cartoes')} />`.
- [ ] **Step 4:** a mesma linha do Step 2 → PASS. Depois, `npm run check` → verde.
- [ ] **Step 5: e2e.** No `smoke.spec.ts`, o cartão é criado por "Cartões" → "+ Adicionar cartão". `bash scripts/e2e.sh` → 3 passed.
- [ ] **Step 6: Navegador** (app-e2e, nunca os dados reais):
  - em 320 e 360 px, com a letra de 100, 115 e 130%, medir a borda direita do último item ≤ largura da tela;
  - fazer capturas da aba Cartões e da barra.
- [ ] **Step 7: Commit:** `feat(frontend): aba Cartões e barra de seis itens com ícones`.

---

### Task 2: Contas com janela de adicionar e de opções

**Files:**
- Create:
  - `frontend/src/ui/Sheet.tsx`
  - `frontend/src/ui/Sheet.test.tsx`
- Modify:
  - `frontend/src/features/accounts/AccountsPage.tsx`
  - `frontend/src/features/accounts/AccountsPage.test.tsx`
  - `frontend/e2e/smoke.spec.ts` (contas criadas pela janela)

**Interfaces — Produces:** `Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): JSX.Element`.
- Fica montado só enquanto aberto (o chamador decide).
- Fundo escurecido fixo; painel `role="dialog"`, `aria-modal="true"`, `aria-labelledby` no título (`<h2>`).
- **Foco e teclado:**
  - ao montar, o foco vai ao primeiro campo ou botão;
  - Tab e Shift+Tab ficam dentro;
  - Esc e um clique no fundo chamam `onClose`.
- **Por que não `<dialog>`:** `showModal` não é confiável no jsdom dos testes. *Decisão do plano.*

- [ ] **Step 1: Testes que falham.**
  - **`Sheet.test.tsx`:**
    - `sheet keeps focus inside and gives it back`: abrir pelo botão; o foco está no 1º campo; Tab a partir do último botão volta ao 1º; Esc fecha e o foco volta ao botão que abriu (com `useInPlace`, como as telas usam);
    - `sheet has no accessibility violations`.
  - **`AccountsPage.test.tsx`**, os testes de criar e editar atualizados para a janela:
    - `creates an account from the add sheet` ("+ Adicionar conta" abre `dialog` "Nova conta"; "Criar conta" envia o mesmo corpo de hoje, fecha a janela e anuncia "Conta Itaú criada.");
    - `account options open in a sheet` (tocar na conta abre `dialog` com o nome dela; "Editar" mostra o formulário atual; "Arquivar" mostra a confirmação atual);
    - `page title is Contas`;
    - os existentes de saldo negativo, valor inválido, nome repetido, aviso ao arquivar e foco ajustados aos novos caminhos.
- [ ] **Step 2:** `npx vitest run src/ui/Sheet.test.tsx src/features/accounts`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
  - **`Sheet`:** fixo embaixo no celular (`rounded-t-2xl`, `bg-slip`) e centralizado no md+.
  - **AccountsPage:**
    - `Page title="Contas"`;
    - botão "+ Adicionar conta" no cabeçalho, que abre `Sheet title="Nova conta"` com o `NewAccountForm` atual (sem o `<h2>` próprio, `aria-label` do form mantido "Nova conta");
    - lista dentro de bloco branco (`bg-slip rounded-xl border border-rule`);
    - linha inteira como botão (`aria-label="Opções de {nome}"`), que abre `Sheet title={nome}` com "Editar" e "Arquivar", que levam às telas internas de edição e confirmação que já existem.
- [ ] **Step 4:** a mesma linha → PASS. Depois, `npm run check` → verde.
- [ ] **Step 5:** `bash scripts/e2e.sh` → 3 passed.
- [ ] **Step 6: Navegador** (app-e2e, celular): abrir, criar, cancelar e Esc; capturas.
- [ ] **Step 7: Commit:** `feat(frontend): Contas com janela de adicionar e de opções`.

---

### Task 3: Tela inicial limpa

**Files:**
- Create:
  - `frontend/src/features/home/SessionEntries.tsx`
  - `frontend/src/features/transactions/ledger.tsx` (recebe `LedgerAmount`, `ledgerDetail`, `LedgerNames`, hoje em `Timeline.tsx`)
- Modify:
  - `frontend/src/features/home/HomePage.tsx`
  - `frontend/src/features/home/BalanceHeader.tsx`
  - `frontend/src/features/home/HomePage.test.tsx`
  - `frontend/src/features/transactions/TransactionsPage.tsx`, `TransactionsPage.test.tsx`
  - `frontend/src/features/analysis/DayDetails.tsx`, `PlacePage.tsx` (imports)
- Delete: `frontend/src/features/home/Timeline.tsx`. Sai também `useRecentTransactions` de `queries.ts` se ficar sem uso.

**Interfaces — Produces:**
- `SessionEntries({ entries }: { entries: SavedEntry[] }): JSX.Element`, com o mesmo `data-testid="session-entries"` e `aria-live="polite"` sempre presentes, como hoje.
- `ledger.tsx` com as mesmas assinaturas de antes.

- [ ] **Step 1: Testes que falham** (`HomePage.test.tsx`):
  - `home shows no ledger list`: com dois lançamentos na API, nenhum título de dia ("Hoje"/"Ontem") nem descrição deles aparece. Ver o que já foi lançado fica para Lançamentos. *(substitui `shows balance and groups the timeline by day`)*
  - `home shows open invoice and free limit per card`:
    - aparecem "Fatura aberta Nubank", o total da fatura e "Limite livre Nubank" com `formatBRL(limit.available)`;
    - os dois levam a `/cartoes/card-nubank`.
    - *(substitui `home shows open invoice line per card`)*
  - `empty home asks what you bought` (sem registro nesta visita, aparece "O que você comprou?"; some depois da primeira confirmação).
  - `full form is a button below the field`:

    ```ts
    const link = await screen.findByRole('link', { name: 'Formulário completo' })
    expect(link).toHaveAttribute('href', '/lancamentos/novo')
    ```

    E a classe de botão: o `className` contém `rounded`, o mesmo das outras.
  - Os existentes de confirmação, rascunho, offline, backup e frase não entendida passam sem mudar a asserção.
  - `ledger detail describes card purchases and invoice payments` vai para `TransactionsPage.test.tsx`, com a mesma asserção sobre a linha de detalhe.
- [ ] **Step 2:** `npx vitest run src/features/home src/features/transactions`. Expected: FAIL nos novos.
- [ ] **Step 3: Implementar.**
  - **HomePage:** sem `Timeline`. No espaço livre, `SessionEntries` ou, enquanto `entries` estiver vazio e não houver comprovante aberto, "O que você comprou?" (`text-ink-soft`, centralizado).
  - **Formulário completo:** abaixo do `Composer`, o link "Formulário completo" com aparência de botão secundário de largura cheia, com fundo mais escuro que o papel. Classe nova `quietButtonClass` em `styles.ts`: `bg-rule/60 border border-rule text-ink rounded-lg min-h-11 font-[600]`. Sai o link de texto de hoje.
  - **BalanceHeader:** por cartão, duas linhas, "Fatura aberta {nome}" e "Limite livre {nome}", com `limit.available`.
- [ ] **Step 4:** a mesma linha → PASS. Depois, `npm run check` → verde.
- [ ] **Step 5:** `bash scripts/e2e.sh` → 3 passed (a confirmação continua em `session-entries`).
- [ ] **Step 6: Navegador** (celular): tela inicial vazia, com um registro e com o comprovante aberto; capturas.
- [ ] **Step 7: Commit:** `feat(frontend): tela inicial só para registrar`.

---

### Task 4: Filtro "Conta ou cartão" e filtros em bloco em Lançamentos

**Files:**
- Create: `frontend/src/features/filters/SourceSelect.tsx`
- Modify:
  - `frontend/src/features/transactions/TransactionsPage.tsx`
  - `frontend/src/features/transactions/TransactionsPage.test.tsx`

**Interfaces — Produces:** `SourceSelect({ id, value, onChange, include }: { id: string; value: string; onChange: (value: string) => void; include?: (kind: 'account' | 'card', item: { id: string; archived_at: string | null }) => boolean }): JSX.Element`.
- Rótulo "Conta ou cartão"; 1ª opção "Todos" (valor `''`).
- `<optgroup label="Contas">` com `account:<id>` e `<optgroup label="Cartões">` com `card:<id>`, rotulados "Crédito {nome}". Arquivados com "(arquivada)" ou "(arquivado)".
- Usa `useAccounts(true)` e `useCards(true)`. Sem `include`, lista tudo.

- [ ] **Step 1: Testes que falham** (`TransactionsPage.test.tsx`):
  - `one filter for account or card`:
    - não existem mais os rótulos "Conta" e "Cartão";
    - escolher "Itaú" em "Conta ou cartão" põe `source=account:<id>` na URL e chama `/transactions` com `account_id=<id>` sem `card_id`;
    - escolher "Crédito Nubank" chama com `card_id=card-nubank` sem `account_id`.
  - `old account_id and card_id links still filter`:
    - abrir `/lancamentos?card_id=card-nubank` chama a API com `card_id=card-nubank` e o select mostra "Crédito Nubank";
    - o mesmo vale para `account_id`.
  - `filters sit in a highlighted block`: `getByRole('group', { name: 'Filtros' })` tem a classe do bloco (`bg-slip`).
  - O existente `transactions filter by card` é ajustado ao select único.
- [ ] **Step 2:** `npx vitest run src/features/transactions`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
  - **Leitura da URL:** `source` = `search.get('source')` ou, sem ele, `account:${account_id}` ou `card:${card_id}` a partir dos parâmetros antigos.
  - **Escrita:** grava `source` e apaga `account_id` e `card_id`.
  - **Parâmetros da API:** derivados de `source`.
  - **Visual:** o bloco de filtros com `bg-slip rounded-xl border border-rule p-3 shadow-sm`. "Conta ou cartão" ocupa a linha inteira (`col-span-2`).
- [ ] **Step 4:** a mesma linha → PASS. Depois, `npm run check` → verde.
- [ ] **Step 5: Navegador** (celular): os filtros e o link "Ver lançamentos" da tela do cartão, se existir; capturas.
- [ ] **Step 6: Commit:** `feat(frontend): filtro único de conta ou cartão em Lançamentos`.

---

### Task 5: Análise com listas no lugar dos botões

**Files:**
- Modify:
  - `frontend/src/features/analysis/AnalysisPage.tsx`
  - `frontend/src/features/analysis/AnalysisPage.test.tsx`
  - `frontend/e2e/smoke.spec.ts`, se ele clicar nos botões de período ou de modo

**Interfaces — Consumes:** `SourceSelect` (Tarefa 4), com `include` = a regra `listed` atual da Análise (arquivados só se tiveram gasto no período ou se estão selecionados).

- [ ] **Step 1: Testes que falham** (`AnalysisPage.test.tsx`):
  - `period and installment mode are dropdowns`:

    ```ts
    const period = await screen.findByLabelText('Período')
    expect(within(period).getAllByRole('option').map((o) => o.textContent)).toEqual(['Semana', 'Mês', 'Ano'])
    expect(period).toHaveValue('month')
    const mode = screen.getByLabelText('Compras parceladas')
    expect(within(mode).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Uma parcela por mês', 'Valor total no dia da compra'])
    ```

  - Os existentes `period chips and arrows update the url` e `mode toggle sends purchase mode` são reescritos com `selectOptions` (mesmas URLs e parâmetros esperados).
  - O filtro passa a se chamar "Conta ou cartão" nos testes `source filter sends card` e `archived sources …`.
  - `analysis filters sit in a highlighted block` (grupo "Filtros da análise" com `bg-slip`).
- [ ] **Step 2:** `npx vitest run src/features/analysis`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
  - **Listas:** dois `<select>` em `Field`. `Período`: `week` "Semana", `month` "Mês", `year` "Ano"; muda com `params.set({ period, date: null })`. `Compras parceladas`: `installments` e `purchase`.
  - **Bloco:** as duas listas e o `SourceSelect` ficam num `div role="group" aria-label="Filtros da análise"` com o mesmo estilo de bloco da Tarefa 4.
  - **Limpeza:** sai `chipClass` daqui, se ficar sem uso.
- [ ] **Step 4:** a mesma linha → PASS. Depois, `npm run check` e `bash scripts/e2e.sh` → verdes.
- [ ] **Step 5: Navegador** (celular): capturas.
- [ ] **Step 6: Commit:** `feat(frontend): Análise com listas de período e de parceladas`.

---

### Task 6: Explicação do "Essencial"

**Files:**
- Modify:
  - `frontend/src/features/categories/CategoriesPage.tsx`
  - `frontend/src/features/categories/CategoriesPage.test.tsx`

- [ ] **Step 1: Teste que falha.** `essential is explained`:
  - o texto "Essencial: gastos que o planejamento vai reservar primeiro (moradia, contas, saúde)." aparece uma vez, acima da lista de despesas;
  - cada checkbox "Essencial ({nome})" tem `aria-describedby` apontando para esse texto.
- [ ] **Step 2:** `npx vitest run src/features/categories`. Expected: FAIL.
- [ ] **Step 3: Implementar.** Um `<p id>` em `text-sm text-ink-soft` no topo do grupo de despesas e `aria-describedby` nos checkboxes.
- [ ] **Step 4:** a mesma linha → PASS. Depois, `npm run check` → verde.
- [ ] **Step 5: Commit:** `feat(frontend): explica o Essencial das categorias`.
