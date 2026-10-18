import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { expect, test, vi } from 'vitest'

import { expectNoA11yViolations } from '../../test/axe'
import { cycleHandler } from '../../test/cycle'
import { CARDS_SUMMARY, HINTS, TODAY, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { NewCardForm } from './NewCardForm'

interface Sent {
  key: string | null
  body: Record<string, unknown>
}

function mockApi(failFirstInstallment = false) {
  const cards: Record<string, unknown>[] = []
  const installments: Sent[] = []
  server.use(
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/cards/summary', () => HttpResponse.json(CARDS_SUMMARY)),
    http.get('/api/v1/cards/cycle', () =>
      HttpResponse.json({
        open_reference_month: '2026-11-01',
        open_closing_date: '2026-11-03',
        open_due_date: '2026-11-10',
        next_reference_month: '2026-12-01',
      }),
    ),
    http.post('/api/v1/cards', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      cards.push(body)
      return HttpResponse.json(
        { ...CARDS_SUMMARY[0]!.card, ...body, id: 'card-new' },
        { status: 201 },
      )
    }),
    http.post('/api/v1/transactions', async ({ request }) => {
      installments.push({
        key: request.headers.get('Idempotency-Key'),
        body: (await request.json()) as Record<string, unknown>,
      })
      if (failFirstInstallment && installments.length === 1) {
        return HttpResponse.json(
          {
            status: 422,
            code: 'in_progress_after_card_opening',
            detail: 'Compras a partir do início do cartão entram como compra normal.',
          },
          { status: 422 },
        )
      }
      return HttpResponse.json(
        { transaction: transaction(), replayed: false, warnings: [] },
        { status: 201 },
      )
    }),
  )
  return { cards, installments }
}

function renderForm() {
  const onCreated = vi.fn()
  const view = renderWithProviders(<NewCardForm onCreated={onCreated} />)
  return { ...view, onCreated, user: userEvent.setup() }
}

async function fillCard(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Nome do cartão'), 'Nubank')
  await user.type(screen.getByLabelText('Limite'), '11.000')
  await user.selectOptions(screen.getByLabelText('Fecha no dia'), '3')
  await user.selectOptions(screen.getByLabelText('Vence no dia'), '10')
}

test('creates card with opening totals', async () => {
  const api = mockApi()
  const { user, onCreated } = renderForm()
  await fillCard(user)
  expect(screen.getByLabelText('Começa a acompanhar em')).toHaveValue(TODAY)
  await user.type(await screen.findByLabelText('Total da fatura de novembro (aberta agora)'), '1.240')
  await user.click(screen.getByLabelText('Tem fatura fechada sem pagar'))
  await user.type(screen.getByLabelText('Total da fatura de outubro (fechada)'), '2.380')
  fireEvent.change(screen.getByLabelText('Vencimento da fatura fechada'), {
    target: { value: '2026-10-10' },
  })
  await user.click(screen.getByRole('button', { name: 'Criar cartão' }))
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Nubank'))
  expect(api.cards).toEqual([
    {
      name: 'Nubank',
      credit_limit: '11000.00',
      closing_day: 3,
      due_day: 10,
      opening_date: TODAY,
      open_invoice_total: '1240.00',
      closed_invoice: { total: '2380.00', due_date: '2026-10-10' },
    },
  ])
  expect(api.installments).toEqual([])
})

test('in-progress installments are sent after the card', async () => {
  const api = mockApi()
  const { user, onCreated } = renderForm()
  await fillCard(user)
  await user.click(screen.getByRole('button', { name: 'Adicionar parcelada em andamento' }))
  const line = screen.getByRole('group', { name: 'Parcelada 1' })
  await user.type(within(line).getByLabelText('Descrição'), 'notebook')
  await user.type(within(line).getByLabelText('Valor total'), '6.000')
  await user.selectOptions(within(line).getByLabelText('Parcelas'), '10')
  fireEvent.change(within(line).getByLabelText('Data da compra'), {
    target: { value: '2026-07-20' },
  })
  await user.selectOptions(await within(line).findByLabelText('Quantas faltam depois da fatura de novembro'), '5')
  await user.click(screen.getByRole('button', { name: 'Criar cartão' }))
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Nubank'))
  expect(api.installments).toHaveLength(1)
  expect(api.installments[0]!.body).toEqual({
    type: 'EXPENSE',
    amount: '6000.00',
    occurred_on: '2026-07-20',
    description: 'notebook',
    card_id: 'card-new',
    installments: 10,
    remaining_installments: 5,
  })
  expect(api.installments[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
})

test('failed installment line can be retried alone', async () => {
  const api = mockApi(true)
  const { user, onCreated } = renderForm()
  await fillCard(user)
  await user.click(screen.getByRole('button', { name: 'Adicionar parcelada em andamento' }))
  const line = screen.getByRole('group', { name: 'Parcelada 1' })
  await user.type(within(line).getByLabelText('Descrição'), 'notebook')
  await user.type(within(line).getByLabelText('Valor total'), '6.000')
  await user.selectOptions(within(line).getByLabelText('Parcelas'), '10')
  fireEvent.change(within(line).getByLabelText('Data da compra'), {
    target: { value: '2026-07-20' },
  })
  await user.selectOptions(await within(line).findByLabelText('Quantas faltam depois da fatura de novembro'), '5')
  await user.click(screen.getByRole('button', { name: 'Criar cartão' }))
  expect(await within(line).findByRole('alert')).toHaveTextContent(
    'Compras a partir do início do cartão entram como compra normal.',
  )
  expect(onCreated).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Nubank'))
  expect(api.cards).toHaveLength(1)
  expect(api.installments).toHaveLength(2)
  expect(api.installments[1]!.key).toBe(api.installments[0]!.key)
})

test('skipping the opening step creates only the card', async () => {
  const api = mockApi()
  const { user, onCreated } = renderForm()
  await fillCard(user)
  await user.click(screen.getByRole('button', { name: 'Criar cartão' }))
  await waitFor(() => expect(onCreated).toHaveBeenCalled())
  expect(api.cards[0]).not.toHaveProperty('open_invoice_total')
  expect(api.cards[0]).not.toHaveProperty('closed_invoice')
  expect(api.installments).toEqual([])
})

test('invalid limit is reported without calling the server', async () => {
  const api = mockApi()
  const { user } = renderForm()
  await user.type(await screen.findByLabelText('Nome do cartão'), 'Nubank')
  await user.type(screen.getByLabelText('Limite'), '0')
  await user.click(screen.getByRole('button', { name: 'Criar cartão' }))
  expect(await screen.findByText('Informe um limite maior que zero.')).toBeInTheDocument()
  expect(api.cards).toEqual([])
})

test('new card form has no accessibility violations', async () => {
  mockApi()
  const { container, user } = renderForm()
  await screen.findByLabelText('Nome do cartão')
  await user.click(screen.getByRole('button', { name: 'Adicionar parcelada em andamento' }))
  await expectNoA11yViolations(container)
})

test('opening labels name the invoice months', async () => {
  mockApi()
  const { user } = renderForm()
  await fillCard(user)
  expect(await screen.findByLabelText('Total da fatura de novembro (aberta agora)')).toBeInTheDocument()
  await user.click(screen.getByLabelText('Tem fatura fechada sem pagar'))
  expect(screen.getByLabelText('Total da fatura de outubro (fechada)')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Adicionar parcelada em andamento' }))
  const line = screen.getByRole('group', { name: 'Parcelada 1' })
  expect(within(line).getByLabelText('Quantas faltam depois da fatura de novembro')).toBeInTheDocument()
  expect(within(line).getByText('Entram a partir da fatura de dezembro.')).toBeInTheDocument()
})

test('in-progress line suggests how many installments are left', async () => {
  mockApi()
  server.use(cycleHandler())
  const { user } = renderForm()
  await fillCard(user)
  await user.click(screen.getByRole('button', { name: 'Adicionar parcelada em andamento' }))
  const line = screen.getByRole('group', { name: 'Parcelada 1' })
  await user.selectOptions(within(line).getByLabelText('Parcelas'), '10')
  fireEvent.change(within(line).getByLabelText('Data da compra'), {
    target: { value: '2026-07-20' },
  })
  // Início em 15/10 (fecha dia 3): fatura de novembro. Compra de 20/07: fatura de agosto.
  expect(
    await within(line).findByText(
      'Pelas datas, a fatura de novembro tem a parcela 4/10: faltam 6. Se o banco mostrar outro número, ajuste.',
    ),
  ).toBeInTheDocument()
  const remaining = within(line).getByLabelText('Quantas faltam depois da fatura de novembro')
  expect(remaining).toHaveValue('6')
  // A usuária pode corrigir pelo número do banco; a sugestão não volta por cima.
  await user.selectOptions(remaining, '5')
  expect(remaining).toHaveValue('5')
})
