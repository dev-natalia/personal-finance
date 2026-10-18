import { expect, test } from 'vitest'

import type { ParsedItem } from '../../domain/parser'
import { TODAY } from '../../test/fixtures'
import { type CardItem, initCard } from './cardState'
import { changeReasons, pendingReasons } from './misread'

function parsed(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    raw: '42 mercado pix itaú',
    type: 'EXPENSE',
    amount: '42.00',
    description: 'mercado',
    occurredOn: TODAY,
    accountId: 'acc-itau',
    cardId: null,
    installments: null,
    paymentMethod: 'PIX',
    pending: [],
    ...overrides,
  }
}

const edit = (item: CardItem, patch: Partial<CardItem>): CardItem => ({ ...item, ...patch })

test('pending and change reasons ignore category', () => {
  expect(pendingReasons([parsed()])).toEqual([])
  expect(
    pendingReasons([
      parsed({ pending: ['amount', 'paymentMethod'] }),
      parsed({ pending: ['account', 'description', 'amount'] }),
    ]),
  ).toEqual(['PENDING_ACCOUNT', 'PENDING_AMOUNT', 'PENDING_DESCRIPTION', 'PENDING_PAYMENT_METHOD'])

  const initial = initCard([parsed(), parsed({ raw: '6x 300 tênis nubank', cardId: 'card-nubank' })])
  expect(changeReasons(initial, initial)).toEqual([])
  expect(changeReasons(initial, [edit(initial[0]!, { categoryId: 'cat-mercado' }), initial[1]!])).toEqual(
    [],
  )
  // Os dados do envio (status, chave, avisos) também não contam.
  expect(
    changeReasons(initial, [edit(initial[0]!, { status: 'saved', key: 'outra', warnings: ['x'] }), initial[1]!]),
  ).toEqual([])

  const changed = [
    edit(initial[0]!, {
      type: 'INCOME',
      amountText: '43,00',
      description: 'padaria',
      occurredOn: '2026-10-14',
      accountId: 'acc-nubank',
      paymentMethod: 'DEBIT',
    }),
    edit(initial[1]!, { installments: 6, included: false }),
  ]
  expect(changeReasons(initial, changed)).toEqual([
    'CHANGED_AMOUNT',
    'CHANGED_DATE',
    'CHANGED_DESCRIPTION',
    'CHANGED_INSTALLMENTS',
    'CHANGED_PAYMENT_METHOD',
    'CHANGED_SOURCE',
    'CHANGED_TYPE',
    'UNCHECKED_ITEM',
  ])
  expect(changeReasons(initial, [edit(initial[0]!, { cardId: 'card-nubank' }), initial[1]!])).toEqual([
    'CHANGED_SOURCE',
  ])
  // Só espaços na descrição não é mudança de entendimento.
  expect(changeReasons(initial, [edit(initial[0]!, { description: ' mercado ' }), initial[1]!])).toEqual(
    [],
  )
})
