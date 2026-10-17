import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { expect, test, vi } from 'vitest'

import type { ExpenseIn, TransactionWriteOut } from '../../api/types'
import type { ParsedItem } from '../../domain/parser'
import { expectNoA11yViolations } from '../../test/axe'
import { CARDS, CATEGORIES, HINTS, PREVIEW, TODAY, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { ConfirmationCard } from './ConfirmationCard'

function parsed(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    raw: '42 mercado pix itaú',
    type: 'EXPENSE',
    amount: '42.00',
    description: 'mercado',
    occurredOn: TODAY,
    accountId: 'acc-itau',
    cardId: null,
    installments: null,
    paymentMethod: 'PIX',
    pending: [],
    ...overrides,
  }
}

interface Sent {
  key: string | null
  body: ExpenseIn
}

type Reply = (sent: Sent, attempt: number) => Response

const created = (warnings: TransactionWriteOut['warnings'] = []) =>
  HttpResponse.json({ transaction: transaction(), replayed: false, warnings }, { status: 201 })

/** Registra os handlers da API e devolve a lista de lançamentos enviados. */
function mockApi(reply: Reply = () => created(), duplicates: Record<number, number> = {}) {
  const sent: Sent[] = []
  server.use(
    http.get('/api/v1/categories', () => HttpResponse.json(CATEGORIES)),
    http.get('/api/v1/merchants', () => HttpResponse.json([])),
    http.get('/api/v1/auth/me', () => HttpResponse.json({})),
    http.get('/api/v1/accounts/balances', () => HttpResponse.json({})),
    http.get('/api/v1/transactions', () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.post('/api/v1/cards/:id/preview', () => HttpResponse.json(PREVIEW)),
    http.post('/api/v1/entry-checks', async ({ request }) => {
      const { items } = (await request.json()) as { items: unknown[] }
      return HttpResponse.json({
        results: items.map((_, index) => ({
          index,
          possible_duplicates: Array.from({ length: duplicates[index] ?? 0 }, () => transaction()),
        })),
      })
    }),
    http.post('/api/v1/transactions', async ({ request }) => {
      const entry = {
        key: request.headers.get('Idempotency-Key'),
        body: (await request.json()) as ExpenseIn,
      }
      sent.push(entry)
      return reply(entry, sent.length)
    }),
  )
  return sent
}

function renderCard(items: ParsedItem[]) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const view = renderWithProviders(
    <ConfirmationCard parsed={items} hints={HINTS} onSaved={onSaved} onClose={onClose} />,
  )
  return { ...view, onSaved, onClose, user: userEvent.setup() }
}

test('shows the parsed values', async () => {
  mockApi()
  renderCard([parsed()])
  expect(await screen.findByLabelText('Valor')).toHaveValue('42,00')
  expect(screen.getByLabelText('Descrição')).toHaveValue('mercado')
  expect(screen.getByRole('button', { name: 'Pix Itaú' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('heading', { name: 'Confirmar lançamento' })).toHaveFocus()
})

test('confirm stays disabled until payment is chosen', async () => {
  mockApi()
  const { user } = renderCard([parsed({ accountId: null, paymentMethod: null })])
  const confirm = await screen.findByRole('button', { name: 'Confirmar' })
  expect(confirm).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Pix Itaú' }))
  expect(confirm).toBeEnabled()
})

test('confirm posts with an idempotency key and reports the saved line', async () => {
  const sent = mockApi()
  const { user, onSaved, onClose } = renderCard([parsed()])
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent).toHaveLength(1)
  expect(sent[0]!.key).toMatch(/^[0-9a-f-]{36}$/)
  expect(onSaved).toHaveBeenCalledWith(
    [{ line: 'Despesa registrada: R$ 42,00 em Mercado, paga com Pix Itaú.', warnings: [] }],
    [],
  )
  expect(onClose).toHaveBeenCalledWith([])
})

test('retry after network failure reuses the same idempotency key', async () => {
  const sent = mockApi((_, attempt) => (attempt === 1 ? HttpResponse.error() : created()))
  const { user, onClose } = renderCard([parsed()])
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o servidor')
  await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent).toHaveLength(2)
  expect(sent[1]!.key).toBe(sent[0]!.key)
})

test('batch with one failure keeps the others saved and retries only the failed one', async () => {
  const sent = mockApi((entry, attempt) =>
    entry.body.description === 'café' && attempt === 2
      ? HttpResponse.json(
          { status: 422, code: 'account_archived', detail: 'A conta Itaú está arquivada.' },
          { status: 422 },
        )
      : created(),
  )
  const { user, onSaved } = renderCard([parsed(), parsed({ description: 'café', amount: '8.00' })])
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('A conta Itaú está arquivada.')
  expect(onSaved).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  await waitFor(() => expect(sent).toHaveLength(3))
  expect(sent.map((s) => s.body.description)).toEqual(['mercado', 'café', 'café'])
  expect(sent[2]!.key).toBe(sent[1]!.key)
})

test('typing into a failed item keeps focus and every keystroke', async () => {
  mockApi((_, attempt) =>
    attempt === 1
      ? HttpResponse.json(
          { status: 422, code: 'account_archived', detail: 'A conta Itaú está arquivada.' },
          { status: 422 },
        )
      : created(),
  )
  const { user } = renderCard([parsed()])
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await screen.findByRole('alert')
  const description = screen.getByLabelText('Descrição')
  await user.click(description)
  await user.type(description, 'xy')
  expect(screen.getByLabelText('Descrição')).toHaveValue('mercadoxy')
  expect(screen.getByLabelText('Descrição')).toHaveFocus()
})

test('items are locked while the batch is being sent', async () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  mockApi(() => created())
  server.use(
    http.post('/api/v1/transactions', async () => {
      await gate
      return created()
    }),
  )
  const { user, onClose } = renderCard([parsed(), parsed({ description: 'café', amount: '8.00' })])
  const confirm = await screen.findByRole('button', { name: 'Confirmar' })
  await user.click(confirm)
  const checkboxes = screen.getAllByRole('checkbox', { name: 'Incluir este lançamento' })
  await waitFor(() => expect(checkboxes[1]).toBeDisabled())
  // O botão não é desabilitado (perderia o foco); só ignora novos toques durante o envio.
  expect(confirm).toHaveFocus()
  expect(confirm).toHaveAttribute('aria-disabled', 'true')
  release()
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

test('unchecked items are not sent', async () => {
  const sent = mockApi()
  const { user, onClose } = renderCard([parsed(), parsed({ description: 'café', amount: '8.00' })])
  const checkboxes = await screen.findAllByRole('checkbox', { name: 'Incluir este lançamento' })
  await user.click(checkboxes[1]!)
  await user.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent.map((s) => s.body.description)).toEqual(['mercado'])
})

test('sends category_id only when the user changed the category', async () => {
  const sent = mockApi()
  const first = renderCard([parsed()])
  await first.user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]!.body).not.toHaveProperty('category_id')
  first.unmount()

  const second = renderCard([parsed()])
  await screen.findByRole('option', { name: 'Saúde' })
  await second.user.selectOptions(screen.getByLabelText('Categoria'), 'Saúde')
  await second.user.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]!.body.category_id).toBe('cat-saude')
})

test('shows the duplicate warning', async () => {
  mockApi(() => created(), { 0: 1 })
  renderCard([parsed()])
  expect(await screen.findByText(/Possível duplicata/)).toBeInTheDocument()
})

test('passes the negative balance warning along', async () => {
  const detail = 'A conta Itaú ficou com saldo negativo (−R$ 32,00).'
  mockApi(() => created([{ code: 'negative_balance', detail }]))
  const { user, onSaved } = renderCard([parsed()])
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(onSaved.mock.calls[0]![0][0].warnings).toEqual([detail])
})

test('card has no accessibility violations', async () => {
  mockApi()
  const { container } = renderCard([parsed(), parsed({ description: 'café', paymentMethod: null })])
  await screen.findAllByRole('option', { name: 'Saúde' })
  await expectNoA11yViolations(container)
})

test('account method choices never offer credit', async () => {
  mockApi()
  renderCard([parsed({ paymentMethod: null, pending: ['paymentMethod'] })])
  const method = await screen.findByLabelText('Meio')
  const labels = Array.from(method.querySelectorAll('option')).map((o) => o.textContent)
  expect(labels).not.toContain('Crédito')
  expect(labels).toContain('Pix')
})


// --- cartão --------------------------------------------------------------------------------

const onCard = (overrides: Partial<ParsedItem> = {}) =>
  parsed({
    raw: '1200 celular crédito nubank 6x',
    amount: '1200.00',
    description: 'celular',
    accountId: null,
    cardId: CARDS.nubank.id,
    paymentMethod: 'CREDIT',
    installments: 6,
    ...overrides,
  })

test('card item posts card_id and installments without account', async () => {
  const sent = mockApi()
  const { user, onClose } = renderCard([onCard()])
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent[0]!.body).toEqual({
    type: 'EXPENSE',
    amount: '1200.00',
    occurred_on: TODAY,
    description: 'celular',
    card_id: CARDS.nubank.id,
    installments: 6,
  })
})

test('shows invoice and limit impact from the preview', async () => {
  mockApi()
  renderCard([onCard()])
  expect(await screen.findByText('Fatura de novembro: R$ 1.240,00 → R$ 1.440,00')).toBeInTheDocument()
  expect(screen.getByText('Limite disponível: R$ 1.560,00 → R$ 360,00')).toBeInTheDocument()
  expect(screen.getByText('Limite não é dinheiro.')).toBeInTheDocument()
})

test('installment impact opens next invoices on demand', async () => {
  mockApi()
  const { user } = renderCard([onCard()])
  const summary = await screen.findByText('Ver como ficam as próximas faturas')
  const december = screen.getByText('dezembro: R$ 3.000,00 → R$ 3.200,00')
  expect(december).not.toBeVisible()
  await user.click(summary)
  expect(december).toBeVisible()
})

test('over limit shows warning without blocking', async () => {
  mockApi()
  server.use(
    http.post('/api/v1/cards/:id/preview', () =>
      HttpResponse.json({ ...PREVIEW, limit_after: '-200.00' }),
    ),
  )
  renderCard([onCard()])
  expect(await screen.findByText('Esta compra passa do limite em R$ 200,00.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
})

test('preview failure shows no numbers', async () => {
  mockApi()
  server.use(
    http.post('/api/v1/cards/:id/preview', () =>
      HttpResponse.json({ status: 500, code: 'internal_error', detail: 'x' }, { status: 500 }),
    ),
  )
  renderCard([onCard()])
  expect(
    await screen.findByText('Não foi possível calcular o impacto na fatura.'),
  ).toBeInTheDocument()
  expect(screen.queryByText(/→/)).not.toBeInTheDocument()
})

test('choosing the card shortcut fills card and hides method', async () => {
  mockApi()
  const { user } = renderCard([
    parsed({ accountId: null, paymentMethod: null, pending: ['account', 'paymentMethod'] }),
  ])
  expect(await screen.findByLabelText('Meio')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Crédito Nubank' }))
  expect(screen.getByRole('button', { name: 'Crédito Nubank' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.queryByLabelText('Meio')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Parcelas')).toHaveDisplayValue('À vista')
  expect(screen.getByLabelText('Conta ou cartão')).toHaveDisplayValue('Crédito Nubank')
})

test('saved card line adds the invoice total from the preview', async () => {
  mockApi(() =>
    HttpResponse.json(
      {
        transaction: transaction({
          amount: '1200.00',
          description: 'celular',
          account_id: null,
          card_id: CARDS.nubank.id,
          payment_method: 'CREDIT',
          installments: 6,
          category_id: 'cat-unclassified-expense',
        }),
        replayed: false,
        warnings: [],
      },
      { status: 201 },
    ),
  )
  const { user, onSaved } = renderCard([onCard()])
  await screen.findByText('Fatura de novembro: R$ 1.240,00 → R$ 1.440,00')
  await user.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(onSaved.mock.calls[0]![0]).toEqual([
    {
      line:
        'Despesa registrada: R$ 1.200,00, ainda sem categoria, no crédito Nubank em 6x. ' +
        'Fatura de novembro: R$ 1.440,00.',
      warnings: [],
    },
  ])
})

test('confirmation card with card has no accessibility violations', async () => {
  mockApi()
  const { container } = renderCard([onCard()])
  await screen.findByText('Limite não é dinheiro.')
  await expectNoA11yViolations(container)
})
