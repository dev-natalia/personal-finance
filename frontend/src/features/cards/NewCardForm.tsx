import { type FormEvent, useId, useState } from 'react'

import { ApiError, newIdempotencyKey } from '../../api/client'
import { api } from '../../api/endpoints'
import { useCardCycle, useEntryHints, useInvalidateLedger } from '../../api/queries'
import type { CardIn, CycleOut, ExpenseIn } from '../../api/types'
import { addDays, monthName } from '../../domain/dates'
import { isPositive, tryParseMoney } from '../../domain/money'
import { Field, invalid } from '../../ui/Field'
import { useFocusOnMount } from '../../ui/focus'
import { MoneyInput } from '../../ui/MoneyInput'
import { RemainingField } from './RemainingField'
import {
  errorTextClass,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

const DAYS = Array.from({ length: 31 }, (_, k) => k + 1)
const INSTALLMENTS = Array.from({ length: 23 }, (_, k) => k + 2)
const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'

/** Parcelada que já corria antes do início do cartão (só as parcelas que faltam são lançadas). */
export interface Line {
  id: string
  description: string
  amount: string
  installments: string
  purchasedOn: string
  remaining: string
  saved: boolean
  error: string | null
  key: string
  sentBody: string | null
}

export function newLine(): Line {
  return {
    id: newIdempotencyKey(),
    description: '',
    amount: '',
    installments: '',
    purchasedOn: '',
    remaining: '',
    saved: false,
    error: null,
    key: newIdempotencyKey(),
    sentBody: null,
  }
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
}

/** Corpo da compra em andamento, ou nulo se a linha está incompleta. */
export function lineBody(line: Line, cardId: string): ExpenseIn | null {
  const amount = tryParseMoney(line.amount)
  const count = Number(line.installments)
  const remaining = Number(line.remaining)
  if (
    line.description.trim() === '' ||
    amount === null ||
    !isPositive(amount) ||
    !count ||
    !remaining ||
    !line.purchasedOn
  ) {
    return null
  }
  return {
    type: 'EXPENSE',
    amount,
    occurred_on: line.purchasedOn,
    description: line.description.trim(),
    card_id: cardId,
    installments: count,
    remaining_installments: remaining,
  }
}

interface Props {
  onCreated: (name: string) => void
  onCancel?: () => void
}

/**
 * Novo cartão em dois passos no mesmo formulário: o cartão e, opcionalmente, como ele está hoje
 * (totais que o banco mostra e parceladas que já estavam correndo).
 */
export function NewCardForm({ onCreated, onCancel }: Props) {
  const id = useId()
  const hints = useEntryHints()
  const invalidate = useInvalidateLedger()
  const nameRef = useFocusOnMount<HTMLInputElement>()
  const [name, setName] = useState('')
  const [limit, setLimit] = useState('')
  const [closingDay, setClosingDay] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [openingDate, setOpeningDate] = useState<string | null>(null)
  const [openTotal, setOpenTotal] = useState('')
  const [hasClosed, setHasClosed] = useState(false)
  const [closedTotal, setClosedTotal] = useState('')
  const [closedDue, setClosedDue] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Começa hoje: o total da fatura aberta que o banco mostra hoje já inclui as compras do ciclo.
  const opening = openingDate ?? hints.data?.today ?? ''
  // Qual fatura está aberta no início: os rótulos dizem o mês, para ninguém contar as parcelas a
  // partir da fatura fechada (a parcela deste mês já está no total da aberta).
  const cycle = useCardCycle(
    closingDay && dueDay && opening
      ? { closingDay: Number(closingDay), dueDay: Number(dueDay), openingDate: opening }
      : null,
  ).data
  const openMonth = cycle ? monthName(cycle.open_reference_month) : null
  const closedMonth = cycle ? monthName(addDays(cycle.open_reference_month, -1)) : null

  const editLine = (lineId: string, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.id === lineId ? { ...l, ...patch, error: null } : l)))

  function validate(): { card: CardIn | null; local: Record<string, string> } {
    const local: Record<string, string> = {}
    const creditLimit = tryParseMoney(limit)
    const open = openTotal.trim() ? tryParseMoney(openTotal) : null
    const closed = hasClosed ? tryParseMoney(closedTotal) : null
    if (name.trim() === '') local.name = 'Informe o nome do cartão.'
    if (creditLimit === null || !isPositive(creditLimit)) {
      local.credit_limit = 'Informe um limite maior que zero.'
    }
    if (!closingDay) local.closing_day = 'Escolha o dia.'
    if (!dueDay) local.due_day = 'Escolha o dia.'
    if (openTotal.trim() && (open === null || !isPositive(open))) {
      local.open_invoice_total = 'Use um valor como 1.234,56.'
    }
    if (hasClosed && (closed === null || !isPositive(closed))) {
      local.closed_total = 'Use um valor como 1.234,56.'
    }
    if (hasClosed && !closedDue) local.closed_due = 'Informe o vencimento.'
    lines.forEach((line) => {
      if (!line.saved && lineBody(line, 'x') === null) {
        local[`line-${line.id}`] = 'Preencha todos os campos desta parcelada.'
      }
    })
    if (Object.keys(local).length > 0 || creditLimit === null) return { card: null, local }
    return {
      card: {
        name: name.trim(),
        credit_limit: creditLimit,
        closing_day: Number(closingDay),
        due_day: Number(dueDay),
        opening_date: opening,
        ...(open !== null ? { open_invoice_total: open } : {}),
        ...(hasClosed && closed !== null
          ? { closed_invoice: { total: closed, due_date: closedDue } }
          : {}),
      },
      local,
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setFormError(null)
    const { card, local } = validate()
    setErrors(local)
    if (card === null && cardId === null) return

    setBusy(true)
    let createdId = cardId
    if (createdId === null && card !== null) {
      try {
        createdId = (await api.createCard(card)).id
        setCardId(createdId)
      } catch (error) {
        setFormError(messageOf(error))
        setBusy(false)
        return
      }
    }

    // Cada parcelada com sua chave: reenviar o mesmo conteúdo não duplica; mudar gera outra.
    let failures = 0
    const updated: Line[] = []
    for (const line of lines) {
      const body = createdId ? lineBody(line, createdId) : null
      if (line.saved || body === null || createdId === null) {
        updated.push(line)
        continue
      }
      const sentBody = JSON.stringify(body)
      const key = line.sentBody === null || line.sentBody === sentBody ? line.key : newIdempotencyKey()
      try {
        await api.createTransaction(body, key)
        updated.push({ ...line, saved: true, key, sentBody })
      } catch (error) {
        failures += 1
        updated.push({ ...line, error: messageOf(error), key, sentBody })
      }
    }
    setLines(updated)
    setBusy(false)
    await invalidate()
    if (failures === 0) onCreated(name.trim())
  }

  const created = cardId !== null
  return (
    <form aria-label="Novo cartão" onSubmit={submit} noValidate className="flex flex-col gap-3">
      <h3 className="text-lg font-[650]">Novo cartão</h3>
      <fieldset disabled={created} className="flex flex-col gap-3">
        <legend className="sr-only">Cartão</legend>
        <Field id={`${id}-name`} label="Nome do cartão" error={errors.name}>
          <input
            ref={nameRef}
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...invalid(`${id}-name`, errors.name)}
            className={inputClass}
          />
        </Field>
        <MoneyInput
          id={`${id}-limit`}
          label="Limite"
          value={limit}
          onChange={setLimit}
          error={errors.credit_limit}
        />
        <div className="grid grid-cols-2 gap-3">
          <DaySelect
            id={`${id}-closing`}
            label="Fecha no dia"
            value={closingDay}
            onChange={setClosingDay}
            error={errors.closing_day}
          />
          <DaySelect
            id={`${id}-due`}
            label="Vence no dia"
            value={dueDay}
            onChange={setDueDay}
            error={errors.due_day}
          />
        </div>
        <Field id={`${id}-opening`} label="Começa a acompanhar em">
          <input
            id={`${id}-opening`}
            type="date"
            value={opening}
            onChange={(e) => setOpeningDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </fieldset>

      <fieldset disabled={created} className="flex flex-col gap-3 border-t border-rule pt-3">
        <legend className="pt-3 text-base font-[650]">Como está hoje (opcional)</legend>
        <p className="text-sm text-ink-soft">
          Use os totais que o app do banco mostra agora. As compras deste ciclo já estão neles.
        </p>
        <MoneyInput
          id={`${id}-open-total`}
          label={openMonth ? `Total da fatura de ${openMonth} (aberta agora)` : 'Total da fatura aberta agora'}
          value={openTotal}
          onChange={setOpenTotal}
          error={errors.open_invoice_total}
        />
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={hasClosed}
            onChange={(e) => setHasClosed(e.target.checked)}
            className="size-5 accent-pen"
          />
          Tem fatura fechada sem pagar
        </label>
        {hasClosed && (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <MoneyInput
              id={`${id}-closed-total`}
              label={closedMonth ? `Total da fatura de ${closedMonth} (fechada)` : 'Total da fatura fechada'}
              value={closedTotal}
              onChange={setClosedTotal}
              error={errors.closed_total}
            />
            <Field id={`${id}-closed-due`} label="Vencimento da fatura fechada" error={errors.closed_due}>
              <input
                id={`${id}-closed-due`}
                type="date"
                value={closedDue}
                onChange={(e) => setClosedDue(e.target.value)}
                {...invalid(`${id}-closed-due`, errors.closed_due)}
                className={inputClass}
              />
            </Field>
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-3">
        {lines.map((line, index) => (
          <InstallmentLine
            key={line.id}
            line={line}
            number={index + 1}
            error={line.error ?? errors[`line-${line.id}`] ?? null}
            cycle={cycle ?? null}
            closingDay={closingDay ? Number(closingDay) : null}
            dueDay={dueDay ? Number(dueDay) : null}
            onEdit={(patch) => editLine(line.id, patch)}
            onRemove={() => setLines((all) => all.filter((l) => l.id !== line.id))}
          />
        ))}
        <button
          type="button"
          onClick={() => setLines((all) => [...all, newLine()])}
          className={`${textButton} self-start`}
        >
          Adicionar parcelada em andamento
        </button>
      </div>

      {created && (
        <p role="status" className="text-sm">
          Cartão criado. Falta registrar as parceladas com erro abaixo.
        </p>
      )}
      {formError && (
        <p role="alert" className={errorTextClass}>
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !hints.data} className={primaryButtonClass}>
          {created ? 'Tentar de novo' : 'Criar cartão'}
        </button>
        {onCancel && !created && (
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

export function DaySelect({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <Field id={id} label={label} error={error}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...invalid(id, error)}
        className={inputClass}
      >
        <option value="">Escolha</option>
        {DAYS.map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
      </select>
    </Field>
  )
}

function InstallmentLine({
  line,
  number,
  error,
  cycle,
  closingDay,
  dueDay,
  onEdit,
  onRemove,
}: {
  line: Line
  number: number
  error: string | null
  cycle: CycleOut | null
  closingDay: number | null
  dueDay: number | null
  onEdit: (patch: Partial<Line>) => void
  onRemove: () => void
}) {
  return (
    <fieldset disabled={line.saved} className="flex flex-col gap-2 rounded-lg border border-rule p-3">
      <legend className="px-1 text-sm font-semibold">Parcelada {number}</legend>
      {line.saved ? (
        <p className="text-sm">Registrada.</p>
      ) : (
        <>
          <InstallmentFields
            line={line}
            cycle={cycle}
            closingDay={closingDay}
            dueDay={dueDay}
            onEdit={onEdit}
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remover parcelada ${number}`}
            className={`${textButton} self-start`}
          >
            Remover
          </button>
        </>
      )}
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** Campos de uma parcelada em andamento (cadastro do cartão e tela do cartão). */
export function InstallmentFields({
  line,
  cycle,
  closingDay,
  dueDay,
  onEdit,
}: {
  line: Line
  /** Fatura aberta no início do cartão; nula enquanto não se sabe (rótulo genérico). */
  cycle: CycleOut | null
  /** Dias do cartão, para calcular quantas parcelas faltam; nulos enquanto não escolhidos. */
  closingDay: number | null
  dueDay: number | null
  onEdit: (patch: Partial<Line>) => void
}) {
  const id = useId()
  const count = Number(line.installments)
  const openMonth = cycle ? monthName(cycle.open_reference_month) : null
  return (
    <>
      <Field id={`${id}-description`} label="Descrição">
        <input
          id={`${id}-description`}
          value={line.description}
          onChange={(e) => onEdit({ description: e.target.value })}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <MoneyInput
          id={`${id}-amount`}
          label="Valor total"
          value={line.amount}
          onChange={(value) => onEdit({ amount: value })}
        />
        <label className={fieldLabelClass}>
          Parcelas
          <select
            value={line.installments}
            onChange={(e) => onEdit({ installments: e.target.value, remaining: '' })}
            className={inputClass}
          >
            <option value="">Escolha</option>
            {INSTALLMENTS.map((n) => (
              <option key={n} value={n}>
                {n}x
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClass}>
          Data da compra
          <input
            type="date"
            value={line.purchasedOn}
            onChange={(e) => onEdit({ purchasedOn: e.target.value })}
            className={inputClass}
          />
        </label>
        <RemainingField
          id={`${id}-remaining`}
          label={
            openMonth
              ? `Quantas faltam depois da fatura de ${openMonth}`
              : 'Quantas faltam depois da fatura atual'
          }
          count={count || null}
          purchaseDate={line.purchasedOn}
          closingDay={closingDay}
          dueDay={dueDay}
          startMonth={cycle?.open_reference_month ?? null}
          value={line.remaining}
          onChange={(value) => onEdit({ remaining: value })}
        />
      </div>
      {cycle && (
        <p className="text-sm text-ink-soft">
          Entram a partir da fatura de {monthName(cycle.next_reference_month)}.
        </p>
      )}
    </>
  )
}
