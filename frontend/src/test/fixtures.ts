/** Dados de exemplo para os testes de tela (formato idêntico ao da API). */
import type {
  AnalysisSummaryOut,
  BalancesOut,
  CardSummaryOut,
  CategoryOut,
  EntryHintsOut,
  PurchasePreviewOut,
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

export const CARDS = {
  nubank: { id: 'card-nubank', name: 'Nubank' },
} as const

export const HINTS: EntryHintsOut = {
  today: TODAY,
  accounts: [ACCOUNTS.carteira, ACCOUNTS.itau, ACCOUNTS.nubank],
  cards: [CARDS.nubank],
  payment_methods: ['PIX', 'DEBIT', 'CASH', 'BOLETO', 'OTHER', 'CREDIT'],
  top_payment_options: [
    { account_id: null, card_id: CARDS.nubank.id, name: 'Nubank', payment_method: 'CREDIT' },
    { account_id: ACCOUNTS.itau.id, card_id: null, name: 'Itaú', payment_method: 'PIX' },
    { account_id: ACCOUNTS.nubank.id, card_id: null, name: 'Nubank', payment_method: 'DEBIT' },
  ],
}

/** Resumo do Nubank (limite 11.000, fecha 3, vence 10): fatura aberta de novembro e uma
 * fatura de outubro fechada a pagar. */
export const CARDS_SUMMARY: CardSummaryOut[] = [
  {
    card: {
      id: CARDS.nubank.id,
      name: 'Nubank',
      credit_limit: '11000.00',
      closing_day: 3,
      due_day: 10,
      opening_date: '2026-09-01',
      archived_at: null,
    },
    open_invoice: {
      id: 'inv-novembro',
      reference_month: '2026-11-01',
      closing_date: '2026-11-03',
      due_date: '2026-11-10',
      state: 'OPEN',
      total: '1240.00',
      balance: '1240.00',
      reported_total: null,
      difference: null,
    },
    payable: {
      id: 'inv-outubro',
      reference_month: '2026-10-01',
      closing_date: '2026-10-03',
      due_date: '2026-10-10',
      state: 'CLOSED',
      total: '2300.00',
      balance: '2300.00',
      reported_total: null,
      difference: null,
    },
    future: [
      {
        id: 'inv-dezembro',
        reference_month: '2026-12-01',
        closing_date: '2026-12-03',
        due_date: '2026-12-10',
        state: 'FUTURE',
        total: '3000.00',
        balance: '3000.00',
        reported_total: null,
        difference: null,
      },
    ],
    limit: { limit: '11000.00', used: '9440.00', available: '1560.00' },
  },
]

/** Prévia de "1200 celular crédito nubank 6x" sobre o resumo acima. */
export const PREVIEW: PurchasePreviewOut = {
  invoice: { reference_month: '2026-11-01', before: '1240.00', after: '1440.00' },
  following: [
    { reference_month: '2026-12-01', before: '3000.00', after: '3200.00' },
    { reference_month: '2027-01-01', before: '0.00', after: '200.00' },
    { reference_month: '2027-02-01', before: '0.00', after: '200.00' },
    { reference_month: '2027-03-01', before: '0.00', after: '200.00' },
    { reference_month: '2027-04-01', before: '0.00', after: '200.00' },
  ],
  limit_before: '1560.00',
  limit_after: '360.00',
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
  archived_total: '0.00',
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
    card_id: null,
    installments: null,
    installment_amount: null,
    remaining_installments: null,
    invoice_id: null,
    payment_group_id: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    created_at: `${TODAY}T15:00:00Z`,
    voided_at: null,
    ...overrides,
  }
}

/** Análise de outubro (pelas parcelas): três categorias, três lugares, três dias. */
export const ANALYSIS_SUMMARY: AnalysisSummaryOut = {
  period: { kind: 'month', start: '2026-10-01', end: '2026-10-31', has_next: false },
  total: '270.50',
  by_category: [
    { category_id: 'cat-compras', name: 'Compras diversas', amount: '120.00' },
    { category_id: 'cat-alimentacao', name: 'Alimentação', amount: '90.50' },
    { category_id: 'cat-mercado', name: 'Mercado', amount: '60.00' },
  ],
  by_place: [
    { key: 'm:merchant-ml', name: 'Mercado Livre', amount: '120.00', purchases: 1, category_name: 'Compras diversas' },
    { key: 'm:merchant-ifood', name: 'iFood', amount: '90.50', purchases: 3, category_name: 'Alimentação' },
    { key: 'm:merchant-pao', name: 'Pão de Açúcar', amount: '60.00', purchases: 1, category_name: 'Mercado' },
  ],
  by_day: [
    { day: '2026-10-03', amount: '90.00' },
    { day: '2026-10-09', amount: '160.00' },
    { day: '2026-10-15', amount: '20.50' },
  ],
  busiest: { day: '2026-10-09', amount: '160.00' },
}

export const EMPTY_ANALYSIS: AnalysisSummaryOut = {
  ...ANALYSIS_SUMMARY,
  total: '0.00',
  by_category: [],
  by_place: [],
  by_day: [],
  busiest: null,
}
