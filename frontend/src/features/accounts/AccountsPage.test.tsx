import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { expect, test } from 'vitest'

import type { AccountOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { ACCOUNTS, BALANCES, CARDS_SUMMARY, HINTS } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { AccountsPage } from './AccountsPage'

const ACCOUNT_LIST: AccountOut[] = [
  { ...ACCOUNTS.carteira, opening_balance: '50.00', opening_date: '2026-10-01', archived_at: null },
  { ...ACCOUNTS.itau, opening_balance: '1000.00', opening_date: '2026-10-01', archived_at: null },
]

interface Captured {
  created: unknown[]
  updated: unknown[]
  archived: string[]
}

function mockAccounts(): Captured {
  const captured: Captured = { created: [], updated: [], archived: [] }
  server.use(
    http.get('/api/v1/accounts/balances', () => HttpResponse.json(BALANCES)),
    http.get('/api/v1/accounts', () => HttpResponse.json(ACCOUNT_LIST)),
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/cards/summary', () => HttpResponse.json(CARDS_SUMMARY)),
    http.post('/api/v1/accounts', async ({ request }) => {
      const body = (await request.json()) as { name: string }
      captured.created.push(body)
      if (body.name === 'Itaú') {
        return HttpResponse.json(
          { status: 409, code: 'name_already_exists', detail: 'Já existe uma conta com esse nome.' },
          { status: 409 },
        )
      }
      return HttpResponse.json({ ...ACCOUNT_LIST[1], ...body, id: 'acc-new' }, { status: 201 })
    }),
    http.patch('/api/v1/accounts/:id', async ({ request }) => {
      captured.updated.push(await request.json())
      return HttpResponse.json(ACCOUNT_LIST[1])
    }),
    http.post('/api/v1/accounts/:id/archive', ({ params }) => {
      captured.archived.push(String(params.id))
      return HttpResponse.json({
        account: { ...ACCOUNT_LIST[1], archived_at: '2026-10-15T15:00:00Z' },
        warnings: [
          { code: 'archived_with_balance', detail: 'A conta foi arquivada com saldo de R$ 958,00.' },
        ],
      })
    }),
  )
  return captured
}

function renderPage() {
  const view = renderWithProviders(<AccountsPage />, { route: '/contas' })
  return { ...view, user: userEvent.setup() }
}

async function fillNewAccount(user: ReturnType<typeof userEvent.setup>, name: string, amount: string) {
  await user.click(await screen.findByRole('button', { name: '+ Adicionar conta' }))
  const form = within(screen.getByRole('dialog', { name: 'Nova conta' })).getByRole('form', {
    name: 'Nova conta',
  })
  await user.type(within(form).getByLabelText('Nome'), name)
  await user.selectOptions(within(form).getByLabelText('Tipo'), 'Poupança')
  await user.type(within(form).getByLabelText('Saldo de abertura'), amount)
  await user.click(within(form).getByRole('button', { name: 'Criar conta' }))
}

test('page title is Contas', async () => {
  mockAccounts()
  renderPage()
  expect(await screen.findByRole('heading', { level: 1, name: 'Contas' })).toBeInTheDocument()
  // O formulário de nova conta não fica mais aberto no meio da página.
  expect(screen.queryByRole('form', { name: 'Nova conta' })).not.toBeInTheDocument()
})

test('creates an account from the add sheet', async () => {
  const captured = mockAccounts()
  const { user } = renderPage()
  await fillNewAccount(user, 'Reserva', '1.000,50')
  await waitFor(() => expect(captured.created).toHaveLength(1))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('status')).toHaveTextContent('Conta Reserva criada.')
  expect(screen.getByRole('button', { name: '+ Adicionar conta' })).toHaveFocus()
})

test('cancel closes the add sheet without creating', async () => {
  const captured = mockAccounts()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: '+ Adicionar conta' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(captured.created).toEqual([])
  expect(screen.getByRole('button', { name: '+ Adicionar conta' })).toHaveFocus()
})

test('account options open in a sheet', async () => {
  mockAccounts()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Opções de Itaú' }))
  const dialog = screen.getByRole('dialog', { name: 'Itaú' })
  expect(within(dialog).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Arquivar' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Opções de Itaú' })).toHaveFocus()
})

test('accounts page has no cards section', async () => {
  mockAccounts()
  renderPage()
  await screen.findByText('Itaú')
  expect(screen.queryByRole('region', { name: 'Cartões' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Adicionar cartão/ })).not.toBeInTheDocument()
})

test('lists accounts with formatted balances', async () => {
  mockAccounts()
  renderPage()
  const list = await screen.findByRole('list', { name: 'Suas contas' })
  expect(await within(list).findByText('R$ 958,00')).toBeInTheDocument()
  expect(within(list).getByText('Conta corrente')).toBeInTheDocument()
  // Conta "Carteira" do tipo "Carteira": nome e tipo.
  expect(within(list).getAllByText('Carteira')).toHaveLength(2)
  expect(screen.getByText('R$ 1.008,00')).toBeInTheDocument()
})

test('creates an account sending the canonical amount', async () => {
  const captured = mockAccounts()
  const { user } = renderPage()
  // A região de status já existe (vazia) antes da primeira mensagem, para o leitor de tela ler.
  const status = await screen.findByRole('status')
  expect(status).toBeEmptyDOMElement()
  await fillNewAccount(user, 'Reserva', '1.000,50')
  await waitFor(() => expect(captured.created).toHaveLength(1))
  expect(captured.created[0]).toEqual({
    name: 'Reserva',
    type: 'SAVINGS',
    opening_balance: '1000.50',
    opening_date: '2026-10-01',
  })
  await waitFor(() => expect(status).toHaveTextContent('Conta Reserva criada.'))
  expect(screen.getByRole('status')).toBe(status)
})

test('accepts a negative opening balance', async () => {
  const captured = mockAccounts()
  const { user } = renderPage()
  await fillNewAccount(user, 'Especial', '-250')
  await waitFor(() => expect(captured.created).toHaveLength(1))
  expect(captured.created[0]).toMatchObject({ opening_balance: '-250.00' })
})

test('invalid amount is reported without calling the server', async () => {
  const captured = mockAccounts()
  const { user } = renderPage()
  await fillNewAccount(user, 'Reserva', '12,345')
  expect(await screen.findByText('Use um valor como 1.234,56.')).toBeInTheDocument()
  expect(screen.getByLabelText('Saldo de abertura')).toHaveAttribute('aria-invalid', 'true')
  expect(captured.created).toEqual([])
})

test('shows the server message for duplicate names', async () => {
  mockAccounts()
  const { user } = renderPage()
  await fillNewAccount(user, 'Itaú', '10')
  expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma conta com esse nome.')
})

test('editing sends the new name and type', async () => {
  const captured = mockAccounts()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Opções de Itaú' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Editar' }))
  const form = screen.getByRole('form', { name: 'Editar Itaú' })
  const name = within(form).getByLabelText('Nome')
  await user.clear(name)
  await user.type(name, 'Itaú PF')
  await user.click(within(form).getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(captured.updated).toEqual([{ name: 'Itaú PF', type: 'CHECKING' }]))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('archiving asks for confirmation and shows the balance warning', async () => {
  const captured = mockAccounts()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Opções de Itaú' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Arquivar' }))
  expect(captured.archived).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Arquivar conta' }))
  await waitFor(() => expect(captured.archived).toEqual([ACCOUNTS.itau.id]))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'A conta foi arquivada com saldo de R$ 958,00.',
  )
})

test('accounts page has no accessibility violations', async () => {
  mockAccounts()
  const { container, user } = renderPage()
  await screen.findByText('R$ 958,00')
  await expectNoA11yViolations(container)
  await user.click(screen.getByRole('button', { name: '+ Adicionar conta' }))
  await expectNoA11yViolations(container)
})

test('focus returns to the row after editing and to the message after archiving', async () => {
  mockAccounts()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Opções de Itaú' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Editar' }))
  const form = screen.getByRole('form', { name: 'Editar Itaú' })
  await user.click(within(form).getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Opções de Itaú' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Opções de Itaú' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Arquivar' }))
  await user.click(screen.getByRole('button', { name: 'Arquivar conta' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
})

test('archived accounts leave the total and can be unarchived', async () => {
  mockAccounts()
  const unarchived: string[] = []
  const antiga = { ...ACCOUNT_LIST[1]!, id: 'acc-antiga', name: 'Antiga', archived_at: '2026-10-15T15:00:00Z' }
  server.use(
    http.get('/api/v1/accounts', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get('include_archived') ? [...ACCOUNT_LIST, antiga] : ACCOUNT_LIST,
      ),
    ),
    http.get('/api/v1/accounts/balances', () =>
      HttpResponse.json({
        ...BALANCES,
        archived_total: '300.00',
        accounts: [
          ...BALANCES.accounts,
          { account_id: 'acc-antiga', name: 'Antiga', archived: true, balance: '300.00' },
        ],
      }),
    ),
    http.post('/api/v1/accounts/:id/unarchive', ({ params }) => {
      unarchived.push(String(params.id))
      return HttpResponse.json({ ...antiga, archived_at: null })
    }),
  )
  const user = userEvent.setup()
  renderWithProviders(<AccountsPage />, { route: '/contas' })
  expect(await screen.findByText('R$ 300,00 em contas arquivadas')).toBeInTheDocument()
  await user.click(screen.getByText('Contas arquivadas'))
  const archived = await screen.findByRole('list', { name: 'Contas arquivadas' })
  expect(await within(archived).findByText('Antiga')).toBeInTheDocument()
  expect(within(archived).getByText('R$ 300,00')).toBeInTheDocument()
  await user.click(within(archived).getByRole('button', { name: 'Desarquivar Antiga' }))
  await waitFor(() => expect(unarchived).toEqual(['acc-antiga']))
  expect(await screen.findByRole('status')).toHaveTextContent('Conta Antiga desarquivada.')
})

