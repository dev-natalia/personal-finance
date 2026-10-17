import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { expect, test } from 'vitest'

import type { TransactionOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { ACCOUNTS, CARDS, CATEGORIES, HINTS, TODAY, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { TransactionsPage } from './TransactionsPage'

const MERCADO = transaction({ id: 'tx-mercado', description: 'mercado' })
const SALARIO = transaction({
  id: 'tx-salario',
  type: 'INCOME',
  amount: '3000.00',
  description: 'salário',
  category_id: 'cat-salario',
  payment_method: null,
  occurred_on: '2026-10-05',
})
const UBER = transaction({
  id: 'tx-uber',
  description: 'uber',
  amount: '18.00',
  category_id: 'cat-transporte',
  occurred_on: '2026-10-02',
})
const ANULADO = transaction({
  id: 'tx-anulado',
  description: 'farmácia',
  status: 'VOIDED',
  voided_at: `${TODAY}T16:00:00Z`,
})

interface Captured {
  queries: URLSearchParams[]
  voided: string[]
  refunds: { key: string | null; body: unknown }[]
  patched: unknown[]
}

function mockTransactions(): Captured {
  const captured: Captured = { queries: [], voided: [], refunds: [], patched: [] }
  const page = (items: TransactionOut[], next: string | null = null) =>
    HttpResponse.json({ items, next_cursor: next })
  server.use(
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/categories', () => HttpResponse.json(CATEGORIES)),
    http.get('/api/v1/accounts', () =>
      HttpResponse.json(
        Object.values(ACCOUNTS).map((a) => ({
          ...a,
          opening_balance: '0.00',
          opening_date: '2026-10-01',
          archived_at: null,
        })),
      ),
    ),
    http.get('/api/v1/cards', () =>
      HttpResponse.json([
        {
          ...CARDS.nubank,
          credit_limit: '11000.00',
          closing_day: 3,
          due_day: 10,
          opening_date: '2026-09-01',
          archived_at: null,
        },
      ]),
    ),
    http.get('/api/v1/accounts/balances', () =>
      HttpResponse.json({ as_of: TODAY, total: '0.00', accounts: [] }),
    ),
    http.get('/api/v1/transactions', ({ request }) => {
      const params = new URL(request.url).searchParams
      captured.queries.push(params)
      if (params.get('cursor') === 'c2') return page([UBER])
      if (params.get('status') === 'ALL') return page([ANULADO, MERCADO, SALARIO])
      return page([MERCADO, SALARIO], 'c2')
    }),
    http.post('/api/v1/transactions/:id/void', ({ params }) => {
      captured.voided.push(String(params.id))
      return HttpResponse.json(
        {
          status: 409,
          code: 'has_active_refunds',
          detail: 'Anule os estornos desta despesa antes de anulá-la.',
        },
        { status: 409 },
      )
    }),
    http.post('/api/v1/transactions/:id/refunds', async ({ request }) => {
      const body = (await request.json()) as { amount: string }
      captured.refunds.push({ key: request.headers.get('Idempotency-Key'), body })
      if (body.amount === '50.00') {
        return HttpResponse.json(
          {
            status: 422,
            code: 'refund_exceeds_original',
            detail: 'O estorno passa do valor que ainda pode ser devolvido (R$ 42,00).',
          },
          { status: 422 },
        )
      }
      const refund = transaction({
        type: 'REFUND',
        amount: body.amount,
        refund_of_id: MERCADO.id,
        payment_method: null,
      })
      return HttpResponse.json({ transaction: refund, replayed: false, warnings: [] }, { status: 201 })
    }),
    http.patch('/api/v1/transactions/:id', async ({ request }) => {
      captured.patched.push(await request.json())
      return HttpResponse.json({ transaction: MERCADO, replayed: false, warnings: [] })
    }),
  )
  return captured
}

function LocationProbe() {
  return <p data-testid="search">{useLocation().search}</p>
}

function renderPage(route = '/lancamentos') {
  const view = renderWithProviders(
    <Routes>
      <Route
        path="/lancamentos"
        element={
          <>
            <TransactionsPage />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { route },
  )
  return { ...view, user: userEvent.setup() }
}

const lastQuery = (captured: Captured) => captured.queries[captured.queries.length - 1]!

test('filters are kept in the URL', async () => {
  const captured = mockTransactions()
  const { user } = renderPage('/lancamentos?type=EXPENSE')
  expect(await screen.findByLabelText('Tipo')).toHaveDisplayValue('Despesa')
  await waitFor(() => expect(lastQuery(captured).get('type')).toBe('EXPENSE'))
  await user.selectOptions(await screen.findByLabelText('Conta'), 'Itaú')
  expect(screen.getByTestId('search')).toHaveTextContent(`type=EXPENSE&account_id=${ACCOUNTS.itau.id}`)
  await waitFor(() => expect(lastQuery(captured).get('account_id')).toBe(ACCOUNTS.itau.id))
  expect(lastQuery(captured).get('status')).toBeNull()
})

test('load more appends the next page', async () => {
  const captured = mockTransactions()
  const { user } = renderPage()
  expect(await screen.findByText('mercado')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Carregar mais' }))
  expect(await screen.findByText('uber')).toBeInTheDocument()
  expect(screen.getByText('mercado')).toBeInTheDocument()
  expect(lastQuery(captured).get('cursor')).toBe('c2')
  expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
})

test('voided items are hidden by default and shown with Todos', async () => {
  const captured = mockTransactions()
  const { user } = renderPage()
  await screen.findByText('mercado')
  expect(screen.queryByText('farmácia')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Situação'), 'Todos')
  const voided = (await screen.findByText('farmácia')).closest('li')!
  expect(within(voided).getByText('Anulado')).toBeInTheDocument()
  expect(within(voided).queryByRole('button')).not.toBeInTheDocument()
  expect(lastQuery(captured).get('status')).toBe('ALL')
})

test('void shows the server message when refunds exist', async () => {
  const captured = mockTransactions()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Anular mercado' }))
  expect(captured.voided).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Anular lançamento' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Anule os estornos desta despesa antes de anulá-la.',
  )
  expect(captured.voided).toEqual([MERCADO.id])
})

test('refund sends amount and idempotency key', async () => {
  const captured = mockTransactions()
  const { user } = renderPage()
  expect(screen.queryByRole('button', { name: 'Estornar salário' })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Estornar mercado' }))
  const form = screen.getByRole('form', { name: 'Estornar mercado' })
  const amount = within(form).getByLabelText('Valor')
  expect(amount).toHaveValue('42,00')
  await user.clear(amount)
  await user.type(amount, '10')
  await user.click(within(form).getByRole('button', { name: 'Registrar estorno' }))
  await waitFor(() => expect(captured.refunds).toHaveLength(1))
  expect(captured.refunds[0]!.body).toEqual({
    amount: '10.00',
    occurred_on: TODAY,
    account_id: ACCOUNTS.itau.id,
  })
  expect(captured.refunds[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
  expect(await screen.findByRole('status')).toHaveTextContent('Estorno registrado: R$ 10,00.')
})

test('refund above the original shows the server message', async () => {
  mockTransactions()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Estornar mercado' }))
  const form = screen.getByRole('form', { name: 'Estornar mercado' })
  const amount = within(form).getByLabelText('Valor')
  await user.clear(amount)
  await user.type(amount, '50')
  await user.click(within(form).getByRole('button', { name: 'Registrar estorno' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent(
    'O estorno passa do valor que ainda pode ser devolvido (R$ 42,00).',
  )
})

test('editing opens the full form with the entry', async () => {
  const captured = mockTransactions()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Editar mercado' }))
  const form = screen.getByRole('form', { name: 'Editar lançamento' })
  expect(within(form).getByLabelText('Valor')).toHaveValue('42,00')
  await user.type(within(form).getByLabelText('Notas (opcional)'), 'com a Bia')
  await user.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
  await waitFor(() => expect(captured.patched).toEqual([{ notes: 'com a Bia' }]))
  expect(await screen.findByRole('status')).toHaveTextContent('Lançamento atualizado.')
})

test('transactions page has no accessibility violations', async () => {
  mockTransactions()
  const { container } = renderPage()
  await screen.findByText('mercado')
  await expectNoA11yViolations(container)
})

test('closing an inline form returns focus to the row', async () => {
  mockTransactions()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Editar mercado' }))
  const form = screen.getByRole('form', { name: 'Editar lançamento' })
  await user.click(within(form).getByRole('button', { name: 'Cancelar' }))
  expect(screen.getByRole('button', { name: 'Editar mercado' })).toHaveFocus()
})

test('voiding moves focus to the result message', async () => {
  mockTransactions()
  server.use(
    http.post('/api/v1/transactions/:id/void', () =>
      HttpResponse.json({ ...MERCADO, status: 'VOIDED', voided_at: `${TODAY}T16:00:00Z` }),
    ),
  )
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Anular mercado' }))
  await user.click(screen.getByRole('button', { name: 'Anular lançamento' }))
  const status = await screen.findByRole('status')
  expect(status).toHaveTextContent('Lançamento anulado.')
  await waitFor(() => expect(status).toHaveFocus())
})

test('transactions filter by card', async () => {
  const captured = mockTransactions()
  const { user } = renderPage()
  const card = await screen.findByLabelText('Cartão')
  await within(card).findByRole('option', { name: 'Nubank' })
  await user.selectOptions(card, 'Nubank')
  await waitFor(() => expect(lastQuery(captured).get('card_id')).toBe(CARDS.nubank.id))
  expect(screen.getByTestId('search')).toHaveTextContent(`card_id=${CARDS.nubank.id}`)
})

test('card refund has no account field', async () => {
  const captured = mockTransactions()
  const celular = transaction({
    id: 'tx-celular',
    description: 'celular',
    amount: '1200.00',
    account_id: null,
    payment_method: null,
    card_id: CARDS.nubank.id,
    installments: 6,
  })
  server.use(
    http.get('/api/v1/transactions', () => HttpResponse.json({ items: [celular], next_cursor: null })),
  )
  const { user } = renderPage()
  expect(await screen.findByText('Mercado, crédito Nubank em 6x')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Estornar celular' }))
  const form = screen.getByRole('form', { name: 'Estornar celular' })
  expect(within(form).queryByLabelText('Devolvido em')).not.toBeInTheDocument()
  expect(within(form).getByText('O valor volta como crédito na fatura do Nubank.')).toBeInTheDocument()
  await user.clear(within(form).getByLabelText('Valor'))
  await user.type(within(form).getByLabelText('Valor'), '200')
  await user.click(within(form).getByRole('button', { name: 'Registrar estorno' }))
  await waitFor(() => expect(captured.refunds).toHaveLength(1))
  expect(captured.refunds[0]!.body).toEqual({ amount: '200.00', occurred_on: TODAY })
})

test('invoice payments are not edited from the list', async () => {
  mockTransactions()
  const payment = transaction({
    id: 'tx-pagamento',
    type: 'INVOICE_PAYMENT',
    description: 'Pagamento da fatura de outubro (Nubank)',
    amount: '2300.00',
    category_id: null,
    merchant_id: null,
    payment_method: null,
    invoice_id: 'inv-outubro',
    payment_group_id: 'grupo-1',
  })
  server.use(
    http.get('/api/v1/transactions', () => HttpResponse.json({ items: [payment], next_cursor: null })),
  )
  renderPage()
  expect(await screen.findByText('Pagamento de fatura, Itaú')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Editar Pagamento/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Anular Pagamento da fatura de outubro (Nubank)' })).toBeInTheDocument()
})
