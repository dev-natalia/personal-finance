import { describe, expect, test } from 'vitest'

import type { ParsedItem } from '../../domain/parser'
import {
  type CardItem,
  amountOf,
  canConfirm,
  cardReducer,
  initCard,
  missingFields,
  prepareSend,
  toRequestBody,
} from './cardState'

function parsed(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    raw: '42 mercado pix itaú',
    type: 'EXPENSE',
    amount: '42.00',
    description: 'mercado',
    occurredOn: '2026-10-15',
    accountId: 'acc-itau',
    paymentMethod: 'PIX',
    pending: [],
    ...overrides,
  }
}

function card(...items: ParsedItem[]): CardItem[] {
  return initCard(items.length > 0 ? items : [parsed()])
}

test('initCard maps parsed items', () => {
  const [first, second] = card(parsed(), parsed({ amount: null, description: null }))
  expect(first).toMatchObject({
    amountText: '42,00',
    description: 'mercado',
    included: true,
    status: 'draft',
    categoryId: null,
    duplicates: 0,
  })
  expect(second).toMatchObject({ amountText: '', description: '' })
  expect(first!.key).not.toBe(second!.key)
})

test('edit updates amount and clears error', () => {
  let state = card()
  state = cardReducer(state, { type: 'failed', index: 0, message: 'Sem conexão.' })
  state = cardReducer(state, { type: 'edit', index: 0, patch: { amountText: '50' } })
  expect(state[0]).toMatchObject({ amountText: '50', error: null, status: 'draft' })
  expect(amountOf(state[0]!)).toBe('50.00')
})

describe('missingFields', () => {
  test('reflects pending fields of an expense', () => {
    const [item] = card(
      parsed({ amount: null, description: null, accountId: null, paymentMethod: null }),
    )
    expect(missingFields(item!)).toEqual(['amount', 'description', 'account', 'paymentMethod'])
  })

  test('income never asks for a payment method', () => {
    const [item] = card(parsed({ type: 'INCOME', paymentMethod: null }))
    expect(missingFields(item!)).toEqual([])
  })

  test('zero or invalid amount counts as missing', () => {
    let state = card()
    state = cardReducer(state, { type: 'edit', index: 0, patch: { amountText: '0' } })
    expect(missingFields(state[0]!)).toEqual(['amount'])
    state = cardReducer(state, { type: 'edit', index: 0, patch: { amountText: '4,555' } })
    expect(missingFields(state[0]!)).toEqual(['amount'])
  })

  test('blank description counts as missing', () => {
    const state = cardReducer(card(), { type: 'edit', index: 0, patch: { description: '   ' } })
    expect(missingFields(state[0]!)).toEqual(['description'])
  })
})

test('canConfirm requires complete included items', () => {
  expect(canConfirm(card())).toBe(true)
  expect(canConfirm(card(parsed({ paymentMethod: null })))).toBe(false)
  const sending = cardReducer(card(), { type: 'sending', index: 0, key: 'k', sentBody: '{}' })
  expect(canConfirm(sending)).toBe(false)
})

test('unchecked items are ignored by canConfirm', () => {
  let state = card(parsed(), parsed({ paymentMethod: null }))
  expect(canConfirm(state)).toBe(false)
  state = cardReducer(state, { type: 'toggle', index: 1 })
  expect(canConfirm(state)).toBe(true)
  state = cardReducer(state, { type: 'toggle', index: 0 })
  expect(canConfirm(state)).toBe(false)
})

test('nothing left to confirm after everything is saved', () => {
  const state = cardReducer(card(), { type: 'saved', index: 0, line: 'ok', warnings: [] })
  expect(canConfirm(state)).toBe(false)
})

test('retry with the same content reuses the key', () => {
  let state = card()
  const first = prepareSend(state[0]!)
  state = cardReducer(state, { type: 'sending', index: 0, key: first.key, sentBody: first.sentBody })
  state = cardReducer(state, { type: 'failed', index: 0, message: 'Sem conexão.' })
  expect(state[0]).toMatchObject({ status: 'error', error: 'Sem conexão.' })
  expect(prepareSend(state[0]!).key).toBe(first.key)
})

test('retry after changing the content uses a new key', () => {
  let state = card()
  const first = prepareSend(state[0]!)
  state = cardReducer(state, { type: 'sending', index: 0, key: first.key, sentBody: first.sentBody })
  state = cardReducer(state, { type: 'failed', index: 0, message: 'Sem conexão.' })
  state = cardReducer(state, { type: 'edit', index: 0, patch: { description: 'padaria' } })
  expect(prepareSend(state[0]!).key).not.toBe(first.key)
})

test('typing and undoing an edit keeps the key', () => {
  let state = card()
  const first = prepareSend(state[0]!)
  state = cardReducer(state, { type: 'sending', index: 0, key: first.key, sentBody: first.sentBody })
  state = cardReducer(state, { type: 'failed', index: 0, message: 'Sem conexão.' })
  state = cardReducer(state, { type: 'edit', index: 0, patch: { description: 'mercadox' } })
  state = cardReducer(state, { type: 'edit', index: 0, patch: { description: 'mercado' } })
  expect(prepareSend(state[0]!).key).toBe(first.key)
})

test('editing never changes the item identity', () => {
  let state = card()
  const id = state[0]!.id
  state = cardReducer(state, { type: 'failed', index: 0, message: 'Sem conexão.' })
  state = cardReducer(state, { type: 'edit', index: 0, patch: { description: 'padaria' } })
  expect(state[0]!.id).toBe(id)
  expect(state[0]!.status).toBe('draft')
})

test('saved items are immutable', () => {
  let state = card()
  state = cardReducer(state, { type: 'saved', index: 0, line: 'Despesa registrada.', warnings: ['x'] })
  const saved = state[0]
  state = cardReducer(state, { type: 'edit', index: 0, patch: { amountText: '99' } })
  state = cardReducer(state, { type: 'toggle', index: 0 })
  expect(state[0]).toBe(saved)
  expect(saved).toMatchObject({ status: 'saved', savedLine: 'Despesa registrada.', warnings: ['x'] })
})

test('duplicates are recorded per item', () => {
  const state = cardReducer(card(parsed(), parsed()), { type: 'duplicates', index: 1, count: 2 })
  expect(state.map((i) => i.duplicates)).toEqual([0, 2])
})

describe('toRequestBody', () => {
  test('builds an expense without category when the suggestion was kept', () => {
    expect(toRequestBody(card()[0]!)).toEqual({
      type: 'EXPENSE',
      amount: '42.00',
      occurred_on: '2026-10-15',
      description: 'mercado',
      account_id: 'acc-itau',
      payment_method: 'PIX',
    })
  })

  test('sends category_id only when the user chose one', () => {
    const state = cardReducer(card(), { type: 'edit', index: 0, patch: { categoryId: 'cat-saude' } })
    expect(toRequestBody(state[0]!)).toMatchObject({ category_id: 'cat-saude' })
  })

  test('builds an income without payment method', () => {
    const body = toRequestBody(card(parsed({ type: 'INCOME', paymentMethod: null }))[0]!)
    expect(body).toEqual({
      type: 'INCOME',
      amount: '42.00',
      occurred_on: '2026-10-15',
      description: 'mercado',
      account_id: 'acc-itau',
    })
  })

  test('refuses an incomplete item', () => {
    expect(() => toRequestBody(card(parsed({ accountId: null }))[0]!)).toThrow()
  })
})
