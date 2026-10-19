import { useId, useState } from 'react'
import { useLocation } from 'react-router'

import { useAnalysisSummary, useEntryHints } from '../../api/queries'
import type { AnalysisSummaryOut, PeriodOut } from '../../api/types'
import { addDays, monthName, shortDate } from '../../domain/dates'
import { formatBRL } from '../../domain/money'
import { Field } from '../../ui/Field'
import { Page } from '../../ui/Page'
import { errorTextClass, inputClass, secondaryButtonClass, slipClass } from '../../ui/styles'
import { SourceSelect, type SourceKind } from '../filters/SourceSelect'
import { DayDetails } from './DayDetails'
import { PlaceRanking } from './PlaceRanking'
import { SpendingCalendar } from './SpendingCalendar'
import { SpendingDonut } from './SpendingDonut'
import { type PeriodKind, useAnalysisParams } from './useAnalysisParams'

const PERIOD_LABELS: [PeriodKind, string][] = [
  ['week', 'Semana'],
  ['month', 'Mês'],
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
  const listed = (kind: SourceKind, item: { id: string; archived_at: string | null }) => {
    const value = `${kind}:${item.id}`
    return item.archived_at === null || sources.includes(value) || params.source === value
  }
  return (
    <div
      role="group"
      aria-label="Filtros da análise"
      // As opções são frases longas: uma lista por linha no celular, lado a lado no computador.
      className="grid grid-cols-1 gap-3 rounded-xl border border-rule bg-slip p-3 shadow-[0_2px_8px_rgba(27,35,64,0.06)] md:grid-cols-3"
    >
      <Field id={`${id}-period`} label="Período">
        <select
          id={`${id}-period`}
          value={params.period}
          onChange={(e) => params.set({ period: e.target.value as PeriodKind, date: null })}
          className={inputClass}
        >
          {PERIOD_LABELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-mode`} label="Compras parceladas">
        <select
          id={`${id}-mode`}
          value={params.mode}
          onChange={(e) => params.set({ mode: e.target.value as 'installments' | 'purchase' })}
          className={inputClass}
        >
          <option value="installments">Uma parcela por mês</option>
          <option value="purchase">Valor total no dia da compra</option>
        </select>
      </Field>
      <div>
        <SourceSelect
          id={`${id}-source`}
          value={params.source ?? ''}
          onChange={(value) => params.set({ source: value || null })}
          include={listed}
        />
      </div>
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
