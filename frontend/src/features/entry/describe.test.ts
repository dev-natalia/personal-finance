import { expect, test } from 'vitest'

import { ACCOUNTS, CARDS, CATEGORIES, transaction } from '../../test/fixtures'
import { describeSaved } from './describe'

const names = {
  accounts: new Map(Object.values(ACCOUNTS).map((a) => [a.id, a.name])),
  categories: new Map(CATEGORIES.map((c) => [c.id, c.name])),
  cards: new Map(Object.values(CARDS).map((c) => [c.id, c.name])),
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

test('transfer names both accounts', () => {
  const tx = transaction({
    type: 'TRANSFER',
    amount: '300.00',
    category_id: null,
    payment_method: null,
    destination_account_id: ACCOUNTS.nubank.id,
  })
  expect(describeSaved(tx, names)).toBe('Transferência registrada: R$ 300,00 de Itaú para Nubank.')
})

test('describe card purchase', () => {
  const tx = transaction({
    amount: '38.00',
    category_id: 'cat-alimentacao',
    account_id: null,
    card_id: CARDS.nubank.id,
    payment_method: 'CREDIT',
  })
  expect(describeSaved(tx, names)).toBe(
    'Despesa registrada: R$ 38,00 em Alimentação, no crédito Nubank.',
  )
})

test('describe installment purchase', () => {
  const tx = transaction({
    amount: '1200.00',
    category_id: 'cat-unclassified-expense',
    account_id: null,
    card_id: CARDS.nubank.id,
    payment_method: 'CREDIT',
    installments: 6,
  })
  expect(describeSaved(tx, names)).toBe(
    'Despesa registrada: R$ 1.200,00, ainda sem categoria, no crédito Nubank em 6x.',
  )
})
