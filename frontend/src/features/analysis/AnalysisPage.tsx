import { useId, useState } from 'react'
import { useLocation } from 'react-router'

import { useAccounts, useAnalysisSummary, useCards, useEntryHints } from '../../api/queries'
import type { AnalysisSummaryOut, PeriodOut } from '../../api/types'
import { addDays, monthName, shortDate } from '../../domain/dates'
import { PAYMENT_METHOD_LABELS } from '../../domain/labels'
import { formatBRL } from '../../domain/money'
import { Field } from '../../ui/Field'
import { Page } from '../../ui/Page'
import { chipClass, errorTextClass, inputClass, secondaryButtonClass, slipClass } from '../../ui/styles'
import { DayDetails } from './DayDetails'
import { PlaceRanking } from './PlaceRanking'
import { SpendingCalendar } from './SpendingCalendar'
import { SpendingDonut } from './SpendingDonut'
import { type PeriodKind, useAnalysisParams } from './useAnalysisParams'

const PERIOD_LABELS: [PeriodKind, string][] = [
  ['month', 'Mês'],
  ['week', 'Semana'],
  ['year', 'Ano'],
]

/** "outubro", "setembro de 2025", "de 12/10 a 18/10", "2026". */
function periodPhrase(period: PeriodOut, currentYear: string): string {
  const year = period.start.slice(0, 4)
  if (period.kind === 'week') return `de ${shortDate(period.start)} a ${shortDate(period.end)}`
  if (period.kind === 'year') return year
  const month = monthName(period.start)
  return year === currentYear ? month : `${month} de ${year}`
}

/** "em outubro", "de 12/10 a 18/10", "em 2026": o que vem depois de "Gasto" e "Nenhum gasto". */
function phraseOf(period: PeriodOut, currentYear: string): string {
  const phrase = periodPhrase(period, currentYear)
  return period.kind === 'week' ? phrase : `em ${phrase}`
}

function arrowLabels(period: PeriodOut): { previous: string; next: string } {
  if (period.kind === 'week') return { previous: '‹ Semana anterior', next: 'Semana seguinte ›' }
  if (period.kind === 'year') {
    const year = Number(period.start.slice(0, 4))
    return { previous: `‹ ${year - 1}`, next: `${year + 1} ›` }
  }
  return {
    previous: `‹ ${monthName(addDays(period.start, -1))}`,
    next: `${monthName(addDays(period.end, 1))} ›`,
  }
}

/** A tela do lugar mostra todas as compras de lá: só o modo vai junto, nunca o filtro. */
function placeSearch(mode: string): string {
  return mode === 'purchase' ? '?mode=purchase' : ''
}

function isEmpty(summary: AnalysisSummaryOut): boolean {
  return summary.by_day.length === 0 && !/[1-9]/.test(summary.total)
}

/** `/analise`: para onde foi o dinheiro no período, somando todos os meios de pagamento. */
export function AnalysisPage() {
  const params = useAnalysisParams()
  const hints = useEntryHints()
  const query = {
    period: params.period,
    date: params.date ?? undefined,
    mode: params.mode,
    source: params.source ?? undefined,
    category_id: params.categoryId ?? undefined,
  }
  const summary = useAnalysisSummary(query)
  // Dia tocado no calendário; vale só para o período em que foi escolhido.
  const [picked, setPicked] = useState<{ day: string; period: string } | null>(null)
  const location = useLocation()
  const currentYear = (hints.data?.today ?? '').slice(0, 4)
  const data = summary.data

  return (
    <Page title="Análise">
      <Controls sources={data?.sources ?? []} />
      {summary.isError && (
        <p role="alert" className={errorTextClass}>
          Não foi possível carregar a análise. Tente de novo.
        </p>
      )}
      {data && (
        <>
          <PeriodNav period={data.period} onGo={(date) => params.set({ date })} />
          <section aria-label="Total do período" className={`${slipClass} mt-2`}>
            <p className="text-ink-soft">Gasto {phraseOf(data.period, currentYear)}</p>
            <p className="tabular text-3xl font-[650]">{formatBRL(data.total)}</p>
          </section>
          {isEmpty(data) ? (
            <p className="mt-4 text-ink-soft">Nenhum gasto {phraseOf(data.period, currentYear)}.</p>
          ) : (
            <>
              <SpendingDonut
                items={data.by_category}
                selected={params.categoryId}
                onSelect={(categoryId) => params.set({ categoryId })}
              />
              <PlaceRanking
                places={data.by_place}
                search={placeSearch(params.mode)}
                from={location.search}
              />
              <SpendingCalendar
                summary={data}
                today={hints.data?.today ?? ''}
                selectedDay={picked?.period === data.period.start ? picked.day : null}
                onDay={(day) =>
                  setPicked((current) =>
                    current?.day === day ? null : { day, period: data.period.start },
                  )
                }
                onMonth={(firstDay) => params.set({ period: 'month', date: firstDay })}
              />
              {picked?.period === data.period.start && <DayDetails day={picked.day} query={query} />}
            </>
          )}
        </>
      )}
    </Page>
  )
}

/** Ativos sempre; arquivados só se tiveram gasto no período (ou se já estão escolhidos). */
function Controls({ sources }: { sources: string[] }) {
  const id = useId()
  const params = useAnalysisParams()
  const accounts = useAccounts(true)
  const cards = useCards(true)
  const listed = (kind: 'account' | 'card', item: { id: string; archived_at: string | null }) => {
    const value = `${kind}:${item.id}`
    return item.archived_at === null || sources.includes(value) || params.source === value
  }
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
        {PERIOD_LABELS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={params.period === value}
            onClick={() => params.set({ period: value, date: null })}
            className={chipClass}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Como contar compras parceladas" className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={params.mode === 'installments'}
          onClick={() => params.set({ mode: 'installments' })}
          className={chipClass}
        >
          Pelas parcelas
        </button>
        <button
          type="button"
          aria-pressed={params.mode === 'purchase'}
          onClick={() => params.set({ mode: 'purchase' })}
          className={chipClass}
        >
          Pela compra
        </button>
      </div>
      <Field id={`${id}-source`} label="Cartão ou conta">
        <select
          id={`${id}-source`}
          value={params.source ?? ''}
          onChange={(e) => params.set({ source: e.target.value || null })}
          className={`${inputClass} max-w-xs`}
        >
          <option value="">Todos</option>
          <optgroup label="Contas">
            {(accounts.data ?? []).filter((a) => listed('account', a)).map((a) => (
              <option key={a.id} value={`account:${a.id}`}>
                {a.archived_at ? `${a.name} (arquivada)` : a.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Cartões">
            {(cards.data ?? []).filter((c) => listed('card', c)).map((c) => (
              <option key={c.id} value={`card:${c.id}`}>
                {PAYMENT_METHOD_LABELS.CREDIT} {c.name}
                {c.archived_at ? ' (arquivado)' : ''}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
    </div>
  )
}

function PeriodNav({ period, onGo }: { period: PeriodOut; onGo: (date: string) => void }) {
  const labels = arrowLabels(period)
  return (
    <div className="mt-4 flex justify-between gap-2">
      <button type="button" onClick={() => onGo(addDays(period.start, -1))} className={secondaryButtonClass}>
        {labels.previous}
      </button>
      {period.has_next && (
        <button type="button" onClick={() => onGo(addDays(period.end, 1))} className={secondaryButtonClass}>
          {labels.next}
        </button>
      )}
    </div>
  )
}
