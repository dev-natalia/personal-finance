import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { expect, test } from 'vitest'

import type { CardSummaryOut, InvoiceDetailOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { CARDS_SUMMARY, HINTS, TODAY, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { CardPage } from './CardPage'

const [NUBANK] = CARDS_SUMMARY as [CardSummaryOut]

const OCTOBER_DETAIL: InvoiceDetailOut = {
  invoice: { ...NUBANK.payable!, state: 'PAID', balance: '0.00' },
  items: [
    {
      id: 'item-1',
      kind: 'PURCHASE',
      direction: 'DEBIT',
      amount: '200.00',
      description: 'celular',
      occurred_on: '2026-09-15',
      installment_number: 1,
      installment_count: 6,
      transaction_id: 'tx-celular',
      status: 'ACTIVE',
    },
  ],
  payments: [
    transaction({
      id: 'tx-pagamento',
      type: 'INVOICE_PAYMENT',
      amount: '2300.00',
      description: 'Pagamento da fatura de outubro (Nubank)',
      category_id: null,
      merchant_id: null,
      payment_method: null,
      invoice_id: 'inv-outubro',
      payment_group_id: 'grupo-1',
    }),
  ],
}

interface Captured {
  invoicePatches: unknown[]
  charges: { key: string | null; body: unknown }[]
  voided: string[]
  cardPatches: unknown[]
  archived: string[]
}

function mockApi(summary: CardSummaryOut = NUBANK): Captured {
  const captured: Captured = {
    invoicePatches: [],
    charges: [],
    voided: [],
    cardPatches: [],
    archived: [],
  }
  server.use(
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/cards/summary', () => HttpResponse.json([summary])),
    http.get('/api/v1/cards/:id/invoices', () =>
      HttpResponse.json({
        open: summary.open_invoice,
        future: summary.future,
        previous: [OCTOBER_DETAIL.invoice],
        next_before: null,
      }),
    ),
    http.get('/api/v1/invoices/:id', () => HttpResponse.json(OCTOBER_DETAIL)),
    http.patch('/api/v1/invoices/:id', async ({ request }) => {
      captured.invoicePatches.push(await request.json())
      return HttpResponse.json(summary.payable)
    }),
    http.post('/api/v1/cards/:id/charges', async ({ request }) => {
      captured.charges.push({
        key: request.headers.get('Idempotency-Key'),
        body: await request.json(),
      })
      return HttpResponse.json(
        { transaction: transaction({ type: 'CHARGE' }), replayed: false, warnings: [] },
        { status: 201 },
      )
    }),
    http.post('/api/v1/payment-groups/:id/void', ({ params }) => {
      captured.voided.push(String(params.id))
      return HttpResponse.json({ group_id: params.id, payments: [] })
    }),
    http.patch('/api/v1/cards/:id', async ({ request }) => {
      captured.cardPatches.push(await request.json())
      return HttpResponse.json(summary.card)
    }),
    http.post('/api/v1/cards/:id/archive', ({ params }) => {
      captured.archived.push(String(params.id))
      return HttpResponse.json({
        card: { ...summary.card, archived_at: `${TODAY}T15:00:00Z` },
        warnings: [],
      })
    }),
  )
  return captured
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

function renderPage() {
  const view = renderWithProviders(
    <Routes>
      <Route path="/cartoes/:id" element={<CardPage />} />
      <Route path="*" element={<LocationProbe />} />
    </Routes>,
    { route: '/cartoes/card-nubank' },
  )
  return { ...view, user: userEvent.setup() }
}

test('shows open invoice, dates and limit', async () => {
  mockApi()
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Nubank' })).toBeInTheDocument()
  expect(screen.getByText('Fatura de novembro, aberta')).toBeInTheDocument()
  expect(screen.getByText('R$ 1.240,00')).toBeInTheDocument()
  expect(screen.getByText('Fecha em 03/11, vence em 10/11')).toBeInTheDocument()
  expect(screen.getByText('Limite usado R$ 9.440,00, disponível R$ 1.560,00')).toBeInTheDocument()
  expect(screen.getByRole('meter', { name: 'Limite usado' })).toHaveAttribute('aria-valuenow', '9440')
})

test('future invoices are collapsed by default', async () => {
  mockApi()
  const { user } = renderPage()
  const december = await screen.findByText('dezembro: R$ 3.000,00')
  expect(december).not.toBeVisible()
  await user.click(screen.getByText('Faturas futuras'))
  expect(december).toBeVisible()
})

test('reported total shows the missing difference', async () => {
  const captured = mockApi({
    ...NUBANK,
    payable: { ...NUBANK.payable!, reported_total: '2380.00', difference: '80.00' },
  })
  const { user } = renderPage()
  const closed = await screen.findByRole('region', { name: 'Fatura de outubro, fechada' })
  expect(within(closed).getByText('Calculado aqui R$ 2.300,00')).toBeInTheDocument()
  expect(
    within(closed).getByText('Faltam R$ 80,00: alguma compra pode não ter sido registrada.'),
  ).toBeInTheDocument()
  const reported = within(closed).getByLabelText('Total no Nubank')
  expect(reported).toHaveValue('2.380,00')
  await user.clear(reported)
  await user.type(reported, '2.300')
  await user.tab()
  await waitFor(() => expect(captured.invoicePatches).toEqual([{ reported_total: '2300.00' }]))
})

test('register purchase shortcut opens the form with card and date', async () => {
  mockApi()
  renderPage()
  const closed = await screen.findByRole('region', { name: 'Fatura de outubro, fechada' })
  expect(within(closed).getByRole('link', { name: 'Registrar compra' })).toHaveAttribute(
    'href',
    '/lancamentos/novo?card=card-nubank&date=2026-10-02',
  )
})

test('charge form posts with idempotency key', async () => {
  const captured = mockApi()
  const { user } = renderPage()
  const closed = await screen.findByRole('region', { name: 'Fatura de outubro, fechada' })
  await user.click(within(closed).getByRole('button', { name: 'Registrar encargo' }))
  const form = screen.getByRole('form', { name: 'Registrar encargo' })
  await user.type(within(form).getByLabelText('Valor'), '15')
  await user.type(within(form).getByLabelText('Descrição'), 'IOF')
  await user.click(within(form).getByRole('button', { name: 'Registrar encargo' }))
  await waitFor(() => expect(captured.charges).toHaveLength(1))
  expect(captured.charges[0]!.body).toEqual({
    amount: '15.00',
    occurred_on: TODAY,
    description: 'IOF',
  })
  expect(captured.charges[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
  expect(await screen.findByRole('status')).toHaveTextContent('Encargo registrado.')
})

test('void payment group asks for confirmation', async () => {
  const captured = mockApi()
  const { user } = renderPage()
  await user.click(await screen.findByText('Faturas anteriores'))
  await user.click(await screen.findByText('Fatura de outubro, paga'))
  await user.click(await screen.findByRole('button', { name: 'Anular pagamento' }))
  expect(captured.voided).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Anular pagamento de R$ 2.300,00' }))
  await waitFor(() => expect(captured.voided).toEqual(['grupo-1']))
})

test('previous invoice lists items with installment labels', async () => {
  mockApi()
  const { user } = renderPage()
  await user.click(await screen.findByText('Faturas anteriores'))
  await user.click(await screen.findByText('Fatura de outubro, paga'))
  expect(await screen.findByText('celular')).toBeInTheDocument()
  expect(screen.getByText('1 de 6')).toBeInTheDocument()
})

test('edit and archive card', async () => {
  const captured = mockApi()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Editar cartão' }))
  const form = screen.getByRole('form', { name: 'Editar cartão' })
  const limit = within(form).getByLabelText('Limite')
  await user.clear(limit)
  await user.type(limit, '12.000')
  await user.click(within(form).getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(captured.cardPatches).toEqual([{ credit_limit: '12000.00' }]))

  await user.click(await screen.findByRole('button', { name: 'Arquivar cartão' }))
  expect(captured.archived).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Arquivar Nubank' }))
  await waitFor(() => expect(captured.archived).toEqual(['card-nubank']))
  expect(await screen.findByTestId('location')).toHaveTextContent('/contas')
})

test('card page has no accessibility violations', async () => {
  mockApi()
  const { container } = renderPage()
  await screen.findByText('Fatura de novembro, aberta')
  await expectNoA11yViolations(container)
})

test('older invoices load on demand', async () => {
  mockApi()
  const september = { ...OCTOBER_DETAIL.invoice, id: 'inv-setembro', reference_month: '2026-09-01' }
  const requested: (string | null)[] = []
  server.use(
    http.get('/api/v1/cards/:id/invoices', ({ request }) => {
      const before = new URL(request.url).searchParams.get('before')
      requested.push(before)
      return HttpResponse.json({
        open: NUBANK.open_invoice,
        future: NUBANK.future,
        previous: before ? [september] : [OCTOBER_DETAIL.invoice],
        next_before: before ? null : '2026-10-01',
      })
    }),
  )
  const { user } = renderPage()
  await user.click(await screen.findByText('Faturas anteriores'))
  await user.click(await screen.findByRole('button', { name: 'Mostrar faturas mais antigas' }))
  expect(await screen.findByText('Fatura de setembro, paga')).toBeInTheDocument()
  expect(requested).toEqual([null, '2026-10-01'])
  expect(screen.queryByRole('button', { name: 'Mostrar faturas mais antigas' })).not.toBeInTheDocument()
})

test('pay invoice button opens the payment form and announces the result', async () => {
  mockApi()
  server.use(
    http.get('/api/v1/accounts', () =>
      HttpResponse.json([
        { id: 'acc-itau', name: 'Itaú', type: 'CHECKING', opening_balance: '0.00', opening_date: '2026-10-01', archived_at: null },
      ]),
    ),
    http.post('/api/v1/invoices/:id/payments', () =>
      HttpResponse.json(
        { group_id: 'g', payments: [], charge: null, replayed: false, warnings: [] },
        { status: 201 },
      ),
    ),
  )
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Pagar fatura de outubro' }))
  const form = screen.getByRole('form', { name: 'Pagar fatura de outubro' })
  await waitFor(() => expect(within(form).getByLabelText('Conta')).toHaveValue('acc-itau'))
  await user.click(within(form).getByRole('button', { name: 'Registrar pagamento' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Pagamento registrado.')
  expect(screen.queryByRole('form', { name: 'Pagar fatura de outubro' })).not.toBeInTheDocument()
})

test('no pay button without a payable invoice', async () => {
  mockApi({ ...NUBANK, payable: null })
  renderPage()
  await screen.findByText('Fatura de novembro, aberta')
  expect(screen.queryByRole('button', { name: /Pagar fatura/ })).not.toBeInTheDocument()
})
