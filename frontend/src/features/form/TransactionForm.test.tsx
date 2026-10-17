import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { expect, test, vi } from 'vitest'

import type { TransactionOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { ACCOUNTS, CARDS, CATEGORIES, HINTS, PREVIEW, TODAY, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { FullFormPage } from './FullFormPage'
import { TransactionForm } from './TransactionForm'

interface Sent {
  key: string | null
  body: Record<string, unknown>
}

type Reply = (attempt: number) => Response

const ok = (tx: TransactionOut = transaction()) =>
  HttpResponse.json({ transaction: tx, replayed: false, warnings: [] }, { status: 201 })

function mockApi(reply: Reply = () => ok()) {
  const created: Sent[] = []
  const patched: Record<string, unknown>[] = []
  server.use(
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/categories', () => HttpResponse.json(CATEGORIES)),
    http.post('/api/v1/transactions', async ({ request }) => {
      created.push({
        key: request.headers.get('Idempotency-Key'),
        body: (await request.json()) as Record<string, unknown>,
      })
      return reply(created.length)
    }),
    http.post('/api/v1/cards/:id/preview', () => HttpResponse.json(PREVIEW)),
    http.patch('/api/v1/transactions/:id', async ({ request }) => {
      patched.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ transaction: transaction(), replayed: false, warnings: [] })
    }),
  )
  return { created, patched }
}

function renderForm(initial?: TransactionOut) {
  const onDone = vi.fn()
  const view = renderWithProviders(<TransactionForm initial={initial} onDone={onDone} />)
  return { ...view, onDone, user: userEvent.setup() }
}

async function fillCommon(user: ReturnType<typeof userEvent.setup>, amount: string, description: string) {
  await user.type(screen.getByLabelText('Valor'), amount)
  await user.type(screen.getByLabelText('Descrição'), description)
}

test('creates a transfer between two accounts', async () => {
  const api = mockApi()
  const { user, onDone } = renderForm()
  await user.selectOptions(await screen.findByLabelText('Tipo'), 'Transferência')
  await fillCommon(user, '300', 'Reserva')
  await user.selectOptions(screen.getByLabelText('De'), 'Itaú')
  await user.selectOptions(screen.getByLabelText('Para'), 'Nubank')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.created[0]!.body).toEqual({
    type: 'TRANSFER',
    amount: '300.00',
    occurred_on: TODAY,
    description: 'Reserva',
    account_id: ACCOUNTS.itau.id,
    destination_account_id: ACCOUNTS.nubank.id,
  })
  expect(api.created[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
})

test('transfer requires a destination different from the origin', async () => {
  mockApi(() =>
    HttpResponse.json(
      {
        status: 422,
        code: 'transfer_same_account',
        detail: 'Origem e destino da transferência devem ser contas diferentes.',
      },
      { status: 422 },
    ),
  )
  const { user } = renderForm()
  await user.selectOptions(await screen.findByLabelText('Tipo'), 'Transferência')
  await fillCommon(user, '10', 'Reserva')
  await user.selectOptions(screen.getByLabelText('De'), 'Itaú')
  await user.selectOptions(screen.getByLabelText('Para'), 'Itaú')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Origem e destino da transferência devem ser contas diferentes.',
  )
})

test('creates an income without payment method', async () => {
  const api = mockApi()
  const { user, onDone } = renderForm()
  await user.selectOptions(await screen.findByLabelText('Tipo'), 'Receita')
  await fillCommon(user, '3.000', 'Salário')
  await user.selectOptions(screen.getByLabelText('Recebido em'), 'Itaú')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.created[0]!.body).toEqual({
    type: 'INCOME',
    amount: '3000.00',
    occurred_on: TODAY,
    description: 'Salário',
    account_id: ACCOUNTS.itau.id,
  })
})

test('expense needs a payment method before calling the server', async () => {
  const api = mockApi()
  const { user } = renderForm()
  await fillCommon(await screen.findByLabelText('Valor').then(() => user), '42', 'Mercado')
  await user.selectOptions(screen.getByLabelText('Conta ou cartão'), 'Itaú')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  expect(await screen.findByText('Escolha o meio de pagamento.')).toBeInTheDocument()
  expect(api.created).toEqual([])
})

test('expense sends notes, merchant and the chosen category', async () => {
  const api = mockApi()
  const { user } = renderForm()
  await fillCommon(await screen.findByLabelText('Valor').then(() => user), '42', 'Remédio')
  await user.type(screen.getByLabelText('Estabelecimento (opcional)'), 'Drogasil')
  await user.type(screen.getByLabelText('Notas (opcional)'), 'receita do médico')
  await user.selectOptions(screen.getByLabelText('Conta ou cartão'), 'Itaú')
  await user.selectOptions(screen.getByLabelText('Meio'), 'Pix')
  await user.selectOptions(screen.getByLabelText('Categoria'), 'Saúde')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await waitFor(() => expect(api.created).toHaveLength(1))
  expect(api.created[0]!.body).toMatchObject({
    type: 'EXPENSE',
    merchant: 'Drogasil',
    notes: 'receita do médico',
    payment_method: 'PIX',
    category_id: 'cat-saude',
  })
})

test('changing the type drops a category of the other kind', async () => {
  const api = mockApi()
  const { user, onDone } = renderForm()
  await screen.findByRole('option', { name: 'Saúde' })
  await user.selectOptions(screen.getByLabelText('Categoria'), 'Saúde')
  await user.selectOptions(screen.getByLabelText('Tipo'), 'Receita')
  expect(screen.getByLabelText('Categoria')).toHaveDisplayValue('Sugestão automática')
  await fillCommon(user, '100', 'Reembolso do plano')
  await user.selectOptions(screen.getByLabelText('Recebido em'), 'Itaú')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.created[0]!.body).not.toHaveProperty('category_id')
})

test('editing sends only changed fields', async () => {
  const api = mockApi()
  const { user, onDone } = renderForm(transaction())
  expect(screen.queryByLabelText('Tipo')).not.toBeInTheDocument()
  await user.type(await screen.findByLabelText('Notas (opcional)'), 'dividido com a Bia')
  await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.patched).toEqual([{ notes: 'dividido com a Bia' }])
})

test('retry reuses the form idempotency key', async () => {
  const api = mockApi((attempt) => (attempt === 1 ? HttpResponse.error() : ok()))
  const { user, onDone } = renderForm()
  await user.selectOptions(await screen.findByLabelText('Tipo'), 'Receita')
  await fillCommon(user, '10', 'Pix da Bia')
  await user.selectOptions(screen.getByLabelText('Recebido em'), 'Itaú')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.created[1]!.key).toBe(api.created[0]!.key)
})

test('changing the entry after a failure uses a new key', async () => {
  const api = mockApi((attempt) => (attempt === 1 ? HttpResponse.error() : ok()))
  const { user, onDone } = renderForm()
  await user.selectOptions(await screen.findByLabelText('Tipo'), 'Receita')
  await fillCommon(user, '10', 'Pix da Bia')
  await user.selectOptions(screen.getByLabelText('Recebido em'), 'Itaú')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await screen.findByRole('alert')
  await user.type(screen.getByLabelText('Valor'), '0')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.created[1]!.body).toMatchObject({ amount: '100.00' })
  expect(api.created[1]!.key).not.toBe(api.created[0]!.key)
})

test('form has no accessibility violations', async () => {
  mockApi()
  const { container } = renderForm()
  await screen.findAllByRole('option', { name: 'Saúde' })
  await expectNoA11yViolations(container)
})

test('account method choices never offer credit', async () => {
  mockApi()
  renderForm()
  const method = await screen.findByLabelText('Meio')
  const labels = Array.from(method.querySelectorAll('option')).map((o) => o.textContent)
  expect(labels).not.toContain('Crédito')
  expect(labels).toContain('Pix')
})

test('full form sends a card purchase with installments', async () => {
  const api = mockApi()
  const { user, onDone } = renderForm()
  await fillCommon(await screen.findByLabelText('Valor').then(() => user), '1.200', 'celular')
  await user.selectOptions(screen.getByLabelText('Conta ou cartão'), 'Crédito Nubank')
  expect(screen.queryByLabelText('Meio')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Parcelas'), '6x')
  expect(await screen.findByText('Limite não é dinheiro.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.created[0]!.body).toEqual({
    type: 'EXPENSE',
    amount: '1200.00',
    occurred_on: TODAY,
    description: 'celular',
    card_id: CARDS.nubank.id,
    installments: 6,
  })
})

test('full form reads card and date from the URL', async () => {
  mockApi()
  renderWithProviders(
    <Routes>
      <Route path="/lancamentos/novo" element={<FullFormPage />} />
    </Routes>,
    { route: `/lancamentos/novo?card=${CARDS.nubank.id}&date=2026-10-02` },
  )
  const form = await screen.findByRole('form', { name: 'Novo lançamento' })
  await waitFor(() =>
    expect(within(form).getByLabelText('Conta ou cartão')).toHaveDisplayValue('Crédito Nubank'),
  )
  expect(within(form).getByLabelText('Data')).toHaveValue('2026-10-02')
  expect(within(form).getByLabelText('Parcelas')).toBeInTheDocument()
})

test('editing a card purchase has no account field', async () => {
  const api = mockApi()
  const purchase = transaction({
    account_id: null,
    payment_method: null,
    card_id: CARDS.nubank.id,
    installments: 6,
    amount: '1200.00',
    description: 'celular',
  })
  const { user, onDone } = renderForm(purchase)
  const card = await screen.findByLabelText('Cartão')
  await waitFor(() => expect(card).toHaveDisplayValue('Crédito Nubank'))
  expect(screen.queryByLabelText('Conta')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Meio')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Parcelas'), '10x')
  await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(api.patched).toEqual([{ installments: 10 }])
})

test('closed invoice block on edit shows the server message', async () => {
  mockApi()
  server.use(
    http.patch('/api/v1/transactions/:id', () =>
      HttpResponse.json(
        {
          status: 409,
          code: 'void_blocked_by_closed_invoice',
          detail: 'Esta compra já está em fatura fechada. Registre um estorno.',
        },
        { status: 409 },
      ),
    ),
  )
  const purchase = transaction({
    account_id: null,
    payment_method: null,
    card_id: CARDS.nubank.id,
    description: 'celular',
  })
  const { user } = renderForm(purchase)
  await user.type(await screen.findByLabelText('Notas (opcional)'), 'x')
  await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Esta compra já está em fatura fechada. Registre um estorno.',
  )
})
