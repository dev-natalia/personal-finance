import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { ACCOUNTS, CARDS, transaction } from '../../test/fixtures'
import { LedgerAmount, type LedgerNames, ledgerDetail } from './ledger'

const NAMES: LedgerNames = {
  accounts: new Map([[ACCOUNTS.itau.id, 'Itaú']]),
  categories: new Map([['cat-mercado', 'Mercado']]),
  cards: new Map([[CARDS.nubank.id, 'Nubank']]),
}

const onCard = { account_id: null, payment_method: null, card_id: CARDS.nubank.id } as const

test('ledger detail describes card purchases and invoice payments', () => {
  expect(ledgerDetail(transaction({ ...onCard, installments: 6 }), NAMES)).toBe(
    'Mercado, crédito Nubank em 6x',
  )
  expect(
    ledgerDetail(
      transaction({ ...onCard, category_id: null, installments: 10, remaining_installments: 5 }),
      NAMES,
    ),
  ).toBe('A classificar, crédito Nubank em 10x, já em andamento')
  expect(
    ledgerDetail(
      transaction({ type: 'INVOICE_PAYMENT', category_id: null, payment_method: null }),
      NAMES,
    ),
  ).toBe('Pagamento de fatura, Itaú')
  expect(ledgerDetail(transaction({ ...onCard, type: 'CHARGE', category_id: null }), NAMES)).toBe(
    'Encargos financeiros, Nubank',
  )
  expect(ledgerDetail(transaction(), NAMES)).toBe('Mercado, Pix Itaú')
})

test('ledger amount shows outflows in stamp with a minus sign', () => {
  render(<LedgerAmount tx={transaction({ type: 'INVOICE_PAYMENT', amount: '2300.00' })} />)
  expect(screen.getByText('−2.300,00')).toHaveClass('text-stamp')
})
