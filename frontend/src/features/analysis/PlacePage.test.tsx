import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { expect, test } from 'vitest'

import type { PlaceDetailOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { CARDS, CATEGORIES, HINTS, transaction } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { PlacePage } from './PlacePage'

const DETAIL: PlaceDetailOut = {
  key: 'm:merchant-ifood',
  name: 'iFood',
  category_name: 'Alimentação',
  week: { amount: '40.00', purchases: 1 },
  month: { amount: '70.00', purchases: 2 },
  year: { amount: '90.00', purchases: 3 },
  average: '30.00',
}

const PIX = transaction({ id: 'tx-pix', description: 'iFood', amount: '40.00', category_id: 'cat-alimentacao' })
const CARD = transaction({
  id: 'tx-card',
  description: 'iFood',
  amount: '30.00',
  occurred_on: '2026-10-09',
  account_id: null,
  payment_method: null,
  card_id: CARDS.nubank.id,
  category_id: 'cat-alimentacao',
})
const OLD = transaction({ id: 'tx-old', description: 'iFood', amount: '20.00', occurred_on: '2026-09-20' })

function mockApi(detail: PlaceDetailOut = DETAIL) {
  const detailQueries: URLSearchParams[] = []
  const pageQueries: URLSearchParams[] = []
  server.use(
    http.get('/api/v1/entry-hints', () => HttpResponse.json(HINTS)),
    http.get('/api/v1/categories', () => HttpResponse.json(CATEGORIES)),
    http.get('/api/v1/analysis/places/:key', ({ request, params }) => {
      expect(params.key).toBe('m:merchant-ifood')
      detailQueries.push(new URL(request.url).searchParams)
      return HttpResponse.json(detail)
    }),
    http.get('/api/v1/analysis/places/:key/transactions', ({ request }) => {
      const query = new URL(request.url).searchParams
      pageQueries.push(query)
      if (query.get('source') === `card:${CARDS.nubank.id}`) {
        return HttpResponse.json({ items: [CARD], next_cursor: null })
      }
      if (query.get('cursor') === 'c2') return HttpResponse.json({ items: [OLD], next_cursor: null })
      return HttpResponse.json({ items: [PIX, CARD], next_cursor: 'c2' })
    }),
  )
  return { detailQueries, pageQueries }
}

function renderPage(route = '/analise/lugar/m%3Amerchant-ifood') {
  const view = renderWithProviders(
    <Routes>
      <Route path="/analise/lugar/:key" element={<PlacePage />} />
    </Routes>,
    { route },
  )
  return { ...view, user: userEvent.setup() }
}

test('place page shows week month and year', async () => {
  const { detailQueries } = mockApi()
  renderPage('/analise/lugar/m%3Amerchant-ifood?mode=purchase')
  expect(await screen.findByRole('heading', { name: 'iFood' })).toBeInTheDocument()
  expect(screen.getByText('Alimentação')).toBeInTheDocument()
  const boxes = screen.getByRole('list', { name: 'Totais do lugar' })
  expect(within(boxes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    'Esta semanaR$ 40,001 compra',
    'OutubroR$ 70,002 compras',
    '2026R$ 90,003 compras',
  ])
  expect(screen.getByText('Média por compra: R$ 30,00')).toBeInTheDocument()
  expect(detailQueries[0]!.get('mode')).toBe('purchase')
})

test('average hidden without purchases', async () => {
  mockApi({ ...DETAIL, average: null })
  renderPage()
  await screen.findByRole('heading', { name: 'iFood' })
  expect(screen.queryByText(/Média por compra/)).not.toBeInTheDocument()
})

test('purchases filter by source and paginate', async () => {
  const { pageQueries } = mockApi()
  const { user } = renderPage()
  const purchases = await screen.findByRole('region', { name: 'Compras' })
  expect(await within(purchases).findByText('Alimentação, crédito Nubank')).toBeInTheDocument()
  await user.click(within(purchases).getByRole('button', { name: 'Carregar mais' }))
  expect(await within(purchases).findByText('−20,00')).toBeInTheDocument()
  await user.click(within(purchases).getByRole('button', { name: 'Crédito Nubank' }))
  await waitFor(() =>
    expect(pageQueries[pageQueries.length - 1]!.get('source')).toBe(`card:${CARDS.nubank.id}`),
  )
  expect(within(purchases).getByRole('button', { name: 'Crédito Nubank' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await waitFor(() => expect(within(purchases).queryByText('−40,00')).not.toBeInTheDocument())
})

test('place page has no accessibility violations', async () => {
  mockApi()
  const { container } = renderPage()
  await screen.findByText('Alimentação, crédito Nubank')
  await expectNoA11yViolations(container)
})
