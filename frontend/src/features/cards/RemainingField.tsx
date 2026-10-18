import { useEffect, useState } from 'react'

import { useCardCycle } from '../../api/queries'
import { monthName } from '../../domain/dates'
import { installmentIn } from '../../domain/installments'
import { Field, invalid } from '../../ui/Field'
import { inputClass } from '../../ui/styles'

interface Props {
  id: string
  label: string
  /** Número de parcelas da compra; nulo enquanto não escolhido. */
  count: number | null
  purchaseDate: string
  closingDay: number | null
  dueDay: number | null
  /** Fatura aberta no início do cartão ("AAAA-MM-01"); nula enquanto não se sabe. */
  startMonth: string | null
  value: string
  error?: string
  onChange: (value: string) => void
}

/**
 * "Quantas faltam depois da fatura do início" de uma parcelada que já corria: o app calcula
 * pela data da compra e pelo fechamento do cartão e preenche, mas a usuária pode corrigir
 * (banco que fechou noutro dia, loja que empurrou a 1ª parcela).
 */
export function RemainingField({
  id,
  label,
  count,
  purchaseDate,
  closingDay,
  dueDay,
  startMonth,
  value,
  error,
  onChange,
}: Props) {
  const purchaseCycle = useCardCycle(
    count && purchaseDate && closingDay && dueDay
      ? { closingDay, dueDay, openingDate: purchaseDate }
      : null,
  ).data
  const current =
    purchaseCycle && startMonth ? installmentIn(purchaseCycle.open_reference_month, startMonth) : null
  const suggested = current !== null && count ? count - current : null
  const fits = suggested !== null && count !== null && suggested >= 1 && suggested <= count - 1

  // Mudou a compra (data ou parcelas): a sugestão nova volta a valer, mesmo se a usuária
  // tinha corrigido a anterior.
  const purchaseKey = `${purchaseDate}|${count}`
  const [touched, setTouched] = useState(false)
  const [lastKey, setLastKey] = useState(purchaseKey)
  if (lastKey !== purchaseKey) {
    setLastKey(purchaseKey)
    setTouched(false)
  }

  useEffect(() => {
    if (touched || suggested === null) return
    const automatic = fits ? String(suggested) : ''
    if (automatic !== value) onChange(automatic)
  }, [touched, suggested, fits, value, onChange])

  const month = startMonth ? monthName(startMonth) : null
  return (
    <div className="flex flex-col gap-1">
      <Field id={id} label={label} error={error}>
        <select
          id={id}
          value={value}
          onChange={(e) => {
            setTouched(true)
            onChange(e.target.value)
          }}
          disabled={!count}
          {...invalid(id, error)}
          className={inputClass}
        >
          <option value="">Escolha</option>
          {Array.from({ length: Math.max((count ?? 0) - 1, 0) }, (_, k) => k + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      {month && fits && (
        <p className="text-sm text-ink-soft">
          Pelas datas, a fatura de {month} tem a parcela {current}/{count}: faltam {suggested}. Se
          o banco mostrar outro número, ajuste.
        </p>
      )}
      {month && suggested !== null && suggested < 1 && (
        <p className="text-sm text-ink-soft">
          Pelas datas, a última parcela cai na fatura de {month} ou antes: ela já está no total do
          início (ou já foi paga), não precisa lançar.
        </p>
      )}
    </div>
  )
}
