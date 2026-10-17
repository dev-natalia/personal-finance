import { type FormEvent, useEffect, useId, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useEntryHints, useInvalidateLedger } from '../../api/queries'
import { useIdempotencyKey } from '../../api/useIdempotencyKey'
import { isPositive, tryParseMoney } from '../../domain/money'
import { Field, invalid } from '../../ui/Field'
import { MoneyInput } from '../../ui/MoneyInput'
import { errorTextClass, inputClass, primaryButtonClass, secondaryButtonClass } from '../../ui/styles'

interface Props {
  cardId: string
  onDone: (message: string) => void
  onCancel: () => void
}

/** Encargo do cartão (juros, IOF, multa): entra na fatura pela data, como uma compra. */
export function ChargeForm({ cardId, onDone, onCancel }: Props) {
  const id = useId()
  const hints = useEntryHints()
  const invalidate = useInvalidateLedger()
  const keyFor = useIdempotencyKey()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const occurredOn = date ?? hints.data?.today ?? ''
  // Abre no lugar do botão: o foco vai para o primeiro campo.
  useEffect(() => document.getElementById(`${id}-amount`)?.focus(), [id])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const parsed = tryParseMoney(amount)
    const local: Record<string, string> = {}
    if (parsed === null || !isPositive(parsed)) local.amount = 'Informe um valor maior que zero.'
    if (!occurredOn) local.occurred_on = 'Informe a data.'
    if (description.trim() === '') local.description = 'Descreva o encargo, como "IOF" ou "juros".'
    setErrors(local)
    if (Object.keys(local).length > 0 || parsed === null) return

    const body = { amount: parsed, occurred_on: occurredOn, description: description.trim() }
    setSending(true)
    try {
      await api.addCharge(cardId, body, keyFor(body))
      await invalidate()
      onDone('Encargo registrado.')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : 'Erro inesperado. Tente de novo.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      aria-label="Registrar encargo"
      onSubmit={submit}
      noValidate
      className="mt-3 flex flex-col gap-3 border-t border-rule pt-3"
    >
      <MoneyInput
        id={`${id}-amount`}
        label="Valor"
        value={amount}
        onChange={setAmount}
        error={errors.amount}
      />
      <Field id={`${id}-date`} label="Data" error={errors.occurred_on}>
        <input
          id={`${id}-date`}
          type="date"
          value={occurredOn}
          onChange={(e) => setDate(e.target.value)}
          {...invalid(`${id}-date`, errors.occurred_on)}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-description`} label="Descrição" error={errors.description}>
        <input
          id={`${id}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          {...invalid(`${id}-description`, errors.description)}
          className={inputClass}
        />
      </Field>
      {formError && (
        <p role="alert" className={errorTextClass}>
          {formError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={sending} className={primaryButtonClass}>
          Registrar encargo
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
