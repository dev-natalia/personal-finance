# Subprojeto 3 — Análise

Parte da visão geral (`2026-10-15-visao-geral-design.md`, seção 7, item 3) e do que existe na `main` após os subprojetos 1 (fundação e lançamentos) e 2 (cartões e faturas, `2026-10-16-cartoes-e-faturas-design.md`).

## 1. Objetivo

Hoje, para saber "onde mais gastei", a usuária abre os lançamentos um por um e soma de cabeça; falta uma visão geral. A Análise mostra, de cara, **em que** o dinheiro foi (tipo de gasto) e **onde** (o lugar: iFood, Mercado Livre…), somando todos os meios de pagamento, e deixa ver os dias de mais e menos gasto.

O uso é **só enxergar**: ela não pretende agir sobre metas a partir daqui ("só enxergar mesmo"). Vai abrir a tela **com frequência**, não só no fim do mês.

### Critérios de sucesso

- Ao abrir, sem escolher nada, ela vê o total gasto no mês até hoje e a divisão por tipo de gasto.
- Em um toque a mais, vê quanto gastou num lugar na semana, no mês e no ano, e todas as compras de lá.
- Os números batem com o resto do app: o total do mês no modo "pelas parcelas" é o mesmo consumo do mês que o backend já calcula (`ledger.month_summary`).
- A tela é enxuta: nada de funcionalidade que não será usada (pedido explícito dela).

## 2. Escopo

### Inclui

- Aba **Análise** na navegação principal.
- Tela principal com: total do período, rosca por tipo de gasto (categoria), ranking de lugares, calendário de dias.
- Períodos **Mês**, **Semana** e **Ano**, com navegação para o anterior e o seguinte.
- Chave **Pelas parcelas / Pela compra** (seção 3).
- Filtro por **cartão ou conta**; filtro por **categoria** tocando na fatia da rosca.
- Tela de um lugar: semana, mês e ano lado a lado, média por compra, lista de compras com filtro por cartão ou conta.
- Toque num dia do calendário mostra o que foi gasto nele.

### Não inclui (anti-objetivos)

- Metas, orçamentos, limites de gasto, alertas: são do subprojeto Planejamento.
- Comparação com o mês anterior, tendências, previsões.
- Intervalo de datas livre, várias categorias ao mesmo tempo, filtros combinados complexos, exportação.
- Receitas: a Análise é só de gastos.
- Gráficos de evolução mês a mês na tela do lugar (opção mostrada e não escolhida).

## 3. Regras: o que conta e como

### O que é "gasto" aqui

As mesmas regras do consumo do mês (`ledger.month_summary`, regra de ouro do subprojeto 2):

- Despesas via conta e compras no cartão; encargos do cartão (juros, IOF, multa).
- Estornos **abatem** do lugar e da categoria da compra original (via conta e no cartão; no cartão, sem o valor das parcelas que o estorno cancelou, porque parcela cancelada já deixa de contar no próprio mês).
- **Nunca entram**: receitas, transferências entre contas, pagamentos de fatura, saldos iniciais e levados adiante da fatura, lançamentos anulados.

### Os dois modos (escolha da usuária: "ver os dois")

- **Pelas parcelas** (padrão; escolha da usuária): cada parcela conta no seu mês de consumo (A3). Celular de R$ 1.200 em 6x comprado em outubro: R$ 200 em outubro, R$ 200 em novembro… Compra à vista conta pela data.
- **Pela compra**: o valor inteiro na data da compra. O mesmo celular: R$ 1.200 em outubro.

Em ambos os modos, encargos e estornos contam pela data.

No modo "pelas parcelas", uma parcela não tem dia (só mês de consumo). Para o calendário, a semana e a lista de um dia, a parcela k cai **no mesmo dia do mês da compra**, no mês de consumo (compra em 15/10 → parcelas em 15/11, 15/12…; dia inexistente vira o último dia do mês, como A7). *(Decisão minha; ver seção 8.)*

### Períodos

- **Mês**: do dia 1 ao último dia. O mês atual mostra **tudo o que já está registrado para ele**, inclusive parcelas deste mês e lançamentos com data futura — por isso o título é "Gasto em outubro", não "até hoje" *(decisão minha: assim o total é sempre igual ao consumo do mês do backend e as parcelas que já pesam no mês aparecem)*.
- **Semana**: de segunda a domingo *(decisão minha)*, com a mesma regra (tudo o que está registrado para a semana).
- **Ano**: de janeiro a dezembro; no ano atual, até o fim do **mês atual** (meses seguintes, inclusive parcelas que ainda vão cair, ficam de fora) *(decisão minha)*.
- "Hoje" é o dia local da usuária (o mesmo `today` que o backend já usa).
- Setas para o período anterior e o seguinte; não há período depois do atual.

### Parceladas que já corriam antes do cartão (`remaining_installments`)

- **Pelas parcelas**: só as parcelas que o app acompanha (as que faltavam), cada uma no seu mês, como qualquer parcela.
- **Pela compra**: o valor inteiro na data da compra, mesmo que seja antes do início do cartão — é o que "pela compra" significa *(decisão minha)*. Por isso os dois modos podem dar totais diferentes em meses antigos; é esperado.

### Número de compras e média

- **Número de compras** = quantos lançamentos de gasto (compra, despesa ou encargo) contribuem para o período. No modo "pelas parcelas", uma compra parcelada conta uma vez em cada mês em que tem parcela; estornos não mudam a contagem *(decisão minha)*.
- **Média por compra** (tela do lugar) = valor médio das compras **como foram registradas** no ano (valor da compra, não da parcela), independente do modo *(decisão minha)*.

### Lugar

- O "lugar" é o **estabelecimento** (`merchants`) do lançamento; o estorno usa o lugar da compra original.
- Lançamento sem estabelecimento (ex.: encargo "IOF") aparece pelo **nome digitado** (descrição), agrupando descrições iguais; toca e abre como qualquer lugar *(decisão minha)*.
- A categoria mostrada ao lado do lugar é a categoria mais frequente dos lançamentos dele no período *(decisão minha)*.

### Filtros

- **Cartão ou conta**: um só por vez ("só o que passou no Nubank"). Lista os cartões e contas da usuária, inclusive arquivados que tenham gasto no período.
- **Categoria**: tocar numa fatia da rosca filtra o ranking de lugares e o calendário por ela; tocar de novo (ou "Limpar") desfaz.
- Filtros e período ficam na URL, como em Lançamentos (voltar e recarregar mantém a vista).

## 4. Telas

### Análise (`/analise`) — nova aba "Análise" na barra de baixo

Ordem escolhida pela usuária (opção C nos esboços: visão geral primeiro), de cima para baixo:

1. **Total do período** em destaque ("Gasto em outubro — R$ 4.380,00"), período (Mês | Semana | Ano) com setas, chave "Pelas parcelas / Pela compra", e "Filtros" (cartão ou conta).
2. **Em que você gastou**: rosca por categoria com legenda (nome e valor de cada uma). Categorias pequenas podem se juntar em "Outras" *(construtor decide o corte; ver seção 9)*. Tocar numa fatia filtra (seção 3).
3. **Onde você mais gastou**: ranking de lugares, do maior para o menor, cada linha com nome, valor, barra proporcional, número de compras e categoria. Mostra os primeiros (ex.: 5) e "Ver todos os N lugares". Tocar abre a tela do lugar.
4. **Seus dias**: calendário do período (no Ano, por mês em vez de por dia), mais escuro onde gastou mais; destaca o dia mais caro e os dias sem gasto. Tocar num dia lista o que foi gasto nele (lugar, valor, meio).

Período sem gasto: uma linha ("Nenhum gasto em outubro até agora.") no lugar dos gráficos, sem gráficos vazios.

### Lugar (`/analise/lugar/:id`) — opção A escolhida pela usuária

- Nome do lugar e categoria.
- Três caixas lado a lado: **esta semana**, **este mês**, **este ano** — valor e número de compras em cada (sempre os períodos atuais, independentes do período da tela anterior).
- Média por compra (do ano).
- **Compras**: lista por dia, mais recente primeiro, com meio (ex.: "crédito Nubank", "Pix Itaú") e valor; chips para filtrar por cartão ou conta. Mostra todas as compras do lugar, com paginação.
- Respeita a chave "Pelas parcelas / Pela compra" vinda da tela principal nas três caixas; a lista mostra as compras como foram registradas (valor da compra, com "em 6x" quando parcelada).

### Ligação com o resto do app

- Na tela do cartão, um link "Ver análise deste cartão" abre `/analise` já filtrada pelo cartão (a spec do subprojeto 2 cita a Análise como destino natural na hora de pagar a fatura) *(decisão minha)*.

## 5. Visual e acessibilidade

- Segue a direção visual "comprovante" já aprovada (papel, tinta, caneta azul, carimbo; fonte Recursive) e os componentes existentes (`Page`, estilos de `ui/styles.ts`).
- Celular primeiro; sem rolagem horizontal em 375px.
- Gráficos com alternativa em texto: a rosca e o calendário têm os mesmos números em lista/tabela acessível (leitor de tela não depende do desenho); cor nunca é a única informação.
- Mesmo padrão de foco e anúncios das telas novas do subprojeto 2.

## 6. Dados e API (backend)

Novos endpoints de leitura em `/api/v1/analysis/*` (mesmo padrão de autenticação, erros e datas). Nenhuma tabela nova; nenhuma escrita.

- `GET /analysis/summary?period=month|week|year&date=AAAA-MM-DD&mode=installments|purchase&source=account:<id>|card:<id>&category_id=`
  → período resolvido (início, fim efetivo — até hoje no atual), total, por categoria (id, nome, valor), por lugar (id ou descrição, nome, valor, número de compras, categoria principal), por dia (ou por mês, no ano).
- `GET /analysis/day?date=&mode=&source=&category_id=` → os gastos do dia.
- `GET /analysis/places/{id}?mode=&source=` → semana, mês e ano atuais (valor e número de compras), média por compra; e a lista paginada de compras do lugar (mesmo formato de `TransactionOut`).
- Lugar sem estabelecimento é identificado pela descrição (o construtor escolhe a forma: chave na URL ou endpoint separado).
- Dinheiro como string canônica, como no resto da API; o frontend **não soma** valores para compor totais (regra dos subprojetos anteriores) — todos os totais vêm prontos do backend.
- O total do mês no modo "pelas parcelas", sem filtros, deve ser **igual** a `month_summary(...).consumption_total` (inclusive no mês atual, já que o mês não corta em hoje); a implementação reaproveita (ou generaliza) a mesma consulta, para não existirem duas regras de consumo.
- Estornos já herdam categoria e estabelecimento da compra original (`services/transactions.py`), então abatem do lugar e da categoria certos sem trabalho extra.

## 7. Testes que importam

- Mesmo total que `month_summary` no modo "pelas parcelas", inclusive no mês atual.
- Parcelada: R$ 200 por mês no modo parcelas e R$ 1.200 no mês da compra no modo compra; parcela no dia equivalente do mês.
- Estorno abate do lugar e da categoria originais; parcela cancelada por estorno não conta duas vezes.
- Pagamento de fatura, transferência, receita e anulados nunca aparecem.
- Semana de segunda a domingo; ano atual até o fim do mês atual (sem parcelas de meses seguintes).
- Parcelada em andamento: só as parcelas acompanhadas no modo parcelas; valor inteiro na data da compra no modo compra.
- Número de compras e média por compra conforme a seção 3.
- Filtro por cartão/conta e por categoria.
- Lugar sem estabelecimento agrupado pela descrição.
- Período vazio mostra a linha de "nenhum gasto".
- Acessibilidade (axe) nas telas novas; números dos gráficos também em texto.

## 8. Decisões que tomei (a usuária pode mudar)

- A Análise é uma aba própria na barra de baixo (ela vai abrir com frequência).
- Semana de segunda a domingo.
- O mês e a semana atuais mostram tudo o que já está registrado para eles (não cortam em hoje); o ano atual vai até o fim do mês atual.
- Parcelada que já corria antes do cartão: valor inteiro na data da compra no modo "pela compra".
- Número de compras conta a compra parcelada em cada mês com parcela; média por compra usa o valor registrado da compra.
- Parcela no calendário cai no mesmo dia do mês da compra.
- Lançamento sem estabelecimento aparece pela descrição.
- Categoria do lugar = a mais frequente no período.
- Link "Ver análise deste cartão" na tela do cartão.
- Tela do lugar com os períodos atuais (não os da tela anterior).

## 9. Deixado ao construtor

- Biblioteca de gráficos (ou SVG feito à mão) — leve, acessível, funcionando no PWA offline-first sem CDN.
- Quantos lugares mostrar antes de "Ver todos" e o corte de "Outras" na rosca.
- Escala de cor do calendário (sem depender só da cor).
- Forma exata das respostas da API, desde que totais venham prontos do backend.
