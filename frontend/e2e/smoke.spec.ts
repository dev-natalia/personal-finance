import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

test('login, record a phrase and see the balance', async ({ page }) => {
  test.skip(!email || !password, 'Defina E2E_EMAIL e E2E_PASSWORD (ou use scripts/e2e.sh).')

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(password!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeAttached()
  // PWA: o service worker da imagem de produção precisa registrar (CSP, tipo do arquivo, escopo).
  const swActive = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active)
  expect(swActive).toBe(true)

  await page.getByRole('link', { name: 'Contas' }).click()
  const form = page.getByRole('form', { name: 'Nova conta' })
  await form.getByLabel('Nome').fill('Itaú')
  await form.getByLabel('Saldo de abertura').fill('1.000,00')
  await form.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByRole('status')).toHaveText('Conta Itaú criada.')

  await page.getByRole('link', { name: 'Início' }).click()
  await page.getByRole('textbox', { name: 'Novo lançamento' }).fill('42 mercado pix itaú')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await page.getByRole('button', { name: 'Confirmar' }).click()

  // O comprovante mostra a frase até fechar; o registro que fica é a lista da sessão.
  const session = page.getByTestId('session-entries')
  await expect(session.getByText(/^Despesa registrada: R\$ 42,00/)).toBeVisible()
  await expect(page.getByText('R$ 958,00')).toBeVisible()
})

/** "AAAA-MM-DD" de uma data local. */
function iso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

test('card: opening, installment purchase and payment', async ({ page }) => {
  test.skip(!email || !password, 'Defina E2E_EMAIL e E2E_PASSWORD (ou use scripts/e2e.sh).')
  const today = new Date()
  // Fecha dia 3, vence dia 10: a fatura fechada sem pagar é a que venceu (ou vence) no dia 10
  // anterior à fatura aberta.
  const closedDue = new Date(today.getFullYear(), today.getMonth() - (today.getDate() >= 3 ? 0 : 1), 10)
  const purchasedOn = new Date(today.getFullYear(), today.getMonth() - 4, 15)

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(password!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeAttached()

  await page.getByRole('link', { name: 'Contas' }).click()
  const account = page.getByRole('form', { name: 'Nova conta' })
  await account.getByLabel('Nome').fill('Bradesco')
  await account.getByLabel('Saldo de abertura').fill('5.000,00')
  await account.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByRole('status')).toHaveText('Conta Bradesco criada.')

  await page.getByRole('link', { name: 'Cartões' }).click()
  await page.getByRole('link', { name: '+ Adicionar cartão' }).click()
  await page.getByLabel('Nome do cartão').fill('Nubank')
  await page.getByLabel('Limite').fill('11.000')
  await page.getByLabel('Fecha no dia').selectOption('3')
  await page.getByLabel('Vence no dia').selectOption('10')
  await page.getByLabel(/^Total da fatura .*aberta agora/).fill('1.240')
  await page.getByLabel('Tem fatura fechada sem pagar').check()
  await page.getByLabel(/^Total da fatura .*fechada/).fill('2.300')
  await page.getByLabel('Vencimento da fatura fechada').fill(iso(closedDue))
  await page.getByRole('button', { name: 'Adicionar parcelada em andamento' }).click()
  const line = page.getByRole('group', { name: 'Parcelada 1' })
  await line.getByLabel('Descrição').fill('notebook')
  await line.getByLabel('Valor total').fill('6.000')
  await line.getByLabel('Parcelas').selectOption('10')
  await line.getByLabel('Data da compra').fill(iso(purchasedOn))
  await line.getByLabel(/^Quantas faltam depois da fatura/).selectOption('2')
  await page.getByRole('button', { name: 'Criar cartão' }).click()
  // Enquanto envia as parceladas, o formulário mostra o próprio aviso; o da tela vem ao final.
  await expect(page.getByRole('status').filter({ hasText: 'Cartão Nubank criado.' })).toBeVisible()

  await page.getByRole('link', { name: 'Início' }).click()
  await expect(page.getByRole('link', { name: /^Fatura aberta Nubank/ })).toContainText('R$ 1.240,00')
  await page.getByRole('textbox', { name: 'Novo lançamento' }).fill('1200 celular crédito nubank 6x')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText('Limite não é dinheiro.')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(
    page.getByTestId('session-entries').getByText(/^Despesa registrada: R\$ 1\.200,00/),
  ).toBeVisible()

  await page.getByRole('link', { name: /^Fatura aberta Nubank/ }).click()
  await expect(page.getByRole('heading', { name: 'Nubank' })).toBeVisible()
  await expect(page.getByText(/^Fatura de \S+, aberta$/)).toBeVisible()
  await page.getByText('Faturas futuras').click()
  await expect(page.getByRole('list', { name: 'Faturas futuras' }).getByRole('listitem')).toHaveCount(5)

  await page.getByRole('button', { name: /^Pagar fatura de / }).click()
  const payment = page.getByRole('form', { name: /^Pagar fatura de / })
  await payment.getByLabel('Conta').selectOption({ label: 'Bradesco' })
  await expect(payment.getByLabel('Valor')).toHaveValue('2.300,00')
  await payment.getByRole('button', { name: 'Registrar pagamento' }).click()
  await expect(page.getByRole('status')).toHaveText('Pagamento registrado.')
  await expect(page.getByRole('button', { name: /^Pagar fatura de / })).toHaveCount(0)
})

test('analysis: month by category and place', async ({ page }) => {
  test.skip(!email || !password, 'Defina E2E_EMAIL e E2E_PASSWORD (ou use scripts/e2e.sh).')

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(password!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeAttached()

  await page.getByRole('link', { name: 'Contas' }).click()
  const account = page.getByRole('form', { name: 'Nova conta' })
  await account.getByLabel('Nome').fill('Inter')
  await account.getByLabel('Saldo de abertura').fill('500,00')
  await account.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Conta Inter criada.' })).toBeVisible()

  await page.getByRole('link', { name: 'Início' }).click()
  await page.getByRole('textbox', { name: 'Novo lançamento' }).fill('38 ifood pix inter')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(
    page.getByTestId('session-entries').getByText(/^Despesa registrada: R\$ 38,00/),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Análise' }).click()
  await expect(page.getByRole('heading', { name: 'Análise' })).toBeVisible()
  await expect(page.getByText(/^Gasto em /)).toBeVisible()
  await expect(page.getByRole('list', { name: 'Em que você gastou' })).toBeVisible()
  const ranking = page.getByRole('list', { name: 'Onde você mais gastou' })
  await expect(ranking.getByRole('link', { name: 'ifood' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Seus dias' })).toBeVisible()

  await ranking.getByRole('link', { name: 'ifood' }).click()
  await expect(page.getByRole('heading', { name: 'ifood' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Totais do lugar' }).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByRole('region', { name: 'Compras' }).getByText('−38,00')).toBeVisible()
})
