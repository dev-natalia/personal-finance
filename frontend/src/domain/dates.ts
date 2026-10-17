/**
 * Datas como "AAAA-MM-DD", já na data local da usuária (o "hoje" vem do backend).
 * A aritmética usa UTC sobre essas strings para nunca depender do fuso do navegador.
 */

const ISO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/

function parts(iso: string): [number, number, number] {
  const match = ISO.exec(iso)
  if (!match) throw new Error(`Data inválida: ${iso}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Monta a data se ela existir no calendário (31/02 → null). */
function makeDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? format(date) : null
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** "2026-11-01" → "novembro" (para "fatura de novembro"). */
export function monthName(iso: string): string {
  return MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? ''
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = parts(iso)
  return format(new Date(Date.UTC(year, month - 1, day + days)))
}

export function firstDayOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** "dia N": neste mês; se ainda não chegou (ou não existe neste mês), no mês anterior. */
function pastDayOfMonth(day: number, today: string): string | null {
  const [year, month] = parts(today)
  const current = makeDate(year, month, day)
  if (current && current <= today) return current
  return month === 1 ? makeDate(year - 1, 12, day) : makeDate(year, month - 1, day)
}

/** "D/M": neste ano; se ainda não chegou, no ano anterior. */
function pastDayAndMonth(day: number, month: number, today: string): string | null {
  const [year] = parts(today)
  const current = makeDate(year, month, day)
  if (!current) return null
  return current <= today ? current : makeDate(year - 1, month, day)
}

export interface DateMatch {
  date: string
  consumed: number
}

const RELATIVE: Record<string, number> = { hoje: 0, ontem: -1, anteontem: -2 }

/** Reconhece "hoje", "ontem", "anteontem", "dia N" e "D/M" a partir de words[index] (normalizadas). */
export function matchDate(words: string[], index: number, today: string): DateMatch | null {
  const word = words[index]
  if (word === undefined) return null

  const offset = RELATIVE[word]
  if (offset !== undefined) return { date: addDays(today, offset), consumed: 1 }

  if (word === 'dia') {
    const next = words[index + 1]
    if (next === undefined || !/^[0-9]{1,2}$/.test(next)) return null
    const date = pastDayOfMonth(Number(next), today)
    return date ? { date, consumed: 2 } : null
  }

  const dayMonth = /^([0-9]{1,2})\/([0-9]{1,2})$/.exec(word)
  if (dayMonth) {
    const date = pastDayAndMonth(Number(dayMonth[1]), Number(dayMonth[2]), today)
    return date ? { date, consumed: 1 } : null
  }
  return null
}

/** Rótulo do cabeçalho de um dia na linha do tempo. */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Hoje'
  if (iso === addDays(today, -1)) return 'Ontem'
  const [year] = parts(iso)
  const short = shortDate(iso)
  return year === parts(today)[0] ? short : `${short}/${year}`
}

/** "2026-11-03" → "03/11". */
export function shortDate(iso: string): string {
  const [, month, day] = parts(iso)
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`
}
