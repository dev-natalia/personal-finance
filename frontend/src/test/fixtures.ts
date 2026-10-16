/** Dados de exemplo para os testes de tela (formato idêntico ao da API). */
import type {
  BalancesOut,
  CategoryOut,
  EntryHintsOut,
  TransactionOut,
  UserOut,
} from '../api/types'

export const TODAY = '2026-10-15'

export const USER: UserOut = {
  id: 'user-1',
  email: 'ana@example.com',
  timezone: 'America/Sao_Paulo',
}

export const ACCOUNTS = {
  itau: { id: 'acc-itau', name: 'Itaú', type: 'CHECKING' },
  nubank: { id: 'acc-nubank', name: 'Nubank', type: 'CHECKING' },
  carteira: { id: 'acc-carteira', name: 'Carteira', type: 'CASH' },
} as const

export const HINTS: EntryHintsOut = {
  today: TODAY,
  accounts: [ACCOUNTS.carteira, ACCOUNTS.itau, ACCOUNTS.nubank],
  payment_methods: ['PIX', 'DEBIT', 'CASH', 'BOLETO', 'OTHER'],
  top_payment_options: [
    { account_id: ACCOUNTS.itau.id, account_name: 'Itaú', payment_method: 'PIX' },
    { account_id: ACCOUNTS.nubank.id, account_name: 'Nubank', payment_method: 'DEBIT' },
  ],
}

function category(
  id: string,
  name: string,
  kind: CategoryOut['kind'],
  extra: Partial<CategoryOut> = {},
): CategoryOut {
  return { id, name, kind, is_essential: false, is_system: false, archived_at: null, ...extra }
}

export const CATEGORIES: CategoryOut[] = [
  category('cat-alimentacao', 'Alimentação', 'EXPENSE'),
  category('cat-mercado', 'Mercado', 'EXPENSE'),
  category('cat-saude', 'Saúde', 'EXPENSE', { is_essential: true }),
  category('cat-transporte', 'Transporte', 'EXPENSE'),
  category('cat-unclassified-expense', 'A classificar', 'EXPENSE', { is_system: true }),
  category('cat-salario', 'Salário', 'INCOME'),
  category('cat-unclassified-income', 'A classificar', 'INCOME', { is_system: true }),
]

export const BALANCES: BalancesOut = {
  as_of: TODAY,
  total: '1008.00',
  accounts: [
    { account_id: ACCOUNTS.itau.id, name: 'Itaú', archived: false, balance: '958.00' },
    { account_id: ACCOUNTS.carteira.id, name: 'Carteira', archived: false, balance: '50.00' },
  ],
}

let sequence = 0

/** Lançamento de exemplo; por padrão, despesa de R$ 42,00 no Mercado, hoje, Pix Itaú. */
export function transaction(overrides: Partial<TransactionOut> = {}): TransactionOut {
  sequence += 1
  return {
    id: `tx-${sequence}`,
    type: 'EXPENSE',
    amount: '42.00',
    occurred_on: TODAY,
    description: 'mercado',
    notes: null,
    merchant_id: 'merchant-mercado',
    category_id: 'cat-mercado',
    account_id: ACCOUNTS.itau.id,
    destination_account_id: null,
    payment_method: 'PIX',
    refund_of_id: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    created_at: `${TODAY}T15:00:00Z`,
    voided_at: null,
    ...overrides,
  }
}
