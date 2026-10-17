/** Uma função por endpoint do contrato da API (spec, seção 6). */
import { apiFetch } from './client'
import type {
  AccountArchiveOut,
  AccountIn,
  AccountOut,
  AccountPatch,
  BalancesOut,
  CardArchiveOut,
  CardIn,
  CardInvoicesOut,
  CardOut,
  CardPatch,
  CardSummaryOut,
  ChargeIn,
  CycleOut,
  CategoryIn,
  CategoryKind,
  CategoryOut,
  CategoryPatch,
  EntryChecksIn,
  EntryChecksOut,
  EntryHintsOut,
  ExpenseIn,
  IncomeIn,
  InvoiceDetailOut,
  InvoicePatch,
  InvoicePaymentIn,
  InvoicePaymentOut,
  InvoiceSummaryOut,
  MerchantOut,
  MonthSummaryOut,
  PaymentGroupVoidOut,
  PreviewIn,
  PurchasePreviewOut,
  RefundIn,
  TransactionOut,
  TransactionPage,
  TransactionPatch,
  TransactionStatus,
  TransactionType,
  TransactionWriteOut,
  TransferIn,
  UserOut,
} from './types'

const V1 = '/api/v1'

export interface TransactionQuery {
  date_from?: string
  date_to?: string
  account_id?: string
  card_id?: string
  category_id?: string
  type?: TransactionType
  status?: TransactionStatus | 'ALL'
  cursor?: string
  limit?: number
}

function query(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  me: () => apiFetch<UserOut>(`${V1}/auth/me`),
  login: (email: string, password: string) =>
    apiFetch<UserOut>(`${V1}/auth/login`, { method: 'POST', body: { email, password } }),
  logout: () => apiFetch<void>(`${V1}/auth/logout`, { method: 'POST' }),

  entryHints: () => apiFetch<EntryHintsOut>(`${V1}/entry-hints`),
  entryChecks: (items: EntryChecksIn['items']) =>
    apiFetch<EntryChecksOut>(`${V1}/entry-checks`, { method: 'POST', body: { items } }),

  accounts: (includeArchived = false) =>
    apiFetch<AccountOut[]>(`${V1}/accounts${query({ include_archived: includeArchived || undefined })}`),
  balances: () => apiFetch<BalancesOut>(`${V1}/accounts/balances`),
  createAccount: (body: AccountIn) =>
    apiFetch<AccountOut>(`${V1}/accounts`, { method: 'POST', body }),
  updateAccount: (id: string, body: AccountPatch) =>
    apiFetch<AccountOut>(`${V1}/accounts/${id}`, { method: 'PATCH', body }),
  unarchiveAccount: (id: string) =>
    apiFetch<AccountOut>(`${V1}/accounts/${id}/unarchive`, { method: 'POST' }),
  archiveAccount: (id: string) =>
    apiFetch<AccountArchiveOut>(`${V1}/accounts/${id}/archive`, { method: 'POST' }),

  categories: (kind?: CategoryKind, includeArchived = false) =>
    apiFetch<CategoryOut[]>(
      `${V1}/categories${query({ kind, include_archived: includeArchived || undefined })}`,
    ),
  createCategory: (body: CategoryIn) =>
    apiFetch<CategoryOut>(`${V1}/categories`, { method: 'POST', body }),
  updateCategory: (id: string, body: CategoryPatch) =>
    apiFetch<CategoryOut>(`${V1}/categories/${id}`, { method: 'PATCH', body }),
  archiveCategory: (id: string) =>
    apiFetch<CategoryOut>(`${V1}/categories/${id}/archive`, { method: 'POST' }),

  merchants: (q: string) => apiFetch<MerchantOut[]>(`${V1}/merchants${query({ q })}`),

  transactions: (params: TransactionQuery = {}) =>
    apiFetch<TransactionPage>(`${V1}/transactions${query(params)}`),
  createTransaction: (body: IncomeIn | ExpenseIn | TransferIn, key: string) =>
    apiFetch<TransactionWriteOut>(`${V1}/transactions`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key },
    }),
  updateTransaction: (id: string, patch: TransactionPatch) =>
    apiFetch<TransactionWriteOut>(`${V1}/transactions/${id}`, { method: 'PATCH', body: patch }),
  voidTransaction: (id: string) =>
    apiFetch<TransactionOut>(`${V1}/transactions/${id}/void`, { method: 'POST' }),
  refund: (id: string, body: RefundIn, key: string) =>
    apiFetch<TransactionWriteOut>(`${V1}/transactions/${id}/refunds`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key },
    }),

  cards: (includeArchived = false) =>
    apiFetch<CardOut[]>(`${V1}/cards${query({ include_archived: includeArchived || undefined })}`),
  cardsSummary: () => apiFetch<CardSummaryOut[]>(`${V1}/cards/summary`),
  createCard: (body: CardIn) => apiFetch<CardOut>(`${V1}/cards`, { method: 'POST', body }),
  updateCard: (id: string, patch: CardPatch) =>
    apiFetch<CardOut>(`${V1}/cards/${id}`, { method: 'PATCH', body: patch }),
  unarchiveCard: (id: string) =>
    apiFetch<CardOut>(`${V1}/cards/${id}/unarchive`, { method: 'POST' }),
  archiveCard: (id: string) =>
    apiFetch<CardArchiveOut>(`${V1}/cards/${id}/archive`, { method: 'POST' }),
  cardInvoices: (id: string, before?: string) =>
    apiFetch<CardInvoicesOut>(`${V1}/cards/${id}/invoices${query({ before })}`),
  invoice: (id: string) => apiFetch<InvoiceDetailOut>(`${V1}/invoices/${id}`),
  updateInvoice: (id: string, patch: InvoicePatch) =>
    apiFetch<InvoiceSummaryOut>(`${V1}/invoices/${id}`, { method: 'PATCH', body: patch }),
  payInvoice: (id: string, body: InvoicePaymentIn, key: string) =>
    apiFetch<InvoicePaymentOut>(`${V1}/invoices/${id}/payments`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key },
    }),
  voidPaymentGroup: (id: string) =>
    apiFetch<PaymentGroupVoidOut>(`${V1}/payment-groups/${id}/void`, { method: 'POST' }),
  addCharge: (cardId: string, body: ChargeIn, key: string) =>
    apiFetch<TransactionWriteOut>(`${V1}/cards/${cardId}/charges`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key },
    }),
  previewPurchase: (cardId: string, body: PreviewIn) =>
    apiFetch<PurchasePreviewOut>(`${V1}/cards/${cardId}/preview`, { method: 'POST', body }),
  cardCycle: (closingDay: number, dueDay: number, openingDate: string) =>
    apiFetch<CycleOut>(
      `${V1}/cards/cycle${query({ closing_day: closingDay, due_day: dueDay, opening_date: openingDate })}`,
    ),
  setOpeningTotal: (cardId: string, amount: string) =>
    apiFetch<CardSummaryOut>(`${V1}/cards/${cardId}/opening-total`, {
      method: 'PUT',
      body: { amount },
    }),

  monthSummary: (month: string) =>
    apiFetch<MonthSummaryOut>(`${V1}/summaries/month${query({ month })}`),
}
