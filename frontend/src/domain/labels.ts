/** Rótulos em português para os valores fixos da API. */

export const PAYMENT_METHOD_LABELS = {
  PIX: 'Pix',
  DEBIT: 'Débito',
  CASH: 'Dinheiro',
  BOLETO: 'Boleto',
  OTHER: 'Outro',
} as const

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
} as const
