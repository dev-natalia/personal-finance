# Subprojeto 1 — Fundação e lançamentos

Data: 2026-10-15
Status: aguardando revisão
Depende de: `2026-10-15-visao-geral-design.md` (decisões globais)

## 1. Objetivo

Ao final deste subprojeto, a usuária consegue instalar o app no celular, fazer login, cadastrar suas contas com o saldo do dia 1º do mês e lançar receitas, despesas pagas com conta, transferências e estornos — digitando frases curtas na tela inicial ou pelo formulário completo — com saldos e consumo por categoria corretos.

### Critérios de sucesso

- Digitar `42 mercado pix itaú` e confirmar registra a despesa em uma interação, com a categoria lembrada nas próximas vezes.
- Saldo de cada conta = saldo de abertura + movimentos confirmados, conferível manualmente.
- Transferências nunca alteram receitas, consumo ou saldo total.
- Reenviar a mesma confirmação (falha de rede, clique duplo) nunca cria duplicata.
- Dados de um usuário nunca aparecem para outro.
- App instalável como PWA e utilizável com teclado e leitor de tela.

## 2. Escopo

### Inclui

1. Fundação técnica: monorepo, imagem Docker única (backend + frontend compilado), docker-compose com Postgres para dev/testes, uv, ruff, mypy, pytest, Alembic, git.
2. Autenticação sem cadastro público (usuária criada via CLI), sessões no banco, limite de tentativas.
3. Contas: criar, editar, arquivar; saldo e data de abertura.
4. Categorias: lista padrão editável, flag essencial, plana.
5. Transações: `INCOME`, `EXPENSE` (via conta), `TRANSFER`, `REFUND` (de despesa via conta); editar, anular; auditoria; idempotência.
6. Memória estabelecimento → categoria.
7. Consultas: saldos, lista filtrada, consumo por categoria no mês, receitas do mês.
8. Frontend: login; tela inicial em formato de conversa com interpretador simples e cartão de confirmação; formulário completo; telas de Lançamentos, Contas, Categorias; PWA básico.

### Não inclui

Cartões e faturas (subprojeto 2), IA e chat persistido (3), recorrências, orçamentos e dívidas (4), disponível e decisão (5), painel com gráficos (6).

Consequência aceita: gastos no cartão de crédito só podem ser lançados após o subprojeto 2.

## 3. Modelo de dados

Convenção: identificadores em inglês no código e no banco; interface em português. Todas as tabelas de dados têm `id UUID` (exceto `audit_log`), `user_id` e `created_at`/`updated_at` (`timestamptz`).

### `users`
| Coluna | Tipo | Regras |
|---|---|---|
| email | citext | único |
| password_hash | text | argon2id |
| timezone | text | padrão `America/Sao_Paulo` |

### `sessions`
| Coluna | Tipo | Regras |
|---|---|---|
| user_id | uuid | FK |
| token_hash | bytea | SHA-256 do token; único |
| expires_at | timestamptz | absoluto: criação + 90 dias |
| last_seen_at | timestamptz | expira se `now - last_seen_at > 30 dias` |
| revoked_at | timestamptz | null = ativa |

### `login_attempts`
| Coluna | Tipo | Regras |
|---|---|---|
| email_normalized | text | |
| ip | inet | |
| succeeded | bool | |
| attempted_at | timestamptz | índice |

### `accounts`
| Coluna | Tipo | Regras |
|---|---|---|
| name | text | `UNIQUE(user_id, name)` |
| type | enum `CHECKING`/`SAVINGS`/`CASH` | |
| opening_balance | numeric(14,2) | pode ser negativo |
| opening_date | date | |
| archived_at | timestamptz | null = ativa |

### `categories`
| Coluna | Tipo | Regras |
|---|---|---|
| name | text | `UNIQUE(user_id, kind, name)` |
| kind | enum `EXPENSE`/`INCOME` | |
| is_essential | bool | |
| is_system | bool | `A classificar` e `Encargos financeiros`: não podem ser arquivadas |
| archived_at | timestamptz | |

Lista padrão criada com a usuária:
- Despesa: Alimentação, Mercado, Transporte, Moradia (essencial), Contas da casa (essencial), Saúde (essencial), Pets (essencial), Assinaturas, Compras diversas, Lazer, Hábitos pessoais, Educação, Encargos financeiros (sistema), A classificar (sistema).
- Receita: Salário, 13º salário, Receitas extras, Reembolsos, A classificar (sistema).

### `merchants`
| Coluna | Tipo | Regras |
|---|---|---|
| name | text | como digitado na primeira vez |
| normalized_name | text | `UNIQUE(user_id, normalized_name)` |
| default_category_id | uuid null | FK categories |

### `transactions`
| Coluna | Tipo | Regras |
|---|---|---|
| type | enum `INCOME`/`EXPENSE`/`TRANSFER`/`REFUND` | imutável após criação |
| amount | numeric(14,2) | `CHECK (amount > 0)` |
| occurred_on | date | data local da usuária; ≥ `opening_date` das contas envolvidas |
| description | text | obrigatório, 1–200 caracteres |
| notes | text null | até 1000 caracteres |
| merchant_id | uuid null | |
| category_id | uuid null | obrigatório em `INCOME`/`EXPENSE`; `REFUND` copia da original; null em `TRANSFER` |
| account_id | uuid | origem (`EXPENSE`, `TRANSFER`) ou destino (`INCOME`, `REFUND`) |
| destination_account_id | uuid null | só `TRANSFER`; `CHECK ≠ account_id` |
| payment_method | enum `PIX`/`DEBIT`/`CASH`/`BOLETO`/`OTHER` null | só `EXPENSE` (obrigatório) |
| refund_of_id | uuid null | só `REFUND`; aponta para `EXPENSE` |
| status | enum `CONFIRMED`/`VOIDED` | |
| source | enum `MANUAL`/`AI`/`IMPORT` | |
| idempotency_key | text null | `UNIQUE(user_id, idempotency_key)` parcial (não nulo) |
| idempotency_payload_hash | bytea null | presente sse a chave estiver presente |
| voided_at | timestamptz null | |

CHECK de forma por tipo (colunas obrigatórias/proibidas). Índices: `(user_id, occurred_on, id)`, `(user_id, account_id, occurred_on)`, `(user_id, destination_account_id)`, `(user_id, category_id, occurred_on)`, `(refund_of_id)`.

No subprojeto 2, `card_id` será adicionado e o CHECK de `EXPENSE` passará a "conta XOR cartão" via migração.

### `audit_log` (somente inserção)
| Coluna | Tipo |
|---|---|
| id | bigint identity |
| user_id | uuid |
| entity_type / entity_id | text / uuid |
| action | enum `CREATE`/`UPDATE`/`VOID`/`ARCHIVE` |
| before / after | jsonb null |
| actor | enum `USER`/`AI`/`SYSTEM` |
| request_id | text |
| created_at | timestamptz |

### Decisões do modelo
- Saldos não são armazenados; são calculados a partir de abertura + transações confirmadas.
- Sem exclusão física: transações são anuladas, contas e categorias arquivadas. Itens arquivados não aceitam novos lançamentos, mas permanecem no histórico.
- Transação com data anterior à abertura de qualquer conta envolvida é rejeitada.

## 4. Domínio (backend, puro)

- `money.py`: `parse_money(str) -> Decimal` aceita `42`, `42,50`, `42.50`, `1.234,56`, `R$ 42`; rejeita mais de 2 casas decimais, valores ≤ 0 onde não permitidos e acima de 999.999.999.999,99. `quantize` com `ROUND_HALF_UP`. `format_brl`.
  - Regra de separador: se houver vírgula, ela é o separador decimal e pontos são de milhar; sem vírgula, um único ponto seguido de exatamente 1–2 dígitos é decimal, caso contrário é milhar (`1.234` = mil duzentos e trinta e quatro).
- `dates.py`: `Clock` injetável; `today(tz)`; `month_range(year, month)`.
- `merchants.py`: `normalize(name)` = casefold, remover acentos, remover pontuação, colapsar espaços, trim.
- `categorization.py`: explícita → padrão do estabelecimento → `A classificar`.

## 5. Services

Cada operação recebe `RequestContext(user_id, actor, request_id, clock)` e roda em uma transação de banco única que inclui a auditoria.

### `AccountService`, `CategoryService`
CRUD e arquivamento. Arquivar conta com saldo diferente de zero é permitido, com aviso `archived_with_balance`. Categorias de sistema não podem ser arquivadas nem renomeadas.

### `TransactionService`

| Operação | Regras |
|---|---|
| `create_income/expense/transfer` | Conta(s) e categoria pertencem à usuária, ativas, do `kind` compatível; data ≥ abertura; estabelecimento resolvido ou criado pelo nome normalizado; categoria resolvida pela ordem do domínio. |
| aprendizado | Se a categoria foi **informada explicitamente** e há estabelecimento, ela vira o `default_category_id` do estabelecimento (última escolha vence). Categoria vinda da sugestão não altera nada. |
| `create_refund(expense_id, amount, date, account_id?)` | Original deve ser `EXPENSE` confirmada; bloqueio `SELECT … FOR UPDATE` na original; Σ estornos confirmados + novo ≤ valor original; conta padrão = conta da original; data ≥ data da original. |
| `update` | Campos editáveis: valor, data, descrição, notas, estabelecimento, categoria, contas, meio. Tipo e origem imutáveis. Valor não pode ficar abaixo da soma dos estornos confirmados. Auditoria com antes/depois. |
| `void` | Bloqueado se houver estornos confirmados (`has_active_refunds`). Idempotente. |
| idempotência | Com chave: se existir transação com mesma chave e mesmo hash de payload → retorna a existente (HTTP 200, `replayed: true`); hash diferente → `IdempotencyKeyReused` (409). Corrida resolvida pela constraint única. |
| avisos | `negative_balance` quando a conta fica negativa após a operação. |

### `LedgerQueries` (única fonte das definições de indicadores)
- `account_balance(account, as_of)` = abertura + Σ`INCOME` + Σ`REFUND` + Σ`TRANSFER` recebidas − Σ`EXPENSE` − Σ`TRANSFER` enviadas; apenas `CONFIRMED` e `occurred_on ≤ as_of`.
- `total_balance(as_of)` = soma das contas **ativas** (revisto em 2026-10-17: arquivar tira a conta do total; o saldo que ficou em contas arquivadas aparece à parte, `archived_balance`). Contas e cartões arquivados podem ser desarquivados.
- `monthly_consumption_by_category(month)` = Σ`EXPENSE` − Σ`REFUND` por categoria; transferências nunca entram.
- `monthly_income(month)` = Σ`INCOME`.
- `list_transactions(filters, cursor)`: filtros por período, conta, categoria, estabelecimento, meio, tipo, status; ordenação `occurred_on desc, id desc`; paginação por cursor.
- `possible_duplicates(amount, merchant, date)`: despesas confirmadas com mesmo valor e mesmo estabelecimento normalizado em ±2 dias.
- `top_payment_options(n)`: combinações conta + meio mais usadas nos últimos 90 dias (para atalhos).

### Repositórios
Repositório base aplica `user_id` em toda consulta. Recurso de outro usuário é tratado como inexistente.

### CLI
`python -m app.cli create-user --email ...` (senha lida de forma interativa ou de variável de ambiente), `set-password`, `revoke-sessions`.

## 6. API (`/api/v1`)

Convenções: dinheiro como string; datas ISO 8601; erros em Problem Details (RFC 9457) com `code` estável; respostas de escrita podem conter `warnings`.

| Recurso | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Contas | `GET /accounts`, `POST /accounts`, `PATCH /accounts/{id}`, `POST /accounts/{id}/archive`, `GET /accounts/balances?as_of=` |
| Categorias | `GET /categories`, `POST /categories`, `PATCH /categories/{id}`, `POST /categories/{id}/archive` |
| Estabelecimentos | `GET /merchants?q=` |
| Transações | `GET /transactions`, `POST /transactions` (corpo discriminado por `type`, cabeçalho `Idempotency-Key` obrigatório), `GET /transactions/{id}`, `PATCH /transactions/{id}`, `POST /transactions/{id}/void`, `POST /transactions/{id}/refunds` (com `Idempotency-Key`) |
| Apoio ao registro | `GET /entry-hints` → contas ativas, meios, atalhos de pagamento mais usados, "hoje" no fuso da usuária; `POST /entry-checks` → possíveis duplicatas para uma lista de itens |
| Resumos | `GET /summaries/month?month=YYYY-MM` |
| Saúde | `GET /health` |

### Segurança
- Senha: argon2id (`pwdlib`); verificação com hash fictício quando o e-mail não existe.
- Cookie de sessão: `HttpOnly; Secure; SameSite=Strict; Path=/`; token aleatório de 32 bytes; expiração deslizante de 30 dias e absoluta de 90 dias.
- CSRF: `SameSite=Strict` + verificação do cabeçalho `Origin` contra a origem configurada + exigência de `X-Requested-With` em métodos que alteram dados.
- Limite de login: 5 falhas em 15 minutos por e-mail e por IP → 429.
- Cabeçalhos: CSP `default-src 'self'`, `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- Logs: request_id, método, rota, status, duração. Nunca corpo, valores, descrições, cookies ou cabeçalhos de autenticação.
- Configuração via `pydantic-settings`; a aplicação não inicia sem `DATABASE_URL`, `SECRET_KEY`, `APP_ORIGIN`.

## 7. Erros

| Erro de domínio | HTTP | `code` exemplos |
|---|---|---|
| Validação | 422 | `validation_error` (+ campos) |
| Regra de negócio | 422 | `refund_exceeds_original`, `date_before_account_opening`, `account_archived`, `category_kind_mismatch`, `has_active_refunds`, `system_category_locked` |
| Não encontrado (inclui de outro usuário) | 404 | `not_found` |
| Conflito | 409 | `idempotency_key_reused`, `name_already_exists` |
| Autenticação | 401 / 429 | `unauthenticated`, `invalid_credentials`, `too_many_attempts` |
| CSRF | 403 | `origin_not_allowed` |
| Inesperado | 500 | genérico + `request_id` |

Violações de constraint do banco são convertidas em 409/422, nunca 500.

Frontend: erro de campo junto ao campo; falha de rede mantém o cartão com "Tentar de novo" reutilizando a mesma `Idempotency-Key`; 401 leva ao login preservando o texto não enviado em `sessionStorage`; 409 de idempotência mostra erro genérico sem nova tentativa automática.

## 8. Frontend

### Tela inicial (conversa como linha do tempo)
- Saldo total no topo; linha do tempo com lançamentos agrupados por dia; campo de texto fixo embaixo, focado ao abrir.
- Texto enviado → interpretador simples → cartão de confirmação.
- Cartões pendentes vivem só na sessão atual (persistência de conversa chega no subprojeto 3).
- Lançamento confirmado vira linha "Despesa registrada: R$ 42,00 · Alimentação · Pix Itaú", montada a partir da resposta do backend.
- Botão "Formulário completo" para todos os tipos, incluindo transferência e estorno.

### Interpretador simples (`frontend/src/domain/parser.ts`, função pura)
Entrada: texto + `entry-hints`. Saída: lista de itens parciais, cada um com campos reconhecidos e campos pendentes.

| Elemento | Regra |
|---|---|
| Itens | separados por `;` ou quebra de linha |
| Valor | exatamente um número monetário por item (regras de `money` espelhadas); zero ou vários → campo valor pendente |
| Tipo | despesa por padrão; prefixo `+` ou palavra inicial `recebi` → receita |
| Pagamento | tokens comparados (normalizados) com nomes de contas ativas e com `pix`, `debito`/`débito`, `dinheiro`, `boleto`; sem correspondência → pendente, cartão pergunta "Como você pagou?" com os 3 atalhos mais usados; mais de uma conta → pendente |
| Data | `hoje` (padrão), `ontem`, `anteontem`, `dia N` (mês atual; se futuro, mês anterior), `D/M` (ano atual; se futuro, ano anterior) |
| Descrição | tokens restantes; vazio → pendente |
| Categoria | definida no cartão: padrão do estabelecimento (via `/merchants`) ou `A classificar` |

### Cartão de confirmação
- Campos editáveis com toques; data em destaque quando não for hoje.
- Lote: lista com caixa de seleção por item; cada item confirmado individualmente com sua própria `Idempotency-Key` (gerada com `crypto.randomUUID()` ao criar o cartão); falha de um item não afeta os demais.
- Avisos: possível duplicata (`/entry-checks`) e saldo negativo (resposta da criação).
- Botão "Confirmar" desabilitado enquanto houver campo pendente.

### Navegação e telas
- Celular: barra inferior Início · Lançamentos · Contas · Mais (Categorias, Sair). Desktop: barra lateral.
- Lançamentos: lista com filtros; editar, anular, estornar.
- Contas: saldos e cadastro com saldo e data de abertura.
- Categorias: criar, renomear, marcar essencial, arquivar.

### PWA
Manifesto e service worker (`vite-plugin-pwa`) com cache do esqueleto da aplicação. Sem fila de lançamentos offline: sem conexão, aviso claro e texto digitado preservado.

### Acessibilidade
Componentes baseados em Radix; foco movido para o cartão quando aparece; `aria-live` para confirmações e erros; contraste mínimo WCAG AA; sinal "−" em negativos (não só cor); erros associados aos campos; inputs com fonte ≥ 16px.

### Bibliotecas
Vite, React, TypeScript, React Router, TanStack Query, react-hook-form, Tailwind, Radix, tipos gerados do OpenAPI (`openapi-typescript`). Versões definidas no plano de implementação.

## 9. Testes

Desenvolvimento orientado a testes nas regras de domínio e services.

| Camada | Ferramenta | Cobertura mínima |
|---|---|---|
| Domínio backend | pytest + Hypothesis | `parse_money` (formatos, separadores, rejeições, propriedade ida-e-volta com `format_brl`); `dates` com relógio fixo (23h30 em São Paulo); normalização; ordem de categorização |
| Services | pytest + Postgres real (docker-compose, transação desfeita por teste) | saldos; consumo exclui transferências; receita não inclui transferências; limite de estornos; anulação e bloqueio por estornos; idempotência (repetição e conflito); data antes da abertura; conta arquivada; isolamento entre dois usuários; aprendizado de categoria; auditoria gravada na mesma transação |
| API | TestClient | login/logout/expiração deslizante e absoluta; atributos do cookie; `Origin` inválido → 403; limite de tentativas → 429; formato Problem Details; dinheiro serializado como string |
| Migrações | Alembic | `upgrade head` em banco vazio; `alembic check` |
| Interpretador | Vitest | tabela de frases → resultado esperado, incluindo ambíguos e lote |
| Componentes | Vitest + Testing Library + axe | cartão: confirmar, desmarcar item, tentar de novo com a mesma chave; checagens de acessibilidade |
| Ponta a ponta | Playwright (smoke) | login → `42 mercado pix itaú` → confirmar → lançamento na linha do tempo e saldo atualizado |

Um comando único executa lint, checagem de tipos e todos os testes; ele será a base da CI quando o repositório estiver no GitHub.
