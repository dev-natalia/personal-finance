import { expect, test } from 'vitest'

import { installmentIn } from './installments'

test('installment number counts invoices from the purchase invoice', () => {
  // Compra que caiu na fatura de agosto: setembro tem a 2ª, novembro a 4ª.
  expect(installmentIn('2026-08-01', '2026-08-01')).toBe(1)
  expect(installmentIn('2026-08-01', '2026-11-01')).toBe(4)
  // Atravessa o ano.
  expect(installmentIn('2025-11-01', '2026-02-01')).toBe(4)
  // Fatura do início antes da da compra: a compra ainda não tinha parcela ali.
  expect(installmentIn('2026-12-01', '2026-11-01')).toBe(0)
})
