import { type FormEvent, useId, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useCardCycle, useInvalidateLedger } from '../../api/queries'
import type { CardSummaryOut, CycleOut } from '../../api/types'
import { useIdempotencyKey } from '../../api/useIdempotencyKey'
import { monthName } from '../../domain/dates'
import { tryParseMoney } from '../../domain/money'
import type { Announce } from '../../ui/focus'
import { MoneyInput } from '../../ui/MoneyInput'
import { errorTextClass, primaryButtonClass } from '../../ui/styles'
import { InstallmentFields, type Line, lineBody, newLine } from './NewCardForm'

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
}

/**
 * O início do cartão feito (ou completado) depois do cadastro: o total da fatura aberta no
 * início, enquanto ela não fechou, e parceladas que já corriam antes do cartão entrar no app.
 */
export function OpeningSection({
  summary,
  onMessage,
}: {
  summary: CardSummaryOut
  onMessage: Announce
}) {
  const { card } = summary
  const cycle = useCardCycle({
    closingDay: card.closing_day,
    dueDay: card.due_day,
    openingDate: card.opening_date,
  }).data
  const stillOpen = cycle?.open_reference_month === summary.open_invoice.reference_month

  return (
    <div className="flex flex-col gap-6 pb-4">
      {cycle &&
        (stillOpen ? (
          <OpeningTotalForm cardId={card.id} cycle={cycle} onMessage={onMessage} />
        ) : (
          <p className="text-sm text-ink-soft">
            A fatura de {monthName(cycle.open_reference_month)}, a do início, já fechou: confira
            o total dela pelo valor do banco.
          </p>
        ))}
      <InProgressForm
        cardId={card.id}
        closingDay={card.closing_day}
        dueDay={card.due_day}
        cycle={cycle ?? null}
        onMessage={onMessage}
      />
    </div>
  )
}

function OpeningTotalForm({
  cardId,
  cycle,
  onMessage,
}: {
  cardId: string
  cycle: CycleOut
  onMessage: Announce
}) {
  const id = useId()
  const invalidate = useInvalidateLedger()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const month = monthName(cycle.open_reference_month)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = amount.trim() === '' ? '0.00' : tryParseMoney(amount)
    if (parsed === null) {
      setError('Use um valor como 1.234,56.')
      return
    }
    setError(null)
    try {
      await api.setOpeningTotal(cardId, parsed)
      await invalidate()
      onMessage('Total do início salvo.')
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <form
      aria-label="Total da fatura no início"
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-ink-soft">
        O total que o banco mostrava ao começar; substitui o informado antes (vazio apaga).
      </p>
      <MoneyInput
        id={`${id}-total`}
        label={`Total da fatura de ${month} no início`}
        value={amount}
        onChange={setAmount}
        error={error}
      />
      <button type="submit" className={`${primaryButtonClass} self-start`}>
        Salvar total
      </button>
    </form>
  )
}

function InProgressForm({
  cardId,
  closingDay,
  dueDay,
  cycle,
  onMessage,
}: {
  cardId: string
  closingDay: number
  dueDay: number
  cycle: CycleOut | null
  onMessage: Announce
}) {
  const invalidate = useInvalidateLedger()
  const keyFor = useIdempotencyKey()
  const [line, setLine] = useState<Line>(newLine)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = lineBody(line, cardId)
    if (body === null) {
      setError('Preencha descrição, valor, parcelas, data da compra e quantas faltam.')
      return
    }
    setError(null)
    setSending(true)
    try {
      await api.createTransaction(body, keyFor(body))
      await invalidate()
      onMessage(`Parcelada ${body.description} adicionada.`)
      setLine(newLine())
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      aria-label="Adicionar parcelada em andamento"
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-ink-soft">
        Compra parcelada que já corria antes de o cartão entrar no app. Só as parcelas que faltam
        entram nas próximas faturas.
      </p>
      <InstallmentFields
        line={line}
        cycle={cycle}
        closingDay={closingDay}
        dueDay={dueDay}
        onEdit={(patch) => setLine((current) => ({ ...current, ...patch }))}
      />
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
      <button type="submit" disabled={sending} className={`${primaryButtonClass} self-start`}>
        Adicionar parcelada
      </button>
    </form>
  )
}
