/** Rótulos em português para os valores fixos da API. */

export const PAYMENT_METHOD_LABELS = {
  PIX: 'Pix',
  DEBIT: 'Débito',
  CASH: 'Dinheiro',
  BOLETO: 'Boleto',
  OTHER: 'Outro',
  CREDIT: 'Crédito',
} as const

/** Meios de pagamento de uma conta. Crédito é só do cartão (o backend recusa conta + crédito). */
export const ACCOUNT_PAYMENT_METHODS = ['PIX', 'DEBIT', 'CASH', 'BOLETO', 'OTHER'] as const

export function isAccountMethod(method: string): method is (typeof ACCOUNT_PAYMENT_METHODS)[number] {
  return (ACCOUNT_PAYMENT_METHODS as readonly string[]).includes(method)
}

export const ACCOUNT_TYPE_LABELS = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  CASH: 'Carteira',
} as const

export const TRANSACTION_TYPE_LABELS = {
  EXPENSE: 'Despesa',
  INCOME: 'Receita',
  TRANSFER: 'Transferência',
  REFUND: 'Estorno',
  INVOICE_PAYMENT: 'Pagamento de fatura',
  CHARGE: 'Encargo',
} as const

/** Estado da fatura, como em "Fatura de outubro, fechada". */
export const INVOICE_STATE_LABELS = {
  OPEN: 'aberta',
  FUTURE: 'futura',
  CLOSED: 'fechada',
  PAID: 'paga',
} as const
