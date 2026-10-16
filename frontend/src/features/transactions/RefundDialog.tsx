import { type FormEvent, useId, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useEntryHints, useInvalidateLedger } from '../../api/queries'
import type { RefundIn, TransactionOut, TransactionWriteOut } from '../../api/types'
import { useIdempotencyKey } from '../../api/useIdempotencyKey'
import { isPositive, toInputAmount, tryParseMoney } from '../../domain/money'
import { Field, invalid } from '../../ui/Field'
import { MoneyInput } from '../../ui/MoneyInput'
import {
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

interface Props {
  expense: TransactionOut
  onDone: (result: TransactionWriteOut) => void
  onCancel: () => void
}

/** Estorno de uma despesa: por padrão, o valor inteiro, hoje, na mesma conta. */
export function RefundDialog({ expense, onDone, onCancel }: Props) {
  const id = useId()
  const hints = useEntryHints()
  const invalidate = useInvalidateLedger()
  const keyFor = useIdempotencyKey()
  const [amount, setAmount] = useState(toInputAmount(expense.amount))
  const [date, setDate] = useState<string | null>(null)
  const [account, setAccount] = useState(expense.account_id)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [detail, setDetail] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const occurredOn = date ?? hints.data?.today ?? ''
  const accounts = hints.data?.accounts ?? []

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setDetail(null)
    const parsed = tryParseMoney(amount)
    const local: Record<string, string> = {}
    if (parsed === null) local.amount = 'Use um valor como 1.234,56.'
    else if (!isPositive(parsed)) local.amount = 'Informe um valor maior que zero.'
    if (!occurredOn) local.occurred_on = 'Informe a data.'
    setErrors(local)
    if (Object.keys(local).length > 0 || parsed === null) return

    const body: RefundIn = { amount: parsed, occurred_on: occurredOn, account_id: account }
    setSaving(true)
    try {
      const result = await api.refund(expense.id, body, keyFor(body))
      await invalidate()
      onDone(result)
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(Object.fromEntries(error.fieldErrors.map((f) => [f.field, f.message])))
        setDetail(error.detail)
      } else {
        setDetail('Erro inesperado. Tente de novo.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      aria-label={`Estornar ${expense.description}`}
      onSubmit={submit}
      noValidate
      className="flex w-full flex-col gap-3 pt-2"
    >
      <MoneyInput id={`${id}-amount`} label="Valor" value={amount} onChange={setAmount} error={errors.amount} />
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-date`} label="Data" error={errors.occurred_on}>
          <input
            id={`${id}-date`}
            type="date"
            min="1900-01-01"
            max="2100-12-31"
            value={occurredOn}
            onChange={(e) => setDate(e.target.value)}
            {...invalid(`${id}-date`, errors.occurred_on)}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-account`} label="Devolvido em" error={errors.account_id}>
          <select
            id={`${id}-account`}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            {...invalid(`${id}-account`, errors.account_id)}
            className={inputClass}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            {!accounts.some((a) => a.id === expense.account_id) && (
              <option value={expense.account_id}>Conta arquivada</option>
            )}
          </select>
        </Field>
      </div>
      {detail && (
        <p role="alert" className={errorTextClass}>
          {detail}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !hints.data} className={primaryButtonClass}>
          Registrar estorno
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
