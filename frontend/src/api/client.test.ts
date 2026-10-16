import { HttpResponse, http } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { server } from '../test/server'
import { ApiError, UNAUTHENTICATED_EVENT, apiFetch, newIdempotencyKey } from './client'
import { api } from './endpoints'

afterEach(() => vi.restoreAllMocks())

test('returns parsed JSON and sends the CSRF header', async () => {
  let header: string | null = null
  server.use(
    http.get('/api/v1/health', ({ request }) => {
      header = request.headers.get('X-Requested-With')
      return HttpResponse.json({ status: 'ok' })
    }),
  )
  await expect(apiFetch('/api/v1/health')).resolves.toEqual({ status: 'ok' })
  expect(header).toBe('fetch')
})

test('turns Problem Details into ApiError', async () => {
  server.use(
    http.post('/api/v1/transactions', () =>
      HttpResponse.json(
        {
          status: 409,
          code: 'idempotency_key_reused',
          detail: 'Esta chave de idempotência já foi usada com outro conteúdo.',
          request_id: 'abc123',
        },
        { status: 409 },
      ),
    ),
  )
  const error = await apiFetch('/api/v1/transactions', { method: 'POST', body: {} }).catch(
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({
    status: 409,
    code: 'idempotency_key_reused',
    detail: 'Esta chave de idempotência já foi usada com outro conteúdo.',
    requestId: 'abc123',
  })
})

test('keeps field errors', async () => {
  server.use(
    http.post('/api/v1/accounts', () =>
      HttpResponse.json(
        {
          status: 422,
          code: 'validation_error',
          detail: 'Alguns campos são inválidos.',
          errors: [{ field: 'opening_balance', message: 'valor inválido' }],
        },
        { status: 422 },
      ),
    ),
  )
  const error = await apiFetch('/api/v1/accounts', { method: 'POST', body: {} }).catch(
    (e: unknown) => e,
  )
  expect((error as ApiError).fieldErrors).toEqual([
    { field: 'opening_balance', message: 'valor inválido' },
  ])
})

test('unreadable error body falls back to a generic message', async () => {
  server.use(http.get('/api/v1/health', () => new HttpResponse('oops', { status: 502 })))
  const error = await apiFetch('/api/v1/health').catch((e: unknown) => e)
  expect(error).toMatchObject({ status: 502, code: 'http_error', detail: 'Erro inesperado. Tente de novo.' })
})

test('network failure becomes network_error', async () => {
  server.use(http.get('/api/v1/health', () => HttpResponse.error()))
  const error = await apiFetch('/api/v1/health').catch((e: unknown) => e)
  expect(error).toMatchObject({
    status: 0,
    code: 'network_error',
    detail: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
  })
})

test('401 dispatches the unauthenticated event', async () => {
  const listener = vi.fn()
  window.addEventListener(UNAUTHENTICATED_EVENT, listener)
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({ status: 401, code: 'unauthenticated', detail: 'x' }, { status: 401 }),
    ),
  )
  await api.me().catch(() => undefined)
  window.removeEventListener(UNAUTHENTICATED_EVENT, listener)
  expect(listener).toHaveBeenCalledTimes(1)
})

test('204 resolves to undefined', async () => {
  server.use(http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })))
  await expect(api.logout()).resolves.toBeUndefined()
})

test('sends the idempotency key header', async () => {
  let key: string | null = null
  server.use(
    http.post('/api/v1/transactions', ({ request }) => {
      key = request.headers.get('Idempotency-Key')
      return HttpResponse.json({ transaction: {}, replayed: false, warnings: [] }, { status: 201 })
    }),
  )
  await api.createTransaction(
    {
      type: 'INCOME',
      amount: '10.00',
      occurred_on: '2026-10-15',
      description: 'Pix',
      account_id: 'acc',
    },
    'chave-teste-0001',
  )
  expect(key).toBe('chave-teste-0001')
})

test('newIdempotencyKey is unique', () => {
  expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
})
