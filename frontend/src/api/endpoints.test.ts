import { HttpResponse, http } from 'msw'
import { expect, test } from 'vitest'

import { server } from '../test/server'
import { api } from './endpoints'

test('payInvoice sends the idempotency key and remainder', async () => {
  let sent: { key: string | null; body: unknown } | null = null
  server.use(
    http.post('/api/v1/invoices/:id/payments', async ({ request, params }) => {
      expect(params.id).toBe('inv-outubro')
      sent = { key: request.headers.get('Idempotency-Key'), body: await request.json() }
      return HttpResponse.json(
        { group_id: 'g-1', payments: [], charge: null, replayed: false, warnings: [] },
        { status: 201 },
      )
    }),
  )
  const body = {
    occurred_on: '2026-10-15',
    sources: [{ account_id: 'acc-itau', amount: '120.00' }],
    remainder: { installments: 3, installment_amount: '65.00' },
  }
  const result = await api.payInvoice('inv-outubro', body, 'chave-pagamento-1')
  expect(result.group_id).toBe('g-1')
  expect(sent).toEqual({ key: 'chave-pagamento-1', body })
})

test('previewPurchase posts installments only when set', async () => {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/cards/:id/preview', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({
        invoice: { reference_month: '2026-11-01', before: '0.00', after: '38.00' },
        following: [],
        limit_before: '11000.00',
        limit_after: '10962.00',
      })
    }),
  )
  await api.previewPurchase('card-nubank', { amount: '38.00', occurred_on: '2026-10-15' })
  await api.previewPurchase('card-nubank', {
    amount: '1200.00',
    installments: 6,
    occurred_on: '2026-10-15',
  })
  expect(bodies).toEqual([
    { amount: '38.00', occurred_on: '2026-10-15' },
    { amount: '1200.00', installments: 6, occurred_on: '2026-10-15' },
  ])
})

test('cardInvoices sends before only when paging', async () => {
  const urls: string[] = []
  server.use(
    http.get('/api/v1/cards/:id/invoices', ({ request }) => {
      urls.push(new URL(request.url).search)
      return HttpResponse.json({ open: null, future: [], previous: [], next_before: null })
    }),
  )
  await api.cardInvoices('card-nubank')
  await api.cardInvoices('card-nubank', '2026-09-01')
  expect(urls).toEqual(['', '?before=2026-09-01'])
})
