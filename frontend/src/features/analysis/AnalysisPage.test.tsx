import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { expect, test } from 'vitest'

import type { AnalysisSummaryOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import {
  ACCOUNTS,
  ANALYSIS_SUMMARY,
  CARDS_SUMMARY,
  CATEGORIES,
  EMPTY_ANALYSIS,
  HINTS,
  transaction,
} from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { AnalysisPage } from './AnalysisPage'

function mockApi(summary: (params: URLSearchParams) => AnalysisSummaryOut = () => ANALYSIS_SUMMARY) {
  const queries: URLSearchParams[] = []
  server.use(
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/accounts', () =>
      HttpResponse.json([
        { ...ACCOUNTS.itau, opening_balance: '0.00', opening_date: '2026-09-01', archived_at: null },
        {
          ...ACCOUNTS.carteira,
          opening_balance: '0.00',
          opening_date: '2026-09-01',
          archived_at: '2026-10-01T12:00:00Z',
        },
      ]),
    ),
    http.get('/api/v1/cards', () =>
      HttpResponse.json([
        CARDS_SUMMARY[0]!.card,
        { ...CARDS_SUMMARY[0]!.card, id: 'card-inter', name: 'Inter', archived_at: '2026-10-01T12:00:00Z' },
      ]),
    ),
    http.get('/api/v1/categories', () => HttpResponse.json(CATEGORIES)),
    http.get('/api/v1/analysis/day', ({ request }) => {
      const day = new URL(request.url).searchParams.get('date')
      queries.push(new URL(request.url).searchParams)
      return HttpResponse.json(
        day === '2026-10-09'
          ? [
              { transaction: transaction({ description: 'Mercado Livre', amount: '120.00' }), amount: '120.00' },
              { transaction: transaction({ description: 'iFood', amount: '40.00' }), amount: '40.00' },
              {
                transaction: transaction({
                  description: 'farmácia',
                  amount: '15.00',
                  account_id: null,
                  payment_method: null,
                  card_id: 'card-inter',
                }),
                amount: '15.00',
              },
            ]
          : [],
      )
    }),
    http.get('/api/v1/analysis/summary', ({ request }) => {
      const params = new URL(request.url).searchParams
      queries.push(params)
      return HttpResponse.json(summary(params))
    }),
  )
  return queries
}

function LocationProbe() {
  return <p data-testid="search">{useLocation().search}</p>
}

function renderPage(route = '/analise') {
  const view = renderWithProviders(
    <Routes>
      <Route
        path="/analise"
        element={
          <>
            <AnalysisPage />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { route },
  )
  return { ...view, user: userEvent.setup() }
}

const last = (queries: URLSearchParams[]) => queries[queries.length - 1]!

test('analysis tab opens current month', async () => {
  const queries = mockApi()
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Análise' })).toBeInTheDocument()
  expect(await screen.findByText('Gasto em outubro')).toBeInTheDocument()
  expect(screen.getByText('R$ 270,50')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Mês' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Pelas parcelas' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: /›$/ })).not.toBeInTheDocument()
  expect(last(queries).get('period')).toBe('month')
  expect(last(queries).get('mode')).toBe('installments')
  expect(last(queries).has('date')).toBe(false)
})

test('period chips and arrows update the url', async () => {
  const queries = mockApi((params) =>
    params.get('period') === 'week'
      ? {
          ...ANALYSIS_SUMMARY,
          period: { kind: 'week', start: '2026-10-12', end: '2026-10-18', has_next: false },
        }
      : params.get('date') === '2026-09-30'
        ? {
            ...ANALYSIS_SUMMARY,
            period: { kind: 'month', start: '2026-09-01', end: '2026-09-30', has_next: true },
          }
        : ANALYSIS_SUMMARY,
  )
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: '‹ setembro' }))
  await waitFor(() => expect(last(queries).get('date')).toBe('2026-09-30'))
  expect(await screen.findByText('Gasto em setembro')).toBeInTheDocument()
  expect(screen.getByTestId('search')).toHaveTextContent('date=2026-09-30')
  expect(screen.getByRole('button', { name: 'outubro ›' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Semana' }))
  await waitFor(() => expect(last(queries).get('period')).toBe('week'))
  expect(await screen.findByText('Gasto de 12/10 a 18/10')).toBeInTheDocument()
  expect(screen.getByTestId('search')).not.toHaveTextContent('date=')
})

test('mode toggle sends purchase mode', async () => {
  const queries = mockApi()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Pela compra' }))
  await waitFor(() => expect(last(queries).get('mode')).toBe('purchase'))
  expect(screen.getByRole('button', { name: 'Pela compra' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('search')).toHaveTextContent('mode=purchase')
})

test('source filter sends card', async () => {
  const queries = mockApi()
  const { user } = renderPage()
  const select = await screen.findByLabelText('Cartão ou conta')
  await within(select).findByRole('option', { name: 'Crédito Nubank' })
  await user.selectOptions(select, 'Crédito Nubank')
  await waitFor(() => expect(last(queries).get('source')).toBe('card:card-nubank'))
})

test('archived sources still listed in the filter', async () => {
  mockApi(() => ({ ...ANALYSIS_SUMMARY, sources: ['account:acc-carteira', 'card:card-inter'] }))
  renderPage()
  const select = await screen.findByLabelText('Cartão ou conta')
  expect(await within(select).findByRole('option', { name: 'Carteira (arquivada)' })).toBeInTheDocument()
  expect(within(select).getByRole('option', { name: 'Crédito Inter (arquivado)' })).toBeInTheDocument()
})

test('archived sources without spending are not listed', async () => {
  mockApi()
  renderPage()
  const select = await screen.findByLabelText('Cartão ou conta')
  await within(select).findByRole('option', { name: 'Crédito Nubank' })
  expect(within(select).queryByRole('option', { name: 'Carteira (arquivada)' })).not.toBeInTheDocument()
  expect(within(select).queryByRole('option', { name: 'Crédito Inter (arquivado)' })).not.toBeInTheDocument()
})

test('empty period shows one line', async () => {
  mockApi(() => EMPTY_ANALYSIS)
  renderPage()
  expect(await screen.findByText('Nenhum gasto em outubro.')).toBeInTheDocument()
})

test('analysis page has no accessibility violations', async () => {
  mockApi()
  const { container } = renderPage()
  await screen.findByText('Gasto em outubro')
  await expectNoA11yViolations(container)
})

test('donut legend lists categories with amounts', async () => {
  mockApi()
  renderPage()
  const legend = await screen.findByRole('list', { name: 'Em que você gastou' })
  const rows = within(legend).getAllByRole('listitem').map((li) => li.textContent)
  expect(rows).toEqual([
    'Compras diversasR$ 120,00',
    'AlimentaçãoR$ 90,50',
    'MercadoR$ 60,00',
  ])
})

test('tapping a category filters places and calendar', async () => {
  const queries = mockApi()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Filtrar por Alimentação' }))
  await waitFor(() => expect(last(queries).get('category_id')).toBe('cat-alimentacao'))
  expect(screen.getByRole('button', { name: 'Filtrar por Alimentação' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByTestId('search')).toHaveTextContent('category=cat-alimentacao')
  await user.click(screen.getByRole('button', { name: 'Limpar filtro' }))
  await waitFor(() => expect(last(queries).has('category_id')).toBe(false))
})

test('Outras does not filter', async () => {
  mockApi(() => ({
    ...ANALYSIS_SUMMARY,
    by_category: [
      ...ANALYSIS_SUMMARY.by_category,
      { category_id: null, name: 'Outras', amount: '10.00' },
    ],
  }))
  renderPage()
  const legend = await screen.findByRole('list', { name: 'Em que você gastou' })
  expect(within(legend).getByText('Outras')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Filtrar por Outras' })).not.toBeInTheDocument()
})

test('ranking shows five and expands', async () => {
  const places = Array.from({ length: 7 }, (_, k) => ({
    key: `d:lugar ${k + 1}`,
    name: `Lugar ${k + 1}`,
    amount: `${70 - k * 10}.00`,
    purchases: k + 1,
    category_name: 'Mercado',
  }))
  mockApi(() => ({ ...ANALYSIS_SUMMARY, by_place: places }))
  const { user } = renderPage()
  const ranking = await screen.findByRole('list', { name: 'Onde você mais gastou' })
  expect(within(ranking).getAllByRole('listitem')).toHaveLength(5)
  expect(within(ranking).getByText('1 compra · Mercado')).toBeInTheDocument()
  expect(within(ranking).getByText('2 compras · Mercado')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Ver todos os 7 lugares' }))
  expect(within(ranking).getAllByRole('listitem')).toHaveLength(7)
})

test('place links carry only the mode', async () => {
  mockApi()
  renderPage('/analise?mode=purchase&source=card:card-nubank')
  const link = await screen.findByRole('link', { name: 'iFood' })
  // A tela do lugar mostra todas as compras de lá; o filtro de cartão não vai junto.
  expect(link).toHaveAttribute('href', '/analise/lugar/m%3Amerchant-ifood?mode=purchase')
})

test('calendar starts on monday', async () => {
  mockApi()
  renderPage()
  const calendar = await screen.findByRole('table', { name: 'Seus dias' })
  const headers = within(calendar).getAllByRole('columnheader').map((h) => h.textContent)
  expect(headers).toEqual(['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'])
  const [firstWeek] = within(calendar).getAllByRole('row').slice(1)
  const cells = within(firstWeek!).getAllByRole('cell')
  expect(cells.slice(0, 3).map((c) => c.textContent)).toEqual(['', '', ''])
  expect(within(cells[3]!).getByRole('button', { name: '01/10: sem gasto' })).toBeInTheDocument()
})

test('busiest day and days without spending', async () => {
  mockApi()
  renderPage()
  expect(await screen.findByText('Dia mais caro: 09/10, R$ 160,00')).toBeInTheDocument()
  // De 1º a 15/10 (hoje), só três dias tiveram gasto.
  expect(screen.getByText('Sem gasto: 12 dias')).toBeInTheDocument()
})

test('tapping a day lists its spending', async () => {
  const queries = mockApi()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: '09/10: R$ 160,00' }))
  const details = await screen.findByRole('region', { name: 'Gastos de 09/10' })
  expect(await within(details).findByText('Mercado Livre')).toBeInTheDocument()
  expect(within(details).getByText('R$ 120,00')).toBeInTheDocument()
  expect(within(details).getAllByText('Mercado, Pix Itaú')).toHaveLength(2)
  expect(last(queries).get('date')).toBe('2026-10-09')
})

test('week shows seven days', async () => {
  mockApi(() => ({
    ...ANALYSIS_SUMMARY,
    period: { kind: 'week', start: '2026-10-12', end: '2026-10-18', has_next: false },
    by_day: [{ day: '2026-10-15', amount: '20.50' }],
    busiest: { day: '2026-10-15', amount: '20.50' },
  }))
  renderPage('/analise?period=week')
  const calendar = await screen.findByRole('table', { name: 'Seus dias' })
  expect(within(calendar).getAllByRole('button')).toHaveLength(7)
  expect(within(calendar).getByRole('button', { name: '15/10: R$ 20,50' })).toBeInTheDocument()
})

test('year shows months and opens the month', async () => {
  const queries = mockApi((params) =>
    params.get('period') === 'year'
      ? {
          ...ANALYSIS_SUMMARY,
          period: { kind: 'year', start: '2026-01-01', end: '2026-10-31', has_next: false },
          by_day: [
            { day: '2026-09-01', amount: '30.00' },
            { day: '2026-10-01', amount: '270.50' },
          ],
          busiest: { day: '2026-10-01', amount: '270.50' },
        }
      : ANALYSIS_SUMMARY,
  )
  const { user } = renderPage('/analise?period=year')
  const months = await screen.findByRole('list', { name: 'Seus meses' })
  expect(within(months).getAllByRole('button')).toHaveLength(10)
  expect(screen.getByText('Mês mais caro: outubro, R$ 270,50')).toBeInTheDocument()
  await user.click(within(months).getByRole('button', { name: 'setembro: R$ 30,00' }))
  await waitFor(() => expect(last(queries).get('period')).toBe('month'))
  expect(last(queries).get('date')).toBe('2026-09-01')
})

test('refund-only place shows a negative amount', async () => {
  mockApi(() => ({
    ...ANALYSIS_SUMMARY,
    by_place: [
      ...ANALYSIS_SUMMARY.by_place,
      { key: 'm:merchant-amazon', name: 'Amazon', amount: '-50.00', purchases: 0, category_name: 'Compras diversas' },
    ],
  }))
  renderPage()
  const ranking = await screen.findByRole('list', { name: 'Onde você mais gastou' })
  const amazon = within(ranking).getByRole('link', { name: 'Amazon' }).closest('li')!
  expect(within(amazon).getByText('−R$ 50,00')).toBeInTheDocument()
  expect(within(amazon).getByText('Estorno · Compras diversas')).toBeInTheDocument()
})

test('calendar is one tab stop and arrows move between days', async () => {
  mockApi()
  const { user } = renderPage()
  const calendar = await screen.findByRole('table', { name: 'Seus dias' })
  const focusable = within(calendar)
    .getAllByRole('button')
    .filter((b) => b.tabIndex === 0)
  expect(focusable.map((b) => b.getAttribute('aria-label'))).toEqual(['15/10: R$ 20,50'])
  focusable[0]!.focus()
  await user.keyboard('{ArrowRight}')
  expect(within(calendar).getByRole('button', { name: '16/10: sem gasto' })).toHaveFocus()
  await user.keyboard('{ArrowUp}')
  expect(within(calendar).getByRole('button', { name: '09/10: R$ 160,00' })).toHaveFocus()
  await user.keyboard('{Home}')
  expect(within(calendar).getByRole('button', { name: '01/10: sem gasto' })).toHaveFocus()
  await user.keyboard('{End}')
  expect(within(calendar).getByRole('button', { name: '31/10: sem gasto' })).toHaveFocus()
})

test('days without spending wait for today', async () => {
  mockApi()
  server.use(http.get('/api/v1/entry-hints', () => new Promise<Response>(() => {})))
  renderPage()
  await screen.findByText('Dia mais caro: 09/10, R$ 160,00')
  expect(screen.queryByText(/Sem gasto/)).not.toBeInTheDocument()
})

test('day details name archived cards', async () => {
  mockApi()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: '09/10: R$ 160,00' }))
  const details = await screen.findByRole('region', { name: 'Gastos de 09/10' })
  expect(await within(details).findByText('Mercado, crédito Inter')).toBeInTheDocument()
})
