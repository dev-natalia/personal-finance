import { HttpResponse, http } from 'msw'

/**
 * `/cards/cycle` com a regra do backend (A6): a fatura que recebe a data é a primeira que
 * fecha depois dela; no próprio dia do fechamento já é a seguinte. Vencimento depois do
 * fechamento no mesmo mês, como nos cartões dos testes.
 */
export function cycleHandler() {
  return http.get('/api/v1/cards/cycle', ({ request }) => {
    const params = new URL(request.url).searchParams
    const closingDay = Number(params.get('closing_day'))
    const dueDay = Number(params.get('due_day'))
    const [year, month, day] = params.get('opening_date')!.split('-').map(Number) as [
      number,
      number,
      number,
    ]
    const ref = new Date(Date.UTC(year, month - 1 + (day < closingDay ? 0 : 1), 1))
    const iso = (d: Date, dayOfMonth: number) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`
    const next = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1))
    return HttpResponse.json({
      open_reference_month: iso(ref, 1),
      open_closing_date: iso(ref, closingDay),
      open_due_date: iso(ref, dueDay),
      next_reference_month: iso(next, 1),
    })
  })
}
