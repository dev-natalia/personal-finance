import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { UNAUTHENTICATED_EVENT } from '../../api/client'
import type { TransactionOut } from '../../api/types'
import { AppRoutes } from '../../routes'
import { expectNoA11yViolations } from '../../test/axe'
import { ACCOUNTS, BALANCES, CATEGORIES, HINTS, USER, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'

afterEach(() => vi.restoreAllMocks())

const unauthenticated = () =>
  HttpResponse.json({ status: 401, code: 'unauthenticated', detail: 'x' }, { status: 401 })

/** API da tela inicial; `signedIn` controla a sessão para simular a expiração. */
function mockHome(items: TransactionOut[] = []) {
  const session = { signedIn: true }
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
    http.get('/api/v1/merchants', () => HttpResponse.json([])),
    http.post('/api/v1/entry-checks', () => HttpResponse.json({ results: [] })),
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
