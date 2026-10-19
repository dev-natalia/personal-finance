# Ajustes de uso — rodada 1

Primeira rodada de ajustes vinda do **uso real** do app publicado (`caderno-de-gastos.fly.dev`), a partir dos comentários da usuária em 2026-10-19. Ela abre o app no celular para **anotar rápido o que comprou** e, quando tem tempo, usa as outras telas. Os comentários apontam telas poluídas, repetidas ou parecidas demais entre si, e controles pouco claros.

Os esboços aprovados estão em `.superpowers/brainstorm/632-1792391846/content/` (fora do git): `inicio-e-barra.html` (opção B), `contas-e-cartoes.html` (janela A) e `filtros-e-analise.html`. As descrições abaixo bastam para construir.

Mesma direção visual de sempre: o "comprovante" (papel, tinta, caneta azul, carimbo; livro-caixa), a fonte Recursive e os tokens de cor de `frontend/src/index.css`. Também seguem valendo as regras de texto e acessibilidade dos subprojetos anteriores. Esta rodada mexe **só no frontend**: o backend já fornece tudo o que as telas usam.

## 1. Objetivo e critérios de sucesso

- A tela inicial serve para uma coisa: chegar e digitar o que comprou. Ela não repete a tela de Lançamentos.
- Cada aba tem um papel claro: Início, Lançamentos, Análise, **Contas**, **Cartões** e Mais.
- Os controles dizem o que fazem: o formulário completo é um botão de verdade, e a escolha "pela parcela / pela compra" se explica sozinha.
- Nada do que existe hoje se perde. Muda o lugar ou a forma, não a função.

## 2. Escopo

### 2.1 Barra de navegação (decisão da usuária: opção "B" dos esboços)

- **Celular:** seis itens, com **ícone em cima e nome pequeno embaixo**: Início, Lançam., Análise, Contas, **Cartões** e Mais.
  - "Lançamentos" aparece abreviado como **"Lançam."** só na barra. O título da tela continua "Lançamentos".
  - O item ativo fica destacado na cor caneta, como hoje.
  - Os seis itens precisam caber de 320 px de largura em diante, também com a letra do sistema aumentada (até 130%). É o mesmo cuidado da correção recente da barra (PR #6).
- **Computador (md+):** a barra lateral continua, com os **nomes completos** e com ícone opcional.
- *Decisão minha:* ícones simples desenhados em SVG no próprio projeto, sem biblioteca nova. São decorativos (`aria-hidden`); o nome continua sendo o rótulo acessível.

### 2.2 Tela inicial

- **Topo:** o saldo em contas, que continua sendo o maior texto da tela. Abaixo dele, uma linha por cartão com a **fatura aberta** e o **limite livre**.
  - O limite livre vem de `CardSummaryOut.limit`, que já existe.
  - Cada linha leva à tela do cartão, como hoje.
- **Sai da tela:** a linha do tempo com os lançamentos (`Timeline`). O lugar dela é a aba Lançamentos.
- **O que você acabou de registrar:** continua aparecendo só a confirmação de cada registro desta visita (por exemplo, "Despesa registrada: R$ 42,00 em Mercado…", com os avisos dele).
  - Some ao sair da tela. Não é histórico.
  - *Decisão minha, aprovada na conversa:* existe para a usuária saber que gravou sem precisar ir a Lançamentos.
- **Tela sem registro nesta visita:** mostra uma frase curta no espaço livre, como "O que você comprou?". *Decisão minha.*
- **Campo de digitar:** continua embaixo, no mesmo lugar e com o mesmo comportamento.
- **Formulário completo:** passa a ser um **botão** de largura cheia logo abaixo do campo, num tom **mais escuro que o fundo** (como o botão secundário dos esboços), com o texto "Formulário completo".
- **Continuam como estão:** o comprovante de confirmação, a dica "Não entendi essa frase…", o aviso de backup atrasado e o aviso de sem conexão.

### 2.3 Contas (aba própria)

- **Título:** "Contas" (hoje é "Contas e cartões"). O total em contas fica no alto, com o valor em contas arquivadas abaixo dele quando houver, como hoje.
- **Adicionar conta:** botão **"+ Adicionar conta"** no alto. Ele abre uma **janela que sobe de baixo, por cima da lista**. É a decisão da usuária (opção "A" dos esboços).
  - A janela traz os mesmos campos do formulário atual de nova conta.
  - Ao criar, a janela fecha e a conta aparece na lista com a mensagem de confirmação.
  - "Cancelar" e Esc fecham sem criar.
  - O foco vai para a janela ao abrir e volta ao botão ao fechar.
- **Lista:** as contas ficam num **bloco branco**, cada linha com nome, tipo e saldo.
  - Um toque na conta abre as opções dela, que são as ações que já existem hoje: **Editar** (nome e tipo) e **Arquivar**. Nenhuma ação nova.
  - *Decisão minha:* a mesma janela de baixo, para manter o padrão.
- **Arquivadas:** a seção "Contas arquivadas" continua recolhida no fim, com desarquivar.
- **Some do meio da página:** o formulário "Nova conta" que fica sempre aberto.

### 2.4 Cartões (aba própria, nova)

- **Endereço:** nova tela `/cartoes`, com o título "Cartões". O conteúdo sai da seção de cartões que hoje fica dentro de Contas.
- **Cada cartão vira um bloco destacado:** branco, com sombra leve, um pouco mais "cartão" que as linhas de conta. O bloco mostra:
  - o nome;
  - a fatura aberta (mês e total);
  - as datas de fechamento e vencimento;
  - uma **barra do limite usado**;
  - "Limite livre R$ X de R$ Y";
  - se houver fatura fechada a pagar, quanto falta pagar e o vencimento, em destaque (cor carimbo).
    - *Decisão minha:* usa `payable.balance` (o que falta depois de pagamento parcial), como a tela do cartão já faz no "Falta pagar".
- **Toque no bloco:** abre a tela do cartão (`/cartoes/:id`), que não muda. O link de voltar dessa tela passa a levar a Cartões.
- **Adicionar cartão:** botão **"+ Adicionar cartão"** no alto, que leva a uma **página própria** com o formulário de cadastro atual, em dois passos. *Decisão minha:* página e não janela, porque o formulário é longo. A usuária viu isso nos esboços e aprovou.
- **Arquivados:** a seção "Cartões arquivados" fica recolhida no fim, como hoje.
- **Mensagens entre telas:** as mensagens que hoje voltam para Contas ao arquivar um cartão (por exemplo, o aviso de saldo) passam a voltar para Cartões.

### 2.5 Lançamentos

- **Filtros:** ficam num **bloco branco destacado**, separado da lista.
- **"Conta ou cartão":** um campo só no lugar de "Conta" e "Cartão". Ele lista as contas e os cartões, os arquivados inclusive, como o filtro da Análise.
  - Escolher uma conta filtra por `account_id`; escolher um cartão filtra por `card_id`. Nunca os dois.
  - O valor fica na URL, como os outros filtros.
    - *Decisão minha:* no mesmo formato da Análise (`source=account:<id>` ou `source=card:<id>`), para as duas telas montarem links do mesmo jeito.
  - Links antigos com `account_id` ou `card_id` continuam funcionando.
- **Continuam iguais:** De, Até, Categoria, Tipo, Situação, a lista agrupada por dia e o "Carregar mais".
- **Paginação:** a usuária ficou satisfeita com a atual (50 por vez e "Carregar mais"), então não há recorte por mês nesta rodada.

### 2.6 Análise

- **Período e contagem:** no lugar dos botões, duas **listas suspensas**:
  - **"Período":** Semana, Mês e Ano, nessa ordem. Mês continua sendo o padrão.
  - **"Compras parceladas":** "Uma parcela por mês" (o padrão, que hoje se chama "Pelas parcelas") e "Valor total no dia da compra" (hoje "Pela compra").
- **Bloco destacado:** as duas listas e o filtro "Conta ou cartão" que já existe ficam juntos num bloco branco, como em Lançamentos.
- **Continuam iguais:** as setas para o período anterior ou seguinte, os valores na URL e todo o resto da tela.

### 2.7 Categorias: o "Essencial"

- A marcação **fica**. É decisão da usuária, porque ela vai ser usada na etapa de Planejamento.
- *Decisão minha:* uma linha de explicação na tela de Categorias, perto da primeira marcação, por exemplo: "Essencial: gastos que o planejamento vai reservar primeiro (moradia, contas, saúde)." Assim a opção deixa de ser um mistério enquanto ainda não tem efeito.

## 3. Não inclui

- Mudança de backend, de regra de negócio ou de dados.
- Recorte de Lançamentos por mês ou ano, e escolha de anos anteriores. A paginação atual basta por enquanto.
- Mudanças na tela do cartão, no formulário completo (fora o botão que leva a ele) ou no comprovante.
- Nova direção visual. Esta rodada organiza; não muda a identidade do app.

## 4. Testes e verificação

- **Testes de tela atualizados para a nova estrutura:**
  - a tela inicial sem a lista;
  - as rotas `/cartoes` e a de novo cartão;
  - a janela de nova conta (abrir, criar, cancelar, foco);
  - o filtro único de conta ou cartão (vai para a URL e chama a API com o parâmetro certo);
  - as listas da Análise.
- **Acessibilidade:** axe sem violações nas telas novas e alteradas.
- **E2E:** o `scripts/e2e.sh` continua verde, ajustado aos novos caminhos.
- **No navegador (ambiente de teste, nunca os dados reais):** celular de 320 e 360 px com letra aumentada (a barra inteira cabe) e computador.
- **Depois do merge:** a usuária confere no celular.

## 5. Deixado ao construtor

- O desenho exato dos ícones e o espaçamento da barra.
- Como a janela de baixo é construída (por exemplo, `<dialog>`), desde que tenha foco preso, Esc fecha e o fundo escurece.
- O endereço da página de novo cartão (por exemplo, `/cartoes/novo`).
- A divisão do trabalho em tarefas e PRs.
