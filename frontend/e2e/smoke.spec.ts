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

  await expect(page.getByText(/^Despesa registrada: R\$ 42,00/)).toBeVisible()
  await expect(page.getByText('R$ 958,00')).toBeVisible()
})
