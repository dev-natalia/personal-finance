import { expect, test } from 'vitest'

import { ACCOUNTS, CATEGORIES, transaction } from '../../test/fixtures'
import { describeSaved } from './describe'

const names = {
  accounts: new Map(Object.values(ACCOUNTS).map((a) => [a.id, a.name])),
  categories: new Map(CATEGORIES.map((c) => [c.id, c.name])),
}

test('expense names the category and how it was paid', () => {
  expect(describeSaved(transaction(), names)).toBe(
    'Despesa registrada: R$ 42,00 em Mercado, paga com Pix Itaú.',
  )
})

test('income names the account that received it', () => {
  const tx = transaction({
    type: 'INCOME',
    amount: '3000.00',
    category_id: 'cat-salario',
    payment_method: null,
  })
  expect(describeSaved(tx, names)).toBe(
    'Receita registrada: R$ 3.000,00 em Salário, recebida na Itaú.',
  )
})

test('unclassified reads naturally', () => {
  const tx = transaction({ amount: '35.00', category_id: 'cat-unclassified-expense' })
  expect(describeSaved(tx, names)).toBe(
    'Despesa registrada: R$ 35,00, ainda sem categoria, paga com Pix Itaú.',
  )
})
