/** Consultas com cache (TanStack Query) usadas pelas telas. */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'

import { normalize } from '../domain/text'
import { type TransactionQuery, api } from './endpoints'
import type { CategoryKind } from './types'

export const queryKeys = {
  me: ['me'] as const,
  hints: ['entry-hints'] as const,
  accounts: ['accounts'] as const,
  balances: ['balances'] as const,
  categories: (kind?: CategoryKind) => ['categories', kind ?? 'all'] as const,
  merchant: (normalized: string) => ['merchant', normalized] as const,
  transactions: (params: TransactionQuery) => ['transactions', params] as const,
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false, staleTime: 60_000 })
}

export function useEntryHints() {
  return useQuery({ queryKey: queryKeys.hints, queryFn: api.entryHints })
}

/** Com `includeArchived`, inclui as arquivadas (nomes de lançamentos antigos, filtros). */
export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: includeArchived ? [...queryKeys.accounts, 'all'] : queryKeys.accounts,
    queryFn: () => api.accounts(includeArchived),
  })
}

export function useBalances() {
  return useQuery({ queryKey: queryKeys.balances, queryFn: api.balances })
}

export function useCategories(kind?: CategoryKind) {
  return useQuery({ queryKey: queryKeys.categories(kind), queryFn: () => api.categories(kind) })
}

/** Categoria lembrada pelo backend para um estabelecimento com exatamente este nome (normalizado). */
export function useMerchantSuggestion(description: string) {
  const normalized = normalize(description)
  return useQuery({
    queryKey: queryKeys.merchant(normalized),
    queryFn: async () => {
      const merchants = await api.merchants(description)
      const exact = merchants.find((m) => normalize(m.name) === normalized)
      return exact?.default_category_id ?? null
    },
    enabled: normalized.length > 0,
    staleTime: 60_000,
  })
}

export function useTransactions(params: Omit<TransactionQuery, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: queryKeys.transactions(params),
    queryFn: ({ pageParam }) => api.transactions({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

export function useRecentTransactions() {
  const params = { limit: 30 }
  return useQuery({ queryKey: queryKeys.transactions(params), queryFn: () => api.transactions(params) })
}

/** Depois de gravar algo, saldos, lançamentos e atalhos de pagamento precisam ser recarregados. */
export function useInvalidateLedger(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.balances }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.hints }),
    ])
  }
}
