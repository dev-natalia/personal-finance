# Subprojeto 2 — Cartões e faturas

Data: 2026-10-16
Status: aguardando aprovação da usuária
Referências: `2026-10-15-visao-geral-design.md` (decisões globais A1–A14, três visões financeiras), `2026-10-15-fundacao-e-lancamentos-design.md` (modelo, API, frontend e padrões do subprojeto 1, já na `main`).

## 1. Objetivo

Hoje a usuária usa um cartão, o Nubank, para quase tudo. O mês dela é um ciclo: gasta no cartão, recebe, paga a fatura no começo do mês seguinte. Quando o dinheiro não cobre, completa com o que tem guardado. Já precisou parcelar a fatura com o Nubank. Também parcela compras, e por isso o mês já começa com cerca de R$ 3 mil comprometidos. O limite vive no fim.

A dor que ela descreveu: **muitas compras pequenas que, somadas, aumentaram muito a fatura**, e só se percebe quando a fatura chega. Este subprojeto existe para que ela veja a fatura subir no momento de cada compra, saiba o que já está comprometido nos próximos meses e acompanhe o limite. Nas palavras dela, as telas de cartão e fatura são **"alguns dos focos centrais deste app"**.

### Critérios de sucesso
- Ao registrar uma compra no cartão, o comprovante mostra a fatura em que ela cai (antes → depois) e o limite disponível (antes → depois). Numa compra parcelada, mostra também como ficam as próximas faturas.
- A tela do cartão responde, sem cálculo da usuária: quanto está a fatura aberta, quando fecha e vence, quanto de limite resta, quanto já está garantido nas próximas faturas e quais compras compõem cada fatura.
- A usuária consegue conferir a fatura fechada com o total do Nubank e ver a diferença.
- A usuária consegue pagar a fatura com dinheiro de uma ou mais contas, inclusive parcialmente, e dizer o que acontece com o restante.
- Nenhum evento conta duas vezes: a compra é consumo na data da compra; o pagamento da fatura é só saída de caixa (regra de ouro da visão geral).
- Todos os valores vêm do backend; o frontend nunca calcula fatura, limite ou parcela.

## 2. Escopo

### Inclui
1. Cadastro de cartões (vários; hoje só o Nubank): nome, limite, dia de fechamento, dia de vencimento, data de início; editar e arquivar.
2. Compra no cartão à vista e parcelada (`EXPENSE` via cartão), pela frase da tela inicial e pelo formulário completo.
3. Faturas: geradas pelo backend a partir do ciclo do cartão; aberta, fechada, paga; datas editáveis (A7); total informado pelo banco e diferença (A9).
4. Itens de fatura: parcelas de compras, estornos (crédito), encargos, saldo anterior (rotativo), parcelas de parcelamento de fatura.
5. Pagamento de fatura (`INVOICE_PAYMENT`) a partir de uma ou mais contas, total ou parcial; para o restante: **parcelar com o banco** ou **deixar para a próxima fatura**.
6. Encargos do cartão (`CHARGE`): juros, multa, IOF, registrados com os valores que o banco informa (A8), na categoria de sistema "Encargos financeiros".
7. Estorno de compra no cartão (A13) e anulação de compra no cartão.
8. Limite: usado, disponível, comprometido por parceladas (A14).
9. Frontend: tela de contas vira "Contas e cartões"; tela do cartão; comprovante com impacto na fatura e no limite; pagamento; linha da fatura aberta na tela inicial.

### Não inclui
- **Análise** (gráficos, gasto por categoria, por dia, por estabelecimento na semana/mês/ano, com filtro por meio de pagamento): é o **próximo subprojeto**, logo depois deste (decidido com a usuária; ver seção 10).
- Assinaturas e compras recorrentes no cartão: subprojeto de planejamento.
- Disponível até a data-alvo e decisão de compra: subprojeto de posição financeira.
- Dívidas fora do cartão (empréstimos, financiamento).
- Ajuste de datas para dia útil (A7), cálculo de juros pelo app (A8), importação de fatura, conexão com o banco.
- Cartão adicional, cartão virtual, cashback, anuidade como cadastro (anuidade cobrada entra como encargo).

## 3. Conceitos e regras

### Ciclo e qual fatura recebe a compra
- Cada fatura é identificada pelo **mês de vencimento** ("fatura de novembro" vence em novembro).
- Para um cartão com fechamento no dia F e vencimento no dia V: a fatura de mês M fecha no dia F e vence no dia V. Se V > F, ambos no mês M; se V ≤ F, o fechamento é no mês anterior ao vencimento. (Nubank da usuária: fecha 3, vence 10, ambos no mês da fatura.)
- Compra com data **anterior** ao fechamento de uma fatura entra nela; data **igual ou posterior** ao fechamento cai na seguinte (A6).
- Dia inexistente no mês → último dia do mês (A7). As datas de fechamento e vencimento de uma fatura podem ser editadas individualmente (o banco às vezes desloca para dia útil); a edição vale só para aquela fatura.
- Faturas são criadas pelo backend quando o primeiro item cai nelas (inclusive faturas futuras, por parcelas). Não há fatura vazia guardada.

### Estado da fatura (derivado, não digitado)
- **Aberta**: hoje < data de fechamento.
- **Fechada**: data de fechamento ≤ hoje e saldo devedor > 0.
- **Paga**: fechada e saldo devedor ≤ 0 (inclui saldo levado para outra fatura ou parcelado).
- **Futura**: aberta, mas posterior à fatura aberta atual (só tem parcelas).
- Saldo devedor = soma dos itens de débito − créditos − pagamentos − valor levado adiante/parcelado.

### Parcelas (A10)
- "1200 celular 6x": 6 itens de R$ 200,00, um em cada uma das 6 faturas a partir da que recebe a data da compra. Valor truncado nos centavos; o resto vai na primeira parcela; a soma é sempre o total.
- Parcelas: de 2 a 24.

### Consumo, caixa e obrigações (as três visões)
| Evento | Consumo | Caixa | Fatura/limite |
|---|---|---|---|
| Compra à vista no cartão | total, na data da compra | não | item na fatura da data |
| Compra parcelada | cada parcela no mês **da data da compra + (k−1) meses** (A3) | não | um item por fatura; limite tomado pelo total (A14) |
| Pagamento de fatura | não | − na conta de origem | reduz saldo devedor e libera limite |
| Encargo (`CHARGE`) | sim, "Encargos financeiros", na data do encargo | não | item de débito |
| Estorno de compra no cartão | reduz consumo da categoria original | não | crédito (ver abaixo) |
| Saldo levado para a próxima fatura | não | não | item na fatura seguinte; a anterior fica paga |
| Parcelamento da fatura com o banco | só os juros, como `CHARGE` | não | N itens nas próximas faturas; a fatura atual fica paga |

Nota sobre a parcela no consumo: a parcela k conta no mês da compra mais k−1 meses, para que uma compra à vista e a 1ª parcela de uma parcelada feitas no mesmo dia caiam no mesmo mês. É uma escolha de implementação desta spec (a visão geral diz "em cada mês da parcela" sem fixar a âncora).

### Limite (A14)
- Limite usado = soma dos saldos devedores de todas as faturas não pagas do cartão, incluindo as futuras (parcelas garantidas) e os itens de parcelamento de fatura.
- Limite disponível = limite − usado. Pode ficar negativo (o banco às vezes aprova acima do limite); o app avisa, não bloqueia.
- O limite **nunca** é somado a dinheiro em nenhum indicador e aparece sempre com o rótulo "Limite não é dinheiro" onde houver valor de conta perto.

### Estorno e anulação (A13)
- **Estorno** (`REFUND` com `card_id`) de uma compra no cartão, total ou parcial:
  - Compra à vista: crédito do valor na fatura aberta **hoje** (não na fatura da data do estorno), como o banco faz.
  - Compra parcelada: cancela parcelas **inteiras** ainda não faturadas, da mais distante para a mais próxima, enquanto o valor de cada uma couber no que falta estornar; o que sobrar vira crédito na fatura aberta hoje. Ex.: estorno de R$ 150 numa 6x de R$ 200 → nenhuma parcela cancelada, crédito de R$ 150; estorno de R$ 500 → cancela as 2 últimas e credita R$ 100.
  - Faturas fechadas nunca são alteradas pelo estorno (já foram conferidas com o banco); a parte já faturada volta como crédito na fatura aberta. É assim que esta spec lê o "gera créditos nas fechadas" da A13. *(Escolha desta spec.)*
  - Soma de estornos ≤ valor original (regra já existente).
  - Consumo: parcelas canceladas simplesmente deixam de contar nos seus meses; só a parte que virou crédito reduz o consumo da categoria original, no mês do estorno. *(Escolha desta spec, coerente com a A3.)*
- **Crédito maior que a fatura**: se uma fatura fecha com mais créditos que débitos, o saldo credor passa para a fatura seguinte (como o banco faz), calculado na leitura, sem item novo; a fatura fica paga. *(Escolha desta spec.)*
- **Anulação** de compra no cartão: se nenhuma parcela está em fatura fechada, cancela todos os itens. Se há parcelas em faturas fechadas, a anulação é recusada com a mensagem "Esta compra já está em fatura fechada. Registre um estorno." *(Escolha desta spec: anular mexeria em fatura já conferida com o banco.)*

### Edição de lançamentos do cartão *(escolhas desta spec)*
Regra geral: nada que já está em fatura fechada muda.
- **Compra no cartão**: descrição, notas, categoria e estabelecimento sempre editáveis. Valor, data, número de parcelas e cartão só enquanto nenhuma parcela estiver em fatura fechada; nesse caso os itens são refeitos (cancelados e recriados) na mesma transação de banco. Com parcela em fatura fechada, a edição desses campos é recusada ("Esta compra já está em fatura fechada. Registre um estorno.").
- **Trocar entre conta e cartão** não é edição: anula e registra de novo.
- **Encargo** (`CHARGE`): mesma regra da compra à vista.
- **Pagamento de fatura** (`INVOICE_PAYMENT`): não editável; anula a operação inteira e registra de novo.
- **Estorno no cartão**: anular devolve as parcelas que ele cancelou e remove o crédito, só se o crédito não estiver em fatura fechada.

### Pagamento da fatura
- Um pagamento é uma operação com uma ou mais origens (conta + valor). Cada origem gera uma transação `INVOICE_PAYMENT` (saída de caixa da conta, ligada à fatura). Toda a operação é uma única requisição idempotente e uma única transação de banco.
- Pode pagar fatura aberta (adiantamento) ou fechada. Pagamento acima do saldo devedor é recusado.
- Se o total pago for menor que o saldo devedor, a requisição traz o que fazer com o restante:
  - **Nada** (pagamento parcial simples): a fatura continua fechada com saldo devedor.
  - **Deixar para a próxima fatura** (rotativo): cria item "Saldo da fatura de M" na fatura seguinte; a fatura atual fica paga. Juros do rotativo chegam depois, quando a usuária confere a próxima fatura com o total do banco e registra a diferença como encargo.
  - **Parcelar com o banco**: a usuária informa número de parcelas N e o valor de cada parcela V, como o banco mostra. Cria N itens "Parcelamento da fatura de M (k/N)" nas próximas N faturas e um `CHARGE` de (N×V − restante) em "Encargos financeiros", na data do pagamento. O `CHARGE` não cria item próprio (os juros já estão dentro das parcelas). N×V < restante é recusado.
- Anular um pagamento desfaz o efeito da operação inteira (todas as origens e os itens criados para o restante); a operação só pode ser anulada se nenhum item criado por ela estiver em fatura fechada.

### Início do cartão (primeiro dia) — decidido com a usuária
O cartão entra no app já em uso: fatura aberta com compras do ciclo, parcelas em andamento (cerca de R$ 3 mil já comprometidos) e talvez uma fatura fechada não paga. Caminho escolhido: **parceladas em andamento compra por compra; fatura aberta e fechada pelo total.**
- **Fatura aberta agora**: a usuária informa o total que o Nubank mostra hoje. Vira um item `OPENING_BALANCE` nessa fatura.
- **Fatura fechada não paga** (se houver): idem, com o total e o vencimento dela.
- **Parceladas em andamento**: para cada uma, descrição, valor total, número de parcelas, data da compra e **quantas parcelas faltam depois da fatura atual**. O app cria só essas, nas faturas seguintes à aberta (as últimas r parcelas, números n−r+1 a n, com os valores da A10). A parcela deste mês já está dentro do total da fatura aberta, e por isso não é criada (assim nada conta duas vezes).
- Itens `OPENING_BALANCE` não são consumo nem caixa (são história anterior ao app), mas contam no saldo devedor e no limite. As parcelas criadas contam no consumo dos seus meses pela regra da seção "Consumo".
- Compras no cartão com data anterior a `opening_date` só são aceitas nesse formato (parcelada em andamento). Compras do ciclo atual feitas antes do início não são lançadas uma a uma: estão no total da fatura aberta.
- Depois do início, as faturas futuras do app podem ser comparadas com a tela de faturas futuras do Nubank.

### Conferência com o banco (A9)
- Cada fatura tem `reported_total` opcional (o total que o banco mostra). Quando preenchido, a tela mostra "Calculado aqui", "Total no Nubank" e a diferença com uma frase de orientação: se falta valor ("Faltam R$ 80,00: alguma compra pode não ter sido registrada.") ou se sobra ("Sobram R$ 80,00: confira se alguma compra foi registrada em dobro.").
- Atalho na própria fatura: "Registrar encargo" (para juros/IOF) e "Registrar compra" (abre o formulário já com o cartão e a data dentro da fatura).

## 4. Modelo de dados (mudanças sobre o subprojeto 1)

### `cards` (novo)
| Coluna | Tipo | Regras |
|---|---|---|
| name | text | 1–60; `UNIQUE(user_id, name)` entre ativos; pode repetir nome de conta ("Nubank") |
| credit_limit | numeric(14,2) | > 0 |
| closing_day | smallint | 1–31 |
| due_day | smallint | 1–31 |
| opening_date | date | primeiro dia em que o app acompanha o cartão |
| archived_at | timestamptz null | arquivado não aceita compras; com saldo devedor gera aviso, como conta |

### `transactions` (alterada)
- Novos tipos: `INVOICE_PAYMENT`, `CHARGE`.
- Novo meio de pagamento: `CREDIT`.
- Nova coluna `card_id uuid null` (FK `cards`).
- Nova coluna `installments smallint null` (2–24; só `EXPENSE` no cartão; null = à vista).
- Nova coluna `remaining_installments smallint null` (só parcelada em andamento no início do cartão: parcelas que faltam depois da fatura aberta; 1 a `installments − 1`).
- Nova coluna `invoice_id uuid null` (só `INVOICE_PAYMENT`: a fatura paga).
- Nova coluna `payment_group_id uuid null` (agrupa as origens de uma mesma operação de pagamento).
- Forma por tipo (CHECK atualizado):
  - `EXPENSE`: `account_id` XOR `card_id`; com cartão, `payment_method = CREDIT`; com conta, `payment_method ≠ CREDIT`.
  - `REFUND`: da original; se a original é de cartão, `card_id` igual ao dela e `account_id` null.
  - `INVOICE_PAYMENT`: `account_id`, `invoice_id`, `payment_group_id` obrigatórios; sem categoria.
  - `CHARGE`: `card_id` obrigatório; categoria "Encargos financeiros"; sem conta.
- Datas: compra/encargo no cartão com `occurred_on ≥ cards.opening_date`, exceto parcelada em andamento (com `remaining_installments`), que tem data anterior; pagamento com data ≥ abertura da conta.

### `invoices` (novo)
| Coluna | Tipo | Regras |
|---|---|---|
| card_id | uuid | |
| reference_month | date | 1º dia do mês de vencimento; `UNIQUE(card_id, reference_month)` |
| closing_date / due_date | date | calculadas do cartão; editáveis |
| reported_total | numeric(14,2) null | total informado pelo banco |
| dates_edited | bool | true se alguma data foi editada (edição de dias no cartão não sobrescreve) |

### `invoice_items` (novo)
| Coluna | Tipo | Regras |
|---|---|---|
| invoice_id | uuid | |
| kind | enum `PURCHASE`/`CHARGE`/`REFUND_CREDIT`/`CARRYOVER`/`INVOICE_INSTALLMENT`/`OPENING_BALANCE` | |
| direction | enum `DEBIT`/`CREDIT` | `REFUND_CREDIT` é crédito; os demais, débito |
| amount | numeric(14,2) | > 0 |
| transaction_id | uuid null | compra, encargo ou estorno de origem |
| installment_number / installment_count | smallint null | parcela k de n (compra ou parcelamento de fatura) |
| source_invoice_id | uuid null | `CARRYOVER` e `INVOICE_INSTALLMENT`: a fatura de origem |
| payment_group_id | uuid null | operação de pagamento que criou o item (para anulação) |
| status | enum `ACTIVE`/`CANCELLED` | parcelas canceladas por estorno ou anulação |

Auditoria (`audit_log`) em toda criação, edição, anulação e cancelamento, como no subprojeto 1. Nada é apagado.

## 5. Domínio e services (backend)

- `domain/cards.py` (puro): fatura de uma data para um cartão (A6/A7), datas de fechamento e vencimento de um mês, divisão em parcelas (A10), mês de consumo de cada parcela.
- `CardService`: criar, editar, arquivar. Editar dia de fechamento/vencimento recalcula as datas das faturas **ainda abertas ou futuras** sem `dates_edited`; não move itens de faturas fechadas. Se um item de compra mudar de fatura por isso, ele é movido (escolha desta spec).
- `TransactionService` (estendido): compra no cartão cria a transação e os itens de fatura na mesma transação de banco; estorno e anulação seguem a seção 3. Idempotência e auditoria como no subprojeto 1.
- `InvoiceService`: listar faturas de um cartão (anteriores, aberta, futuras), detalhar itens, informar `reported_total`, editar datas, pagar (seção 3), registrar encargo.
- `LedgerQueries` (estendido): saldos de conta passam a incluir `INVOICE_PAYMENT`; resumo do mês (`/summaries/month`) passa a incluir compras no cartão e encargos pela regra de consumo da seção 3; novo resumo do cartão (fatura aberta, limite usado/disponível, próximas faturas com totais).
- **Prévia de compra** (`CardService.preview`): dados (cartão, valor, parcelas, data) → fatura que recebe a compra (total antes/depois), faturas seguintes afetadas (antes/depois), limite disponível antes/depois. Não grava nada. É a fonte dos números do comprovante.

## 6. API (`/api/v1`, mesmo padrão do subprojeto 1)

- `GET/POST /cards`, `PATCH /cards/{id}`, `POST /cards/{id}/archive`. O `POST /cards` aceita, opcionalmente, `open_invoice_total` e `closed_invoice: {total, due_date}` para o início (seção 3).
- `GET /cards/summary`: para cada cartão ativo, fatura aberta (total, fechamento, vencimento), limite usado/disponível e próximas faturas (mês e total).
- `GET /cards/{id}/invoices`: anteriores (paginadas), aberta e futuras, com estado e totais.
- `GET /invoices/{id}`: itens (com descrição, data, parcela k/n, tipo), totais, pagamentos, diferença com `reported_total`.
- `PATCH /invoices/{id}`: `reported_total`, `closing_date`, `due_date`.
- `POST /invoices/{id}/payments` (Idempotency-Key): `{ occurred_on, sources: [{account_id, amount}], remainder: "NONE" | "CARRY_OVER" | { "installments": N, "installment_amount": V } }`.
- `POST /payment-groups/{id}/void`.
- `POST /cards/{id}/charges` (Idempotency-Key): encargo `{ amount, occurred_on, description }`.
- `POST /cards/{id}/preview`: `{ amount, installments?, occurred_on }` → impacto (seção 5).
- `POST /transactions` aceita `ExpenseIn` com `card_id` (+ `installments`, e `remaining_installments` para parcelada em andamento) no lugar de `account_id` + `payment_method`.
- `GET /entry-hints` passa a trazer os cartões ativos e, nos atalhos de pagamento mais usados, opções de cartão ("Crédito Nubank").
- Erros novos com `code` estável e mensagem em português: `card_archived`, `purchase_before_card_opening` (compra anterior ao início sem ser parcelada em andamento), `invoice_payment_exceeds_balance`, `invoice_installments_below_remainder`, `void_blocked_by_closed_invoice`, `installments_out_of_range`.

## 7. Frontend

Mesma direção visual ("comprovante": papel, tinta, caneta azul, carimbo; livro-caixa) e mesmas regras de texto do subprojeto 1. Princípio pedido pela usuária: **muita informação, mas em camadas** — o essencial à vista, o detalhe atrás de um toque ("Ver mais", "Faturas futuras"), sem tudo jogado na tela.

### Interpretador
- Nomes de cartão são reconhecidos como os de conta (sem acento, sem maiúscula).
- "crédito" ou "cartão" junto do nome → cartão. "pix", "débito" → conta (como hoje).
- **Nome que é de conta e de cartão ao mesmo tempo, sem meio** ("38 ifood nubank") → pendente; o comprovante pergunta "Como você pagou?" com os atalhos mais usados (decidido com a usuária; o atalho "Crédito Nubank" deve ser o primeiro para ela).
- "6x", "em 6x", "6 vezes" → parcelas; implica cartão. Se só há um cartão, ele é escolhido; se há vários, o comprovante pergunta qual.

### Comprovante (cartão de confirmação)
- Para item no cartão, abaixo dos campos: "Fatura de novembro: R$ 1.240,00 → R$ 1.278,00" e "Limite disponível: R$ 398,00 → R$ 360,00", com "Limite não é dinheiro." Números da prévia do backend (`/cards/{id}/preview`), atualizados quando valor, parcelas, data ou cartão mudam.
- Compra parcelada: campo de parcelas e "Ver como ficam as próximas faturas" (abre a lista mês a mês, antes → depois).
- Limite disponível negativo depois da compra: aviso em destaque, sem bloquear.
- Frase depois de gravar: "Despesa registrada: R$ 38,00 em Alimentação, no crédito Nubank. Fatura de novembro: R$ 1.278,00." Parcelada: "… em 6x de R$ 200,00 …".

### Tela inicial
- Abaixo do saldo em contas, uma linha por cartão ativo: "Fatura aberta Nubank R$ 1.440,00", que leva à tela do cartão. Separada visualmente do saldo (não é dinheiro).

### Contas e cartões (`/contas`, título "Contas e cartões")
- Seção de cartões com nome, fatura aberta e limite disponível.
- "Novo cartão" em dois passos: (1) nome, limite, fecha dia, vence dia; (2) início: total da fatura aberta agora, fatura fechada não paga (opcional) e "Parceladas em andamento" (lista: descrição, valor total, parcelas, data da compra, quantas faltam depois da fatura atual; "Adicionar outra"). O passo 2 pode ser pulado e feito depois pela tela do cartão.

### Tela do cartão (`/cartoes/:id`)
- Topo: fatura aberta (total grande, fecha em, vence em), barra de limite (usado/disponível), botão "Pagar fatura" quando houver fatura fechada com saldo devedor (o botão mostra qual: "Pagar fatura de outubro").
- Fatura fechada não paga, quando existir: total calculado, campo "Total no Nubank", diferença e orientação, atalhos "Registrar compra" e "Registrar encargo".
- Seções que abrem por toque: "Faturas futuras" (mês e total garantido), "Compras desta fatura" (com "1 de 6" nas parcelas), "Faturas anteriores" (cada uma abre seus itens e pagamentos).

### Pagar fatura
- Total já preenchido na primeira conta; "Adicionar outra conta" para dividir (ex.: Itaú + poupança). Mostra "Pagando" e "Faltam".
- Se faltar: "O que fazer com os R$ 180,00?" — "Deixar para a próxima fatura", "Parcelar com o Nubank" (número de parcelas e valor de cada uma, como o banco mostra; mostra o total de juros que será registrado) ou nenhum dos dois (pagamento parcial).
- Botão "Registrar pagamento". Mesma regra de chave de idempotência do formulário (mesmo conteúdo, mesma chave).

### Formulário completo e Lançamentos
- Formulário: em despesa, escolher entre conta e cartão; com cartão, campo de parcelas e a mesma prévia do comprovante.
- Lista de lançamentos: compras no cartão mostram o cartão e "6x"; filtro por cartão; pagamentos de fatura aparecem como "Pagamento da fatura de outubro (Nubank)".

## 8. Testes
- Domínio: tabela de casos de ciclo (fechamento antes/depois do vencimento, dia 31, fevereiro, compra no dia do fechamento), divisão de parcelas, mês de consumo da parcela.
- Services: compra à vista/parcelada cria os itens certos; estorno de parcelada cancela futuras e gera crédito; anulação bloqueada por fatura fechada; pagamento com duas origens; restante levado adiante; parcelamento de fatura com juros; anulação de pagamento; limite; edição de dias do cartão; concorrência e idempotência no pagamento (como no subprojeto 1).
- Regra de ouro: testes que somam consumo e caixa de um mês com compra no cartão + pagamento da fatura e verificam que nada conta duas vezes.
- Frontend: interpretador (crédito/cartão, nome ambíguo, "6x"); comprovante com prévia; pagamento com divisão e restante; acessibilidade (axe) das telas novas.
- Início do cartão: total da fatura aberta + parcelada em andamento geram os itens certos, sem contar a parcela do mês duas vezes.
- Smoke ponta a ponta: cadastrar o cartão com fatura aberta e uma parcelada em andamento, registrar "1200 celular crédito nubank 6x", ver a fatura e as futuras, pagar a fatura.

## 9. Segurança e privacidade
Mesmas regras do subprojeto 1: escopo por usuária em todo repositório, Problem Details, CSRF por Origin + `X-Requested-With`, sem corpo de requisição em log, limites de tamanho e de datas.

## 10. Ordem dos subprojetos (atualizada com a usuária em 2026-10-16)
1. Fundação e lançamentos — concluído.
2. **Cartões e faturas** — este documento.
3. **Análise** — gráficos de gasto por categoria e por dia, total por estabelecimento na semana/mês/ano somando todos os meios de pagamento, com filtro (por meio, por cartão). Destino natural na hora de pagar a fatura. Puxado do antigo "Painel" por pedido da usuária.
4. Assistente de IA (registro).
5. Planejamento.
6. Posição financeira e decisão.
7. Painel e PWA completo (o que restar).

## 11. Deixado para quem constrói
- Nomes de módulos, componentes e rotas internas além dos citados.
- Paginação e ordenação exatas das faturas anteriores.
- Forma visual exata das camadas ("ver mais", seções recolhíveis), dentro da direção visual aprovada.
