/** Consultas com cache (TanStack Query) usadas pelas telas. */
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { normalize } from '../domain/text'
import { type AnalysisQuery, type TransactionQuery, api } from './endpoints'
import type { CategoryKind, PreviewIn } from './types'

export const queryKeys = {
  me: ['me'] as const,
  hints: ['entry-hints'] as const,
  accounts: ['accounts'] as const,
  balances: ['balances'] as const,
  categories: (kind?: CategoryKind) => ['categories', kind ?? 'all'] as const,
  merchant: (normalized: string) => ['merchant', normalized] as const,
  transactions: (params: TransactionQuery) => ['transactions', params] as const,
  // Tudo de cartão começa com 'cards' ou 'invoice', para uma invalidação pegar o conjunto.
  cards: (includeArchived = false) => ['cards', includeArchived ? 'all' : 'active'] as const,
  cardsSummary: ['cards', 'summary'] as const,
  cardInvoices: (cardId: string) => ['cards', cardId, 'invoices'] as const,
  invoice: (invoiceId: string) => ['invoice', invoiceId] as const,
  preview: (cardId: string, body: PreviewIn) => ['cards', cardId, 'preview', body] as const,
  // Tudo da análise começa com 'analysis' (invalidado junto com o livro-caixa).
  analysis: (kind: string, params: object) => ['analysis', kind, params] as const,
  cycle: (closingDay: number, dueDay: number, openingDate: string) =>
    ['cards', 'cycle', closingDay, dueDay, openingDate] as const,
  misreadPhrases: ['misread-phrases'] as const,
  backupStatus: ['backup-status'] as const,
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false, staleTime: 60_000 })
}

/**
 * "Hoje" vem daqui: atualizado sempre que o app volta para a tela e a cada 5 minutos com ele
 * visível. Sem isto, um PWA aberto desde ontem registraria a primeira frase do dia com a data
 * de ontem (e, na virada do mês, no mês errado).
 */
export function useEntryHints() {
  return useQuery({
    queryKey: queryKeys.hints,
    queryFn: api.entryHints,
    refetchOnWindowFocus: 'always',
    refetchInterval: 5 * 60_000,
  })
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

/** Todas as categorias, inclusive arquivadas: para dar nome a lançamentos antigos. */
export function useAllCategories() {
  return useQuery({
    queryKey: [...queryKeys.categories(), 'with-archived'],
    queryFn: () => api.categories(undefined, true),
  })
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

/**
 * Depois de gravar algo, saldos, lançamentos, atalhos de pagamento e tudo de cartão (faturas,
 * limite, prévias) precisam ser recarregados.
 */
export function useInvalidateLedger(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.balances }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.hints }),
      queryClient.invalidateQueries({ queryKey: ['cards'] }),
      queryClient.invalidateQueries({ queryKey: ['invoice'] }),
      queryClient.invalidateQueries({ queryKey: ['analysis'] }),
    ])
  }
}

export function useCards(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.cards(includeArchived),
    queryFn: () => api.cards(includeArchived),
  })
}

export function useCardsSummary() {
  return useQuery({ queryKey: queryKeys.cardsSummary, queryFn: api.cardsSummary })
}

export function useCardInvoices(cardId: string) {
  return useQuery({
    queryKey: queryKeys.cardInvoices(cardId),
    queryFn: () => api.cardInvoices(cardId),
  })
}

export function useInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.invoice(invoiceId ?? ''),
    queryFn: () => api.invoice(invoiceId ?? ''),
    enabled: invoiceId !== null,
  })
}

/**
 * Prévia do impacto de uma compra na fatura e no limite (o backend calcula; nada é gravado).
 * `null` desliga a consulta (compra ainda incompleta). Mantém o resultado anterior enquanto o
 * novo chega, para os números não piscarem a cada tecla.
 */
export function usePurchasePreview(input: { cardId: string; body: PreviewIn } | null) {
  return useQuery({
    queryKey: input ? queryKeys.preview(input.cardId, input.body) : ['cards', 'preview', 'off'],
    queryFn: () => api.previewPurchase(input!.cardId, input!.body),
    enabled: input !== null,
    placeholderData: keepPreviousData,
  })
}

/** Qual fatura está aberta no início de um cartão ainda não cadastrado (rótulos do início). */
export function useCardCycle(input: { closingDay: number; dueDay: number; openingDate: string } | null) {
  return useQuery({
    queryKey: input
      ? queryKeys.cycle(input.closingDay, input.dueDay, input.openingDate)
      : ['cards', 'cycle', 'off'],
    queryFn: () => api.cardCycle(input!.closingDay, input!.dueDay, input!.openingDate),
    enabled: input !== null,
    staleTime: Infinity,
  })
}

export function useAnalysisSummary(params: AnalysisQuery) {
  return useQuery({
    queryKey: queryKeys.analysis('summary', params),
    queryFn: () => api.analysisSummary(params),
    placeholderData: keepPreviousData,
  })
}

export function useAnalysisDay(params: (AnalysisQuery & { date: string }) | null) {
  return useQuery({
    queryKey: queryKeys.analysis('day', params ?? {}),
    queryFn: () => api.analysisDay(params!),
    enabled: params !== null,
  })
}

export function useAnalysisPlace(key: string, params: Pick<AnalysisQuery, 'mode' | 'source'>) {
  return useQuery({
    queryKey: queryKeys.analysis(`place:${key}`, params),
    queryFn: () => api.analysisPlace(key, params),
  })
}

export function useAnalysisPlaceTransactions(key: string, source: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.analysis(`place-transactions:${key}`, { source }),
    queryFn: ({ pageParam }) => api.analysisPlaceTransactions(key, { source, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

export function useMisreadPhrases() {
  return useQuery({ queryKey: queryKeys.misreadPhrases, queryFn: api.misreadPhrases })
}

/** Último backup; consultado de novo a cada hora com o app aberto. */
export function useBackupStatus() {
  return useQuery({
    queryKey: queryKeys.backupStatus,
    queryFn: api.backupStatus,
    staleTime: 5 * 60_000,
    refetchInterval: 60 * 60_000,
  })
}
