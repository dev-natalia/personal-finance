import type { AnalysisSummaryOut, DayTotalOut } from '../../api/types'
import { addDays, monthName, shortDate, weekdayIndex } from '../../domain/dates'
import { formatBRL } from '../../domain/money'

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
/**
 * Escala de um tom só (azul), do claro ao escuro: mais escuro = gastou mais. A intensidade é
 * só reforço; o valor de cada dia está no nome do botão e no detalhe do dia.
 */
const LEVELS = [
  'bg-slip text-ink-soft border border-rule',
  'bg-[#b7d3f6] text-ink',
  'bg-[#6da7ec] text-ink',
  'bg-[#2a78d6] text-white',
  'bg-[#184f95] text-white',
]

/** 0 sem gasto; 1–4 pela fração do maior valor do período (Number só para a cor). */
function level(amount: string | undefined, largest: number): number {
  const value = amount ? Number(amount) : 0
  if (value <= 0 || largest <= 0) return 0
  return Math.min(4, Math.ceil((value / largest) * 4))
}

interface Props {
  summary: AnalysisSummaryOut
  today: string
  selectedDay: string | null
  onDay: (day: string) => void
  onMonth: (firstDay: string) => void
}

/** "Seus dias": calendário do mês ou da semana; no ano, um quadro por mês. */
export function SpendingCalendar({ summary, today, selectedDay, onDay, onMonth }: Props) {
  const { period, by_day: byDay, busiest } = summary
  const amounts = new Map(byDay.map((d: DayTotalOut) => [d.day, d.amount]))
  const largest = Math.max(...byDay.map((d) => Number(d.amount)), 0)

  if (period.kind === 'year') {
    const months: string[] = []
    // Do dia 1 de um mês, 32 dias depois sempre cai no mês seguinte: volta-se ao dia 1 dele.
    for (let month = period.start; month <= period.end; month = `${addDays(month, 32).slice(0, 8)}01`) {
      months.push(month)
    }
    return (
      <section aria-labelledby="calendar-title" className="mt-6">
        <h2 id="calendar-title" className="mb-2 text-lg font-[650]">
          Seus meses
        </h2>
        {busiest && (
          <p className="mb-2 text-sm">
            Mês mais caro: {monthName(busiest.day)}, {formatBRL(busiest.amount)}
          </p>
        )}
        <ul aria-label="Seus meses" className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4">
          {months.map((month) => {
            const amount = amounts.get(month)
            const label = `${monthName(month)}: ${amount ? formatBRL(amount) : 'sem gasto'}`
            return (
              <li key={month}>
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => onMonth(month)}
                  className={`flex min-h-11 w-full flex-col items-start rounded-lg px-2 py-1 text-left text-sm ${LEVELS[level(amount, largest)]}`}
                >
                  <span>{monthName(month).slice(0, 3)}</span>
                  <span className="tabular text-[12px]">{amount ? formatBRL(amount) : '—'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  const days: string[] = []
  for (let day = period.start; day <= period.end; day = addDays(day, 1)) days.push(day)
  const withoutSpending = days.filter((day) => day <= today && !amounts.has(day)).length
  const cells: (string | null)[] = [...Array(weekdayIndex(period.start)).fill(null), ...days]
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <section aria-labelledby="calendar-title" className="mt-6">
      <h2 id="calendar-title" className="mb-2 text-lg font-[650]">
        Seus dias
      </h2>
      <p className="mb-2 flex flex-wrap gap-x-4 text-sm">
        {busiest && (
          <span>
            Dia mais caro: {shortDate(busiest.day)}, {formatBRL(busiest.amount)}
          </span>
        )}
        <span className="text-ink-soft">
          Sem gasto: {withoutSpending} {withoutSpending === 1 ? 'dia' : 'dias'}
        </span>
      </p>
      <table aria-label="Seus dias" className="w-full table-fixed border-separate border-spacing-1">
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col" className="text-[12px] font-normal text-ink-soft">
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={index}>
              {week.map((day, column) => {
                if (day === null) return <td key={`empty-${column}`} />
                const amount = amounts.get(day)
                const label = `${shortDate(day)}: ${amount ? formatBRL(amount) : 'sem gasto'}`
                return (
                  <td key={day}>
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={selectedDay === day}
                      onClick={() => onDay(day)}
                      className={`flex aspect-square min-h-11 w-full items-end justify-end rounded-md p-1 text-[12px] aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-ink ${LEVELS[level(amount, largest)]}`}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
