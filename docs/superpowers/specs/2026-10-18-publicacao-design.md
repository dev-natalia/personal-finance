# Publicação — colocar o app no ar para uso diário

Parte da visão geral (`2026-10-15-visao-geral-design.md`). Antecede o subprojeto de IA: a usuária decidiu (2026-10-18) **usar o app de verdade por algumas semanas antes de decidir se a IA faz falta**, porque o interpretador atual já entende o jeito dela de escrever ("energético crédito nubank 14,30") e ela ainda não usou o app no dia a dia.

## 1. Objetivo

Colocar o app no ar com HTTPS, para a usuária instalar no celular (PWA) e registrar gastos no dia a dia. Ao mesmo tempo, guardar as frases que o app não entendeu de primeira, para basear a decisão sobre a IA em uso real.

### Critérios de sucesso

- A usuária abre o endereço no celular, instala o app e registra um gasto que aparece no saldo e na Análise.
- Cada merge na `main` com as checagens (CI) verdes publica a versão nova sozinho, aplicando as migrações.
- Existe uma cópia diária do banco fora do Fly.io e do Neon, criptografada, e a restauração foi testada uma vez.
- A primeira chamada depois de o banco "dormir" só demora um instante; nunca dá erro.
- Depois de algumas semanas, há uma lista das frases não entendidas para decidir sobre a IA.

## 2. Escopo

### Inclui

- App no **Fly.io**, região São Paulo (`gru`), uma máquina sempre ligada.
- Banco no **Neon**, plano gratuito, na região mais próxima disponível (preferência: AWS São Paulo).
- Endereço gratuito do Fly (`<app>.fly.dev`).
- Publicação automática a partir da `main` (GitHub Actions), só depois de o CI passar.
- Backup próprio diário, criptografado, num armazenamento gratuito fora do Fly.io e do Neon (**Cloudflare R2**), com o app mostrando quando foi o último backup.
- Registro das **frases não entendidas** e uma tela para vê-las.
- Seção "Publicação" no README: como publicar, criar a usuária, restaurar o backup.

### Não inclui (por decisão da usuária)

- IA (fica para depois do período de uso).
- Domínio próprio. Vale comprar só se o app virar um SaaS; o projeto já separa os dados por usuária, então essa porta fica aberta.
- Alta disponibilidade, várias regiões, monitoramento pago.

## 3. Por que esta combinação

Levantamento de custos feito com a usuária (preços de out/2026, a confirmar nas páginas oficiais; dólar a ~R$ 5,08, mais margem do cartão e IOF de 3,5%, ou seja, ~R$ 5,50 por dólar):

| Opção | ~R$/mês |
|---|---|
| AWS (RDS São Paulo + contêiner) | 190–220 |
| Render (app + Postgres) | 72–77 |
| Magalu Cloud (máquina virtual, em reais) | ~35, com o servidor por conta própria |
| **Fly.io + Neon gratuito** | **11–33** |

A usuária escolheu **o mais barato e com menos coisa para manter**: no Fly.io e no Neon, o sistema, o HTTPS e o banco são mantidos por eles. A Magalu cobra em reais, mas exigiria cuidar de um servidor exposto na internet.

Custos aceitos:
- O Neon gratuito "dorme" após 5 minutos sem uso. O primeiro acesso depois disso espera o banco acordar, em geral menos de um segundo.
- O banco gratuito fica acessível pela internet, protegido por senha longa e conexão criptografada; filtro por IP só nos planos pagos.
- As regras de um plano gratuito podem mudar. Daí o backup próprio.

## 4. Como funciona

### App (Fly.io)

- A imagem de produção que já existe (`Dockerfile`) roda sem mudança de código: aplica as migrações ao iniciar (`scripts/start.sh`) e serve API e telas na mesma origem.
- `fly.toml` no repositório:
  - região `gru`;
  - porta interna 8000;
  - HTTPS obrigatório;
  - verificação de saúde em `/api/v1/health`;
  - **uma máquina sempre ligada** (sem desligamento automático: assim só existe a espera do banco, não a do app).
  - Tamanho da máquina a decidir pelo construtor, entre 256 MB e 512 MB, pelo consumo real.
- Variáveis de ambiente:
  - **Variáveis comuns:** `APP_ORIGIN=https://<app>.fly.dev`, `COOKIE_SECURE=true` e `FORWARDED_ALLOW_IPS`. No Fly, o tráfego público sempre passa pelo proxy deles, e a porta da máquina não fica exposta. O construtor confirma na documentação do Fly o valor seguro (o README do projeto proíbe `*` com porta exposta diretamente) e anota a decisão.
  - **Segredos do Fly:** `DATABASE_URL` (do Neon, com `sslmode=require`) e `SECRET_KEY` (aleatória, com 32 caracteres ou mais).
- A usuária é criada com o comando que já existe (`python -m app.cli create-user`), rodado dentro da máquina do Fly. A senha vai como segredo de ambiente, como no `scripts/e2e.sh`, nunca na linha de comando visível.

### Banco (Neon)

- Plano gratuito: 1 GB de armazenamento e uma cota mensal de processamento. O uso de uma pessoa fica muito abaixo das duas.
- **Banco acordando:** o backend já testa a conexão antes de usar (`pool_pre_ping=True` em `app/db.py`), então uma conexão que caiu na pausa é refeita. Um teste deve garantir isso, simulando uma conexão derrubada, para a primeira chamada depois da pausa nunca dar erro.

### Publicação automática

- Um job no GitHub Actions publica no Fly **depois** de o CI existente (`.github/workflows/ci.yml`) passar num push para a `main`. Nunca publica a partir de PR.
- O token do Fly fica como segredo do repositório no GitHub.
- Como a imagem aplica as migrações ao iniciar, publicar é o bastante. Uma migração que falhe impede a máquina nova de ficar saudável, e o Fly mantém a anterior; o construtor confirma esse comportamento.

### Backup próprio

- **Frequência e formato:** uma vez por dia, um `pg_dump` do banco de produção, criptografado com uma chave pública (por exemplo, `age`). A chave privada fica só com a usuária, num gerenciador de senhas, e nunca no repositório, no GitHub ou no Fly.
- **Destino:** Cloudflare R2, plano gratuito de 10 GB.
- **Retenção:** 30 diários e 12 mensais. O construtor ajusta se a cota pedir.
- **Onde roda:** numa máquina agendada do próprio Fly.io (`fly machine run --schedule daily`, mesma imagem ou uma imagem pequena de backup). *(decisão minha)* Assim, a senha do banco nunca sai do Fly: o GitHub guarda só o token de publicação. O backup usa um usuário do Neon só de leitura, criado num dos passos de configuração. Isso também evita o problema do GitHub desativar workflows agendados em repositórios parados.
- **Aviso no app:** ao terminar, o backup grava a data do último sucesso. O app mostra em "Mais" quando foi o último backup e avisa na tela inicial se passar de 2 dias sem backup. *(decisão minha)* É o alerta de falha, sem depender de e-mail nem de serviço externo.
- **Restauração testada uma vez:** baixar o backup, descriptografar, restaurar num banco local e conferir o saldo. O passo a passo vai para o README.

### Frases não entendidas

- **O que é registrado** (*decisão minha*): a frase como foi digitada no registro rápido, **uma vez por frase** (mesmo que ela vire várias compras), com o motivo em forma de lista. Ela é registrada quando:
  - o interpretador **não entende nada** (nenhum item: hoje o envio é ignorado em silêncio). Registra na hora do envio, e a tela passa a dizer "Não entendi essa frase. Tente como '42 mercado pix itaú'." em vez de não fazer nada;
  - o interpretador **deixa algo pendente** (valor, conta ou cartão, meio de pagamento, ambiguidade entre conta e cartão). Registra na hora em que o comprovante abre, mesmo que depois ele seja fechado sem confirmar;
  - a usuária **muda algum campo** do comprovante antes de confirmar (valor, descrição, data, conta ou cartão, meio, parcelas) ou **desmarca** um item. Registra na confirmação.
- **O que não conta:** escolher ou trocar a **categoria**. A categoria é sugerida pela memória de estabelecimentos, não pelo interpretador, e escolhê-la é uso normal, não erro de entendimento.
- **Repetição:** a mesma frase com o mesmo motivo, em menos de 10 minutos, é guardada uma vez só (ex.: abrir, fechar e enviar de novo).
- **Onde se vê:** em "Mais" → "Frases não entendidas", uma lista com a frase, a data e o motivo, do mais recente ao mais antigo, com opção de apagar uma frase e de apagar todas. *(decisão minha)*
- **O que não entra:** o que vem do formulário completo; frases que o interpretador entendeu e que foram confirmadas sem mudança.
- **Privacidade:** as frases ficam no banco da própria usuária e não vão a nenhum serviço externo.

## 5. O que a usuária faz (não pode ser feito por mim)

- Criar as contas no **Fly.io**, no **Neon** e no **Cloudflare** (R2). O Fly pede cartão; o Neon gratuito não pede.
- Colar os tokens e segredos nos lugares indicados: Fly, GitHub e R2.
- Guardar a chave privada do backup no gerenciador de senhas dela.
- Instalar o app no celular.

Cada passo vai num roteiro com comandos prontos, um por vez.

## 6. Testes e verificação

- Teste automático: conexão derrubada é refeita sem erro (a pausa do Neon).
- Testes das frases não entendidas: quando registra (pendência, campo mudado), quando não registra, a lista e apagar.
- Depois de cada publicação, o workflow só confere a saúde (`/api/v1/health`) do endereço publicado; ele não entra na conta nem grava nada. *(decisão minha: um teste automático com login gravaria lançamentos falsos nos dados reais e precisaria da senha dela no GitHub.)*
- Verificação manual uma vez, depois da primeira publicação, feita com a usuária: login, registro de um gasto, saldo e Análise. O gasto de teste é anulado em seguida.
- Backup: uma execução real do workflow e uma restauração testada.
- No celular: instalar o PWA e registrar um gasto.

## 7. Decisões que tomei (a usuária pode mudar)

- Backup diário criptografado no Cloudflare R2, rodando numa máquina agendada do Fly, com usuário do banco só de leitura, retenção de 30 diários e 12 mensais, e aviso no app quando passar de 2 dias sem backup.
- O que conta como "frase não entendida" (nada entendido, pendência, campo mudado ou item desmarcado; categoria não conta), uma vez por frase, sem repetir em 10 minutos, e a lista em "Mais".
- Frase sem nenhum item passa a mostrar "Não entendi essa frase…" em vez de não fazer nada.
- Depois de publicar, só a verificação de saúde automática; o teste com login é manual, uma vez.
- Máquina do Fly sempre ligada, em vez de desligar sozinha.
- Publicação só a partir da `main`, depois do CI.

## 8. Deixado ao construtor

- Tamanho da máquina do Fly (256 ou 512 MB) e o valor exato de `FORWARDED_ALLOW_IPS` no Fly.
- Ferramenta de criptografia (`age` ou `gpg`) e se o backup usa a imagem do app ou uma imagem própria.
- Forma exata da tabela e da API das frases não entendidas.
