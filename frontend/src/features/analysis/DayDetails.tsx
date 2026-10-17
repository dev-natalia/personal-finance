import { useAnalysisDay, useCategories, useEntryHints } from '../../api/queries'
import type { AnalysisQuery } from '../../api/endpoints'
import { shortDate } from '../../domain/dates'
import { formatBRL } from '../../domain/money'
import { ledgerRowClass } from '../../ui/styles'
import { ledgerDetail } from '../home/Timeline'

/** O que foi gasto num dia tocado no calendário (o valor que conta no dia). */
export function DayDetails({ day, query }: { day: string; query: AnalysisQuery }) {
  const items = useAnalysisDay({ ...query, date: day })
  const hints = useEntryHints()
  const categories = useCategories()
  const names = {
    accounts: new Map((hints.data?.accounts ?? []).map((a) => [a.id, a.name])),
    cards: new Map((hints.data?.cards ?? []).map((c) => [c.id, c.name])),
    categories: new Map((categories.data ?? []).map((c) => [c.id, c.name])),
  }
  const title = `Gastos de ${shortDate(day)}`

  return (
    <section aria-label={title} className="mt-3 border-l-2 border-rule pl-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.isPending && <p className="py-2 text-sm text-ink-soft">Carregando…</p>}
      {items.data?.length === 0 && <p className="py-2 text-sm text-ink-soft">Nenhum gasto neste dia.</p>}
      <ul>
        {(items.data ?? []).map(({ transaction, amount }) => (
          <li key={transaction.id} className={ledgerRowClass}>
            <div className="min-w-0">
              <p className="truncate">{transaction.description}</p>
              <p className="text-[13px] text-ink-soft">{ledgerDetail(transaction, names)}</p>
            </div>
            <span className="tabular shrink-0">{formatBRL(amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
