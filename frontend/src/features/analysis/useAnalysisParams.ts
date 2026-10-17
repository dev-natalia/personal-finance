import { useSearchParams } from 'react-router'

export type PeriodKind = 'month' | 'week' | 'year'
export type SpendingMode = 'installments' | 'purchase'

export interface AnalysisParams {
  period: PeriodKind
  /** Um dia dentro do período mostrado; nulo é o período atual. */
  date: string | null
  mode: SpendingMode
  /** "account:<id>" ou "card:<id>". */
  source: string | null
  categoryId: string | null
}

const PERIODS: PeriodKind[] = ['month', 'week', 'year']
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

const URL_NAMES: Record<keyof AnalysisParams, string> = {
  period: 'period',
  date: 'date',
  mode: 'mode',
  source: 'source',
  categoryId: 'category',
}

/** Período, modo e filtros da análise, guardados na URL (voltar e recarregar mantêm a vista). */
export function useAnalysisParams(): AnalysisParams & {
  set: (patch: Partial<AnalysisParams>) => void
} {
  const [search, setSearch] = useSearchParams()
  const period = search.get('period')
  const date = search.get('date')
  const params: AnalysisParams = {
    period: PERIODS.includes(period as PeriodKind) ? (period as PeriodKind) : 'month',
    date: date && DATE.test(date) ? date : null,
    mode: search.get('mode') === 'purchase' ? 'purchase' : 'installments',
    source: search.get('source') || null,
    categoryId: search.get('category') || null,
  }

  function set(patch: Partial<AnalysisParams>) {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [name, value] of Object.entries(patch)) {
          const key = URL_NAMES[name as keyof AnalysisParams]
          // Valores padrão saem da URL: mês, pelas parcelas, período atual.
          if (value === null || value === undefined || value === 'month' || value === 'installments') {
            next.delete(key)
          } else {
            next.set(key, String(value))
          }
        }
        return next
      },
      { replace: true },
    )
  }

  return { ...params, set }
}
