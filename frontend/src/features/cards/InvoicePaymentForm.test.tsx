import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { expect, test, vi } from 'vitest'

import type { AccountOut, CardSummaryOut, InvoiceSummaryOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { ACCOUNTS, CARDS_SUMMARY, HINTS, TODAY, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { InvoicePaymentForm } from './InvoicePaymentForm'

const [NUBANK] = CARDS_SUMMARY as [CardSummaryOut]
const OCTOBER = NUBANK.payable as InvoiceSummaryOut

const ACCOUNT_LIST: AccountOut[] = [
  { ...ACCOUNTS.itau, opening_balance: '1000.00', opening_date: '2026-10-01', archived_at: null },
  { ...ACCOUNTS.nubank, opening_balance: '500.00', opening_date: '2026-10-01', archived_at: null },
]

interface Sent {
  key: string | null
  body: unknown
}

function mockApi(responses: ((n: number) => Response | null)[] = []) {
  const sent: Sent[] = []
  server.use(
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/accounts', () => HttpResponse.json(ACCOUNT_LIST)),
    http.post('/api/v1/invoices/:id/payments', async ({ request }) => {
      sent.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
      const custom = responses[sent.length - 1]?.(sent.length)
      if (custom) return custom
      return HttpResponse.json(
        {
          group_id: 'grupo-1',
          payments: [transaction({ type: 'INVOICE_PAYMENT' })],
          charge: null,
          replayed: false,
          warnings: [],
        },
        { status: 201 },
      )
    }),
  )
  return sent
}

function renderForm(invoice: InvoiceSummaryOut = OCTOBER) {
  const onDone = vi.fn()
  const view = renderWithProviders(
    <InvoicePaymentForm invoice={invoice} cardName="Nubank" onDone={onDone} onCancel={() => {}} />,
  )
  return { ...view, onDone, user: userEvent.setup() }
}

function source(n: number) {
  return screen.getByRole('group', { name: `Conta ${n}` })
}

test('pays full invoice from one account', async () => {
  const sent = mockApi()
  const { user, onDone } = renderForm()
  const form = await screen.findByRole('form', { name: 'Pagar fatura de outubro' })
  expect(within(form).getByText('Total R$ 2.300,00')).toBeInTheDocument()
  await waitFor(() => expect(within(source(1)).getByLabelText('Conta')).toHaveValue('acc-itau'))
  expect(within(source(1)).getByLabelText('Valor')).toHaveValue('2.300,00')
  expect(within(form).getByLabelText('Data')).toHaveValue(TODAY)
  await user.click(within(form).getByRole('button', { name: 'Registrar pagamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Pagamento registrado.'))
  expect(sent[0]!.body).toEqual({
    occurred_on: TODAY,
    sources: [{ account_id: 'acc-itau', amount: '2300.00' }],
    remainder: 'NONE',
  })
})

test('split between two accounts shows what is missing', async () => {
  const sent = mockApi()
  const { user } = renderForm()
  const first = within(await screen.findByRole('group', { name: 'Conta 1' }))
  await waitFor(() => expect(first.getByLabelText('Valor')).toHaveValue('2.300,00'))
  await user.clear(first.getByLabelText('Valor'))
  await user.type(first.getByLabelText('Valor'), '1.000')
  await user.click(screen.getByRole('button', { name: 'Adicionar outra conta' }))
  const second = within(source(2))
  await user.selectOptions(second.getByLabelText('Conta'), 'acc-nubank')
  await user.type(second.getByLabelText('Valor'), '500')
  expect(screen.getByText('Pagando R$ 1.500,00')).toBeInTheDocument()
  expect(screen.getByText('Faltam R$ 800,00')).toBeInTheDocument()
  const options = screen.getByRole('group', { name: 'O que fazer com os R$ 800,00?' })
  await user.click(within(options).getByLabelText('Só pagar esta parte agora'))
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]!.body).toEqual({
    occurred_on: TODAY,
    sources: [
      { account_id: 'acc-itau', amount: '1000.00' },
      { account_id: 'acc-nubank', amount: '500.00' },
    ],
    remainder: 'NONE',
  })
})

async function payPart(user: ReturnType<typeof userEvent.setup>, amount: string) {
  const first = within(await screen.findByRole('group', { name: 'Conta 1' }))
  await waitFor(() => expect(first.getByLabelText('Valor')).toHaveValue('2.300,00'))
  await user.clear(first.getByLabelText('Valor'))
  await user.type(first.getByLabelText('Valor'), amount)
}

test('carry over sends CARRY_OVER', async () => {
  const sent = mockApi()
  const { user } = renderForm()
  await payPart(user, '1.300')
  await user.click(screen.getByLabelText('Deixar para a próxima fatura'))
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]!.body).toMatchObject({ remainder: 'CARRY_OVER' })
})

test('installments send count and amount and show interest', async () => {
  const sent = mockApi()
  const { user } = renderForm()
  await payPart(user, '1.300')
  await user.click(screen.getByLabelText('Parcelar com o Nubank'))
  await user.selectOptions(screen.getByLabelText('Parcelas'), '6')
  await user.type(screen.getByLabelText('Valor de cada parcela'), '190')
  expect(screen.getByText('Juros que serão registrados: R$ 140,00')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]!.body).toMatchObject({
    remainder: { installments: 6, installment_amount: '190.00' },
  })
})

test('remainder needs a choice before sending', async () => {
  const sent = mockApi()
  const { user } = renderForm()
  await payPart(user, '1.300')
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  expect(await screen.findByText('Escolha o que fazer com o restante.')).toBeInTheDocument()
  expect(sent).toEqual([])
})

test('open invoice has no remainder options', async () => {
  const sent = mockApi()
  const { user } = renderForm({ ...NUBANK.open_invoice, id: 'inv-novembro' })
  const first = within(await screen.findByRole('group', { name: 'Conta 1' }))
  await waitFor(() => expect(first.getByLabelText('Valor')).toHaveValue('1.240,00'))
  await user.clear(first.getByLabelText('Valor'))
  await user.type(first.getByLabelText('Valor'), '240')
  expect(screen.getByText('Faltam R$ 1.000,00')).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: /O que fazer/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]!.body).toMatchObject({ remainder: 'NONE' })
})

test('payment above balance shows the server message', async () => {
  mockApi([
    () =>
      HttpResponse.json(
        {
          status: 422,
          code: 'invoice_payment_exceeds_balance',
          detail: 'O pagamento passa do saldo da fatura (R$ 2.300,00).',
        },
        { status: 422 },
      ),
  ])
  const { user, onDone } = renderForm()
  await payPart(user, '2.400')
  expect(screen.getByText('Passa do total em R$ 100,00')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'O pagamento passa do saldo da fatura (R$ 2.300,00).',
  )
  expect(onDone).not.toHaveBeenCalled()
})

test('retry reuses the key', async () => {
  const sent = mockApi([() => HttpResponse.error()])
  const { user, onDone } = renderForm()
  await waitFor(() =>
    expect(within(source(1)).getByLabelText('Valor')).toHaveValue('2.300,00'),
  )
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(sent).toHaveLength(2)
  expect(sent[1]!.key).toBe(sent[0]!.key)
})

test('payment form has no accessibility violations', async () => {
  mockApi()
  const { container, user } = renderForm()
  await payPart(user, '1.300')
  await user.click(screen.getByLabelText('Parcelar com o Nubank'))
  await user.click(screen.getByRole('button', { name: 'Adicionar outra conta' }))
  await expectNoA11yViolations(container)
})

test('interest above the remainder needs a confirmation', async () => {
  const sent = mockApi()
  const { user } = renderForm()
  await payPart(user, '1.300')
  await user.click(screen.getByLabelText('Parcelar com o Nubank'))
  await user.selectOptions(screen.getByLabelText('Parcelas'), '24')
  await user.type(screen.getByLabelText('Valor de cada parcela'), '1.000')
  expect(
    screen.getByText('Os juros passam do valor parcelado (R$ 1.000,00). Confira as parcelas.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  expect(await screen.findByText('Confirme os juros antes de registrar.')).toBeInTheDocument()
  expect(sent).toEqual([])
  await user.click(screen.getByLabelText('Confirmo os juros de R$ 23.000,00'))
  await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
  await waitFor(() => expect(sent).toHaveLength(1))
})
