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
  EMPTY_ANALYSIS,
  HINTS,
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
  mockApi()
  renderPage()
  const select = await screen.findByLabelText('Cartão ou conta')
  expect(await within(select).findByRole('option', { name: 'Carteira (arquivada)' })).toBeInTheDocument()
  expect(within(select).getByRole('option', { name: 'Crédito Inter (arquivado)' })).toBeInTheDocument()
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
