import { describe, expect, test } from 'vitest'

import { type EntryAccount, type ParsedItem, parseEntry } from './parser'

const ITAU: EntryAccount = { id: 'itau', name: 'Itaú', type: 'CHECKING' }
const NUBANK: EntryAccount = { id: 'nubank', name: 'Nubank', type: 'CHECKING' }
const CARTEIRA: EntryAccount = { id: 'carteira', name: 'Carteira', type: 'CASH' }
const TODAY = '2026-10-15'
const CTX = { today: TODAY, accounts: [ITAU, NUBANK, CARTEIRA] }

function only(text: string, ctx = CTX): ParsedItem {
  const items = parseEntry(text, ctx)
  expect(items).toHaveLength(1)
  return items[0]!
}

describe('parseEntry', () => {
  test.each<[string, Partial<ParsedItem>]>([
    [
      '42 mercado pix itaú',
      {
        type: 'EXPENSE',
        amount: '42.00',
        description: 'mercado',
        occurredOn: TODAY,
        accountId: 'itau',
        paymentMethod: 'PIX',
        pending: [],
      },
    ],
    [
      '42,50 padaria',
      { amount: '42.50', description: 'padaria', pending: ['account', 'paymentMethod'] },
    ],
    [
      'gastei 120 na farmácia ontem no débito nubank',
      {
        amount: '120.00',
        description: 'farmácia',
        occurredOn: '2026-10-14',
        accountId: 'nubank',
        paymentMethod: 'DEBIT',
        pending: [],
      },
    ],
    ['dia 3: 35 ifood', { amount: '35.00', description: 'ifood', occurredOn: '2026-10-03' }],
    [
      '+120 reembolso',
      {
        type: 'INCOME',
        amount: '120.00',
        description: 'reembolso',
        paymentMethod: null,
        pending: ['account'],
      },
    ],
    [
      'recebi 3000 salário itaú',
      { type: 'INCOME', amount: '3000.00', description: 'salário', accountId: 'itau', pending: [] },
    ],
    [
      '50 dinheiro feira',
      { paymentMethod: 'CASH', accountId: 'carteira', description: 'feira', pending: [] },
    ],
    ['R$ 42 mercado', { amount: '42.00', description: 'mercado' }],
    ['42 pão de açúcar pix', { description: 'pão de açúcar', paymentMethod: 'PIX' }],
    ['2 cafés 15', { amount: null, description: '2 cafés 15' }],
    ['42', { amount: '42.00', description: null }],
    ['mercado pix', { amount: null, description: 'mercado' }],
  ])('%j', (text, expected) => {
    expect(only(text)).toMatchObject(expected)
  })

  test('pending lists every missing field of an expense', () => {
    expect(only('mercado').pending).toEqual(['amount', 'account', 'paymentMethod'])
    expect(only('42').pending).toEqual(['description', 'account', 'paymentMethod'])
  })

  test('matches account names ignoring case and accents', () => {
    expect(only('42 mercado pix ITAU').accountId).toBe('itau')
    expect(only('42 mercado pix itau').accountId).toBe('itau')
  })

  test('prefers the longest account name', () => {
    const ctx = { today: TODAY, accounts: [ITAU, { id: 'itau-pj', name: 'Itaú PJ', type: 'CHECKING' as const }] }
    const item = only('10 lanche itaú pj pix', ctx)
    expect(item.accountId).toBe('itau-pj')
    expect(item.description).toBe('lanche')
  })

  test('ambiguous accounts stay pending', () => {
    const item = only('42 mercado itaú nubank pix')
    expect(item.accountId).toBeNull()
    expect(item.pending).toContain('account')
  })

  test('a cash account implies the cash method', () => {
    expect(only('20 feira carteira')).toMatchObject({ accountId: 'carteira', paymentMethod: 'CASH' })
  })

  test('zero is not an amount', () => {
    expect(only('0 mercado pix itaú').amount).toBeNull()
  })

  test('splits batch by semicolon and newline', () => {
    const items = parseEntry('hoje: almoço 30; café 8\nuber 22', CTX)
    expect(items.map((i) => [i.amount, i.description])).toEqual([
      ['30.00', 'almoço'],
      ['8.00', 'café'],
      ['22.00', 'uber'],
    ])
    expect(items.every((i) => i.occurredOn === TODAY)).toBe(true)
  })

  test('a date header before the colon applies to the whole batch', () => {
    const items = parseEntry('dia 3: 35 ifood; 18 uber; ontem 10 pão', CTX)
    expect(items.map((i) => [i.description, i.occurredOn])).toEqual([
      ['ifood', '2026-10-03'],
      ['uber', '2026-10-03'],
      ['pão', '2026-10-14'],
    ])
  })

  test('text before a colon that is not a date is not a header', () => {
    const items = parseEntry('obs: 10 pão; 8 café', CTX)
    expect(items.map((i) => i.occurredOn)).toEqual([TODAY, TODAY])
  })

  test('empty input has no items', () => {
    expect(parseEntry('  ;\n ', CTX)).toEqual([])
  })

  test('keeps the raw text of each item', () => {
    expect(parseEntry('42 mercado; 8 café', CTX).map((i) => i.raw)).toEqual([
      '42 mercado',
      '8 café',
    ])
  })
})
