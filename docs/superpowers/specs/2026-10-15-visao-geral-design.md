# Assistente Financeiro Pessoal com IA — Visão geral e decisões globais

Data: 2026-10-15
Status: aprovado

Este documento registra as decisões que valem para todos os subprojetos. Cada subprojeto tem sua própria spec, que referencia esta.

## 1. Propósito

Aplicação web pessoal (PWA) de controle financeiro, com conversa em linguagem natural como interface principal. Objetivo central: **prevenir novos déficits**, evitando compras que comprometam despesas essenciais ou aumentem o endividamento.

Prioridade de uso declarada pela usuária: **registrar gastos rapidamente pelo celular, digitando uma frase curta** (ex.: "42 mercado nubank"). Em seguida: controle de cartão, saber quanto pode gastar e acompanhar dívidas.

Usuária única no início; todo dado pertence a um `user_id` para permitir múltiplos usuários no futuro.

## 2. Princípios

- O backend é a única fonte de valores financeiros. A IA interpreta, aciona ferramentas e explica; nunca calcula nem inventa valores.
- Dinheiro: `Decimal` no Python, `NUMERIC(14,2)` no PostgreSQL, string no JSON. Arredondamento `ROUND_HALF_UP` em um único helper. Nenhum `float` no caminho do dinheiro.
- Valores de transação são sempre positivos; o tipo define a direção.
- Nada é apagado fisicamente: transações são anuladas, cadastros são arquivados, alterações são auditadas.
- Toda escrita originada pela IA exige clique de confirmação da usuária (ação pendente).
- A IA não tem nenhuma ferramenta de pagamento ou movimentação financeira real.

## 3. As três visões financeiras

| Visão | Pergunta | Entra | Não entra |
|---|---|---|---|
| Consumo | "Quanto gastei com X?" | Despesas na data da compra (conta ou cartão), menos estornos; encargos como categoria própria | Pagamento de fatura, transferências, amortização de dívida |
| Caixa | "Quanto tenho nas contas?" | Entradas e saídas efetivas das contas | Compras no cartão |
| Obrigações | "Quanto devo e quando?" | Faturas, parcelas futuras, parcelas de dívida, recorrentes previstas | Itens quitados |

Regra de ouro: um evento é consumo no máximo uma vez e saída de caixa no máximo uma vez. Nenhum indicador soma visões diferentes.

### Tipos de transação (conjunto completo, introduzido ao longo dos subprojetos)

| Tipo | Consumo? | Caixa? |
|---|---|---|
| `INCOME` | — (receita) | + |
| `EXPENSE` via conta | sim | − |
| `EXPENSE` via cartão | sim | não (gera itens de fatura) |
| `TRANSFER` | não | neutro |
| `INVOICE_PAYMENT` | não | − |
| `DEBT_PAYMENT` | só juros | − |
| `CHARGE` (juros/multa/IOF do cartão) | sim (Encargos financeiros) | não |
| `REFUND` | reduz consumo da categoria original | + se conta; crédito na fatura se cartão |

## 4. Decisões de negócio

| Id | Decisão |
|---|---|
| A1 | Contas (corrente, poupança, carteira) existem desde o MVP; saldo disponível parte delas. |
| A2 | Orçamento e "quanto gastei" usam data da compra; saldo usa data do pagamento. |
| A3 | Compras parceladas entram no orçamento **pelo valor da parcela, em cada mês** da parcela. |
| A4 | Financiamento imobiliário é Dívida (com cronograma), não despesa recorrente. |
| A5 | Escrita pela IA: **sempre** com clique de confirmação. |
| A6 | Compra com data ≥ dia de fechamento cai na fatura seguinte (configurável por cartão). |
| A7 | Dia de fechamento/vencimento inexistente no mês → último dia do mês. Sem ajuste para dia útil no MVP; datas da fatura editáveis. |
| A8 | Juros e encargos são registrados conforme cobrados, não calculados. Simulações indicam a taxa informada. |
| A9 | Fatura guarda total informado pelo banco além do calculado; diferença fica visível. |
| A10 | Parcelas: valor truncado em centavos, resto na primeira parcela; soma sempre igual ao total. |
| A11 | "Essencial" é atributo da categoria, sobrescrevível por transação/recorrente. |
| A12 | Fuso por usuária (padrão `America/Sao_Paulo`); "hoje" sempre vem do backend. |
| A13 | Estorno de parcelada cancela parcelas futuras não faturadas e gera créditos nas fechadas. |
| A14 | Parcelada compromete o limite pelo valor total, liberado conforme pagamento. |
| — | Registro sem forma de pagamento: data padrão = hoje; forma de pagamento sempre perguntada (com atalhos das mais usadas). |
| — | Início de uso: saldos de abertura no dia 1º do mês corrente + lançamento retroativo do mês. |
| — | Vários lançamentos em uma mensagem: suportado (cartão de confirmação em lote). |
| — | Categoria: memória estabelecimento → categoria no backend, alimentada pelas escolhas explícitas da usuária. |

## 5. "Disponível até a data-alvo"

```
Saldo em contas (efetivado, hoje)
− faturas com vencimento até a data-alvo (saldo devedor)
− ocorrências essenciais previstas até a data-alvo
− parcelas de dívidas até a data-alvo
= Disponível livre até a data-alvo
```

Data-alvo padrão: próxima receita prevista. Sempre acompanhado, separadamente, de: fatura aberta, limite de crédito disponível (rotulado "não é dinheiro") e receita prevista. Limite de crédito nunca entra no disponível.

## 6. Arquitetura

- Monorepo: `backend/` (Python, FastAPI, SQLAlchemy 2 síncrono + psycopg 3, Alembic, Pydantic) e `frontend/` (React, TypeScript, Vite, PWA).
- Backend em camadas: `domain/` (regras puras) → `services/` (casos de uso, transação, auditoria, idempotência) → `repositories/` (escopo por usuário) → `api/` (routers finos). `ai/` com interface `LLMProvider`, adapters (Anthropic inicial, Fake para testes), ferramentas que só chamam services, orquestrador.
- Implantação: **um único serviço** — o FastAPI serve a API em `/api` e o frontend compilado em `/` (mesma origem) — em plataforma de nuvem com Postgres gerenciado e HTTPS. Desenvolvimento local com docker-compose.
- Segurança tratada como se exposta na internet desde o início.

## 7. Subprojetos (ordem)

1. **Fundação e lançamentos** — auth, contas, categorias, transações via conta, idempotência, auditoria, tela inicial em formato de conversa com interpretador simples. Spec: `2026-10-15-fundacao-e-lancamentos-design.md`.
2. **Cartões e faturas** — ciclo, parcelamento, encargos, pagamento total/parcial, limite.
3. **Assistente de IA (registro)** — provedor, ferramentas, ações pendentes, chat persistido.
4. **Planejamento** — recorrências versionadas, orçamentos, dívidas.
5. **Posição financeira e decisão** — disponível, compromissos, simulação, regras da usuária.
6. **Painel e PWA completo** — indicadores, gráficos, refinamentos.

Fora do MVP: Open Finance, conexão com bancos, pagamentos, investimentos, previsões por ML, apps nativos. Importação CSV/OFX após o MVP.
