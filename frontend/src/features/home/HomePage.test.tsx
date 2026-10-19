import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { UNAUTHENTICATED_EVENT } from '../../api/client'
import type { TransactionOut } from '../../api/types'
import { AppRoutes } from '../../routes'
import { expectNoA11yViolations } from '../../test/axe'
import {
  ACCOUNTS,
  BALANCES,
  CARDS,
  CARDS_SUMMARY,
  CATEGORIES,
  HINTS,
  TODAY,
  USER,
  transaction,
} from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'

afterEach(() => vi.restoreAllMocks())

const unauthenticated = () =>
  HttpResponse.json({ status: 401, code: 'unauthenticated', detail: 'x' }, { status: 401 })

/** API da tela inicial; `signedIn` controla a sessão para simular a expiração. */
function mockHome(
  items: TransactionOut[] = [],
  backup: { last_success_at: string | null; stale: boolean } = {
    last_success_at: '2026-10-15T06:00:00Z',
    stale: false,
  },
) {
  const session = { signedIn: true, recorded: [] as { text: string; reasons: string[] }[] }
  server.use(
    http.get('/api/v1/auth/me', () => (session.signedIn ? HttpResponse.json(USER) : unauthenticated())),
    http.post('/api/v1/auth/login', () => {
      session.signedIn = true
      return HttpResponse.json(USER)
    }),
    http.get('/api/v1/entry-hints', () =>
      session.signedIn ? HttpResponse.json(HINTS) : unauthenticated(),
    ),
    http.get('/api/v1/accounts/balances', () =>
      session.signedIn ? HttpResponse.json(BALANCES) : unauthenticated(),
    ),
    http.get('/api/v1/transactions', () =>
      session.signedIn ? HttpResponse.json({ items, next_cursor: null }) : unauthenticated(),
    ),
    http.get('/api/v1/categories', () => HttpResponse.json(CATEGORIES)),
    http.get('/api/v1/cards/summary', () => HttpResponse.json(CARDS_SUMMARY)),
    http.get('/api/v1/merchants', () => HttpResponse.json([])),
    http.post('/api/v1/entry-checks', () => HttpResponse.json({ results: [] })),
    http.get('/api/v1/backup-status', () => HttpResponse.json(backup)),
    http.post('/api/v1/misread-phrases', async ({ request }) => {
      session.recorded.push((await request.json()) as { text: string; reasons: string[] })
      return HttpResponse.json({}, { status: 201 })
    }),
  )
  return session
}

test('shows balance and groups the timeline by day', async () => {
  mockHome([
    transaction(),
    transaction({
      occurred_on: '2026-10-14',
      description: 'uber',
      amount: '18.00',
      category_id: 'cat-transporte',
      account_id: ACCOUNTS.nubank.id,
      payment_method: 'DEBIT',
    }),
  ])
  renderWithProviders(<AppRoutes />, { route: '/' })
  expect(await screen.findByText('R$ 1.008,00')).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Ontem' })).toBeInTheDocument()
  expect(screen.getByText('−42,00')).toBeInTheDocument()
  expect(screen.getByText('Mercado, Pix Itaú')).toBeInTheDocument()
  expect(screen.getByText('Transporte, Débito Nubank')).toBeInTheDocument()
})

test('empty timeline invites the first entry', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  expect(await screen.findByText(/Anote seu primeiro gasto/)).toBeInTheDocument()
})

test('typing a phrase opens the confirmation card', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Novo lançamento'), '42 mercado pix itaú{Enter}')
  expect(await screen.findByRole('heading', { name: 'Confirmar lançamento' })).toBeInTheDocument()
  expect(screen.getByLabelText('Novo lançamento')).toHaveValue('')
})

test('Escape closes the card and focus returns to the text field', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Novo lançamento'), '42 mercado pix itaú{Enter}')
  const heading = await screen.findByRole('heading', { name: 'Confirmar lançamento' })
  expect(heading).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('heading', { name: 'Confirmar lançamento' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Novo lançamento')).toHaveFocus()
})

test('confirming returns focus to the text field', async () => {
  mockHome()
  server.use(
    http.post('/api/v1/transactions', () =>
      HttpResponse.json({ transaction: transaction(), replayed: false, warnings: [] }, { status: 201 }),
    ),
  )
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Novo lançamento'), '42 mercado pix itaú{Enter}')
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Confirmar lançamento' })).not.toBeInTheDocument(),
  )
  expect(screen.getByLabelText('Novo lançamento')).toHaveFocus()
  expect(screen.getByLabelText('Novo lançamento')).toHaveValue('')
  expect(sessionStorage.getItem('pf:draft')).toBeNull()
})

test('the first confirmation lands in a live region that already existed', async () => {
  mockHome()
  server.use(
    http.post('/api/v1/transactions', () =>
      HttpResponse.json({ transaction: transaction(), replayed: false, warnings: [] }, { status: 201 }),
    ),
  )
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  const field = await screen.findByLabelText('Novo lançamento')
  const live = await screen.findByTestId('session-entries')
  expect(live).toHaveAttribute('aria-live', 'polite')
  expect(live).toBeEmptyDOMElement()
  await user.type(field, '42 mercado pix itaú{Enter}')
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(live).toHaveTextContent('Despesa registrada: R$ 42,00'))
  expect(screen.getByTestId('session-entries')).toBe(live)
})

test('today is refreshed when the app comes back to the screen', async () => {
  mockHome()
  let today = TODAY
  let calls = 0
  server.use(
    http.get('/api/v1/entry-hints', () => {
      calls += 1
      return HttpResponse.json({ ...HINTS, today })
    }),
  )
  const { queryClient } = renderWithProviders(<AppRoutes />, { route: '/' })
  const field = await screen.findByLabelText('Novo lançamento')
  await waitFor(() => expect(calls).toBe(1))

  // O app ficou em segundo plano e virou o dia.
  today = '2026-10-16'
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
  await waitFor(() =>
    expect(queryClient.getQueryData<{ today: string }>(['entry-hints'])?.today).toBe('2026-10-16'),
  )
  expect(calls).toBe(2)
  const user = userEvent.setup()
  await user.type(field, '42 mercado pix itaú{Enter}')
  expect(await screen.findByLabelText('Data')).toHaveValue('2026-10-16')
})

test('empty text does nothing', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Novo lançamento'), '   {Enter}')
  expect(screen.queryByRole('heading', { name: /Confirmar/ })).not.toBeInTheDocument()
})

test('draft survives the redirect to login', async () => {
  const session = mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Novo lançamento'), '42 padaria')

  session.signedIn = false
  act(() => {
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT))
  })
  await user.type(await screen.findByLabelText('E-mail'), 'ana@example.com')
  await user.type(screen.getByLabelText('Senha'), 'senha-certa-123')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))

  await waitFor(() => expect(screen.getByLabelText('Novo lançamento')).toHaveValue('42 padaria'))
})

test('cancelling the card puts the text back in the field', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Novo lançamento'), '42 mercado pix itaú{Enter}')
  await user.click(await screen.findByRole('button', { name: 'Cancelar' }))
  expect(screen.getByLabelText('Novo lançamento')).toHaveValue('42 mercado pix itaú')
})

test('text of an open card survives the redirect to login', async () => {
  const session = mockHome()
  server.use(http.post('/api/v1/transactions', () => unauthenticated()))
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Novo lançamento'), '42 mercado pix itaú{Enter}')
  session.signedIn = false
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))

  await user.type(await screen.findByLabelText('E-mail'), 'ana@example.com')
  await user.type(screen.getByLabelText('Senha'), 'senha-certa-123')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Novo lançamento')).toHaveValue('42 mercado pix itaú'),
  )
})

test('after a partial save only the unsaved items come back, with the date header', async () => {
  mockHome()
  server.use(
    http.post('/api/v1/transactions', async ({ request }) => {
      const body = (await request.json()) as { description: string }
      if (body.description === 'café') {
        return HttpResponse.json(
          { status: 422, code: 'account_archived', detail: 'A conta Itaú está arquivada.' },
          { status: 422 },
        )
      }
      return HttpResponse.json({ transaction: transaction(), replayed: false, warnings: [] }, { status: 201 })
    }),
  )
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  await user.type(
    await screen.findByLabelText('Novo lançamento'),
    'ontem: 42 mercado pix itaú; 8 café pix itaú{Enter}',
  )
  await user.click(await screen.findByRole('button', { name: 'Confirmar' }))
  await screen.findByRole('alert')
  expect(sessionStorage.getItem('pf:draft')).toBe('ontem: 8 café pix itaú')
  await user.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(screen.getByLabelText('Novo lançamento')).toHaveValue('ontem: 8 café pix itaú')
})

test('offline shows the banner and keeps the text', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  expect(await screen.findByText(/Sem conexão/)).toBeInTheDocument()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Novo lançamento'), '42 feira')
  expect(screen.getByLabelText('Novo lançamento')).toHaveValue('42 feira')
})

test('home has no accessibility violations', async () => {
  mockHome([transaction()])
  const { container } = renderWithProviders(<AppRoutes />, { route: '/' })
  await screen.findByRole('heading', { name: 'Hoje' })
  await expectNoA11yViolations(container)
})

test('full form returns home with the confirmation line', async () => {
  mockHome()
  server.use(
    http.post('/api/v1/transactions', () =>
      HttpResponse.json(
        {
          transaction: transaction({
            type: 'TRANSFER',
            amount: '300.00',
            description: 'Reserva',
            category_id: null,
            payment_method: null,
            destination_account_id: ACCOUNTS.nubank.id,
          }),
          replayed: false,
          warnings: [],
        },
        { status: 201 },
      ),
    ),
  )
  const user = userEvent.setup()
  renderWithProviders(<AppRoutes />, { route: '/lancamentos/novo' })
  await user.selectOptions(await screen.findByLabelText('Tipo'), 'Transferência')
  await user.type(screen.getByLabelText('Valor'), '300')
  await user.type(screen.getByLabelText('Descrição'), 'Reserva')
  await user.selectOptions(await screen.findByLabelText('De'), 'Itaú')
  await user.selectOptions(screen.getByLabelText('Para'), 'Nubank')
  await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }))
  expect(
    await screen.findByText('Transferência registrada: R$ 300,00 de Itaú para Nubank.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Início' })).toBeInTheDocument()
})

test('home shows open invoice line per card', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const line = await screen.findByRole('link', { name: 'Fatura aberta Nubank R$ 1.240,00' })
  expect(line).toHaveAttribute('href', `/cartoes/${CARDS.nubank.id}`)
})

test('ledger detail describes card purchases and invoice payments', async () => {
  mockHome([
    transaction({
      description: 'celular',
      amount: '1200.00',
      account_id: null,
      payment_method: null,
      card_id: CARDS.nubank.id,
      installments: 6,
    }),
    transaction({
      description: 'notebook',
      amount: '6000.00',
      category_id: null,
      account_id: null,
      payment_method: null,
      card_id: CARDS.nubank.id,
      installments: 10,
      remaining_installments: 5,
    }),
    transaction({
      type: 'INVOICE_PAYMENT',
      description: 'Pagamento da fatura de outubro (Nubank)',
      amount: '2300.00',
      category_id: null,
      merchant_id: null,
      payment_method: null,
      invoice_id: 'inv-outubro',
      payment_group_id: 'grupo-1',
    }),
    transaction({
      type: 'CHARGE',
      description: 'IOF',
      amount: '15.00',
      category_id: null,
      merchant_id: null,
      account_id: null,
      payment_method: null,
      card_id: CARDS.nubank.id,
    }),
  ])
  renderWithProviders(<AppRoutes />, { route: '/' })
  expect(await screen.findByText('Mercado, crédito Nubank em 6x')).toBeInTheDocument()
  expect(screen.getByText('A classificar, crédito Nubank em 10x, já em andamento')).toBeInTheDocument()
  expect(screen.getByText('Pagamento de fatura, Itaú')).toBeInTheDocument()
  expect(screen.getByText('−2.300,00')).toBeInTheDocument()
  expect(screen.getByText('Encargos financeiros, Nubank')).toBeInTheDocument()
  expect(screen.getByText('−15,00')).toBeInTheDocument()
})

test('navigation has six tabs', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const nav = await screen.findByRole('navigation', { name: 'Principal' })
  // Rótulos do celular (no computador os nomes aparecem completos).
  const mobileLabels = within(nav)
    .getAllByRole('link')
    .map((l) => l.querySelector('[data-mobile-label]')?.textContent)
  expect(mobileLabels).toEqual([
    'Início',
    'Lançam.',
    'Análise',
    'Contas',
    'Cartões',
    'Mais',
  ])
  // Abreviado só na barra: o nome acessível continua completo.
  expect(within(nav).getByRole('link', { name: 'Lançamentos' })).toHaveAttribute('href', '/lancamentos')
  expect(within(nav).getByRole('link', { name: 'Análise' })).toHaveAttribute('href', '/analise')
  expect(within(nav).getByRole('link', { name: 'Cartões' })).toHaveAttribute('href', '/cartoes')
})

test('phrase with nothing understood shows a hint and is recorded', async () => {
  const session = mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  const user = userEvent.setup()
  const field = await screen.findByLabelText('Novo lançamento')
  await user.type(field, 'dia 3:{Enter}')
  expect(await screen.findByText(/Não entendi essa frase/)).toHaveTextContent(
    "Não entendi essa frase. Tente como '42 mercado pix itaú'.",
  )
  expect(screen.getByText(/Não entendi essa frase/)).toHaveAttribute('role', 'status')
  expect(field).toHaveValue('dia 3:')
  expect(screen.queryByRole('heading', { name: /Confirmar/ })).not.toBeInTheDocument()
  await waitFor(() =>
    expect(session.recorded).toEqual([{ text: 'dia 3:', reasons: ['NOTHING_PARSED'] }]),
  )
  // Ao corrigir a frase, a dica some.
  await user.clear(field)
  await user.type(field, '42 mercado pix itaú{Enter}')
  expect(await screen.findByRole('heading', { name: 'Confirmar lançamento' })).toBeInTheDocument()
  expect(screen.queryByText(/Não entendi essa frase/)).not.toBeInTheDocument()
})

test('home warns when backup is stale', async () => {
  mockHome([], { last_success_at: '2026-10-12T06:00:00Z', stale: true })
  renderWithProviders(<AppRoutes />, { route: '/' })
  const warning = await screen.findByText(/O backup não roda há mais de 2 dias\./)
  expect(within(warning).getByRole('link', { name: 'Ver em Mais' })).toHaveAttribute('href', '/mais')
  await expectNoA11yViolations(document.body)
})

test('home says when backup never ran', async () => {
  mockHome([], { last_success_at: null, stale: true })
  renderWithProviders(<AppRoutes />, { route: '/' })
  expect(await screen.findByText(/O backup ainda não rodou\./)).toBeInTheDocument()
  expect(screen.queryByText(/mais de 2 dias/)).not.toBeInTheDocument()
})

test('fresh backup shows no warning on home', async () => {
  mockHome()
  renderWithProviders(<AppRoutes />, { route: '/' })
  await screen.findByText('R$ 1.008,00')
  await screen.findByLabelText('Novo lançamento')
  expect(screen.queryByText(/O backup não roda/)).not.toBeInTheDocument()
})
