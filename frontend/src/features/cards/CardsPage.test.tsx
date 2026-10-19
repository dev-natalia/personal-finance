import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { type InitialEntry, Route, Routes } from 'react-router'
import { expect, test } from 'vitest'

import type { CardSummaryOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { cycleHandler } from '../../test/cycle'
import { CARDS_SUMMARY, HINTS } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { CardsPage } from './CardsPage'
import { NewCardPage } from './NewCardPage'

function mockCards(summary: CardSummaryOut[] = CARDS_SUMMARY) {
  const created: unknown[] = []
  server.use(
    http.get('/api/v1/cards/summary', () => HttpResponse.json(summary)),
    http.get('/api/v1/cards', () => HttpResponse.json(summary.map((s) => s.card))),
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    cycleHandler(),
    http.post('/api/v1/cards', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      created.push(body)
      return HttpResponse.json(
        { ...CARDS_SUMMARY[0]!.card, ...body, id: 'card-new', archived_at: null },
        { status: 201 },
      )
    }),
  )
  return { created }
}

function renderCards(route: InitialEntry = '/cartoes') {
  const view = renderWithProviders(
    <Routes>
      <Route path="/cartoes" element={<CardsPage />} />
      <Route path="/cartoes/novo" element={<NewCardPage />} />
    </Routes>,
    { route },
  )
  return { ...view, user: userEvent.setup() }
}

test('cards tab lists each card with invoice, dates and free limit', async () => {
  mockCards()
  renderCards()
  expect(await screen.findByRole('heading', { name: 'Cartões' })).toBeInTheDocument()
  const list = await screen.findByRole('list', { name: 'Seus cartões' })
  const block = await within(list).findByRole('listitem')
  expect(within(block).getByRole('link', { name: /Nubank/ })).toHaveAttribute(
    'href',
    '/cartoes/card-nubank',
  )
  expect(within(block).getByText('Fatura de novembro (aberta)')).toBeInTheDocument()
  expect(within(block).getByText('R$ 1.240,00')).toBeInTheDocument()
  expect(within(block).getByText('Fecha 03/11 · vence 10/11')).toBeInTheDocument()
  expect(within(block).getByText('R$ 1.560,00 de R$ 11.000,00')).toBeInTheDocument()
  expect(within(block).getByRole('img', { name: 'Limite usado: R$ 9.440,00 de R$ 11.000,00' }))
    .toBeInTheDocument()
})

test('closed invoice to pay shows what is left', async () => {
  const summary = structuredClone(CARDS_SUMMARY)
  summary[0]!.payable!.balance = '800.00'
  mockCards(summary)
  renderCards()
  const list = await screen.findByRole('list', { name: 'Seus cartões' })
  const block = await within(list).findByRole('listitem')
  expect(within(block).getByText('Fatura de outubro: falta pagar')).toBeInTheDocument()
  expect(within(block).getByText('R$ 800,00 · vence 10/10')).toBeInTheDocument()
})

test('no cards invites to add one', async () => {
  mockCards([])
  renderCards()
  expect(await screen.findByText(/Nenhum cartão ainda/)).toBeInTheDocument()
})

test('add card opens its own page and returns to Cards', async () => {
  const api = mockCards()
  const { user } = renderCards()
  await user.click(await screen.findByRole('link', { name: '+ Adicionar cartão' }))
  expect(await screen.findByRole('heading', { name: 'Novo cartão' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Nome do cartão'), 'Inter')
  await user.type(screen.getByLabelText('Limite'), '2.000')
  await user.selectOptions(screen.getByLabelText('Fecha no dia'), '20')
  await user.selectOptions(screen.getByLabelText('Vence no dia'), '27')
  await user.click(screen.getByRole('button', { name: 'Criar cartão' }))
  await waitFor(() => expect(api.created).toHaveLength(1))
  expect(await screen.findByRole('heading', { name: 'Cartões' })).toBeInTheDocument()
  expect(await screen.findByRole('status')).toHaveTextContent('Cartão Inter criado.')
})

test('cancel on the new card page goes back to Cards', async () => {
  mockCards()
  const { user } = renderCards('/cartoes/novo')
  await user.click(await screen.findByRole('button', { name: 'Cancelar' }))
  expect(await screen.findByRole('heading', { name: 'Cartões' })).toBeInTheDocument()
})

test('archiving a card returns to Cards with the message', async () => {
  mockCards()
  renderCards({ pathname: '/cartoes', state: { message: 'Cartão Nubank arquivado.' } })
  expect(await screen.findByRole('status')).toHaveTextContent('Cartão Nubank arquivado.')
})

test('archived cards can be unarchived', async () => {
  mockCards()
  const unarchived: string[] = []
  const inter = {
    id: 'card-inter',
    name: 'Inter',
    credit_limit: '2000.00',
    closing_day: 20,
    due_day: 27,
    opening_date: '2026-09-01',
    archived_at: '2026-10-15T15:00:00Z',
  }
  server.use(
    http.get('/api/v1/cards', () => HttpResponse.json([CARDS_SUMMARY[0]!.card, inter])),
    http.post('/api/v1/cards/:id/unarchive', ({ params }) => {
      unarchived.push(String(params.id))
      return HttpResponse.json({ ...inter, archived_at: null })
    }),
  )
  const { user } = renderCards()
  await user.click(await screen.findByText('Cartões arquivados'))
  const archived = await screen.findByRole('list', { name: 'Cartões arquivados' })
  await user.click(await within(archived).findByRole('button', { name: 'Desarquivar Inter' }))
  await waitFor(() => expect(unarchived).toEqual(['card-inter']))
  expect(await screen.findByRole('status')).toHaveTextContent('Cartão Inter desarquivado.')
})

test('cards page has no accessibility violations', async () => {
  mockCards()
  const { container } = renderCards()
  await within(await screen.findByRole('list', { name: 'Seus cartões' })).findByRole('listitem')
  await expectNoA11yViolations(container)
})
