import { type FormEvent, useId, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useAccounts, useEntryHints, useInvalidateLedger } from '../../api/queries'
import type { InvoicePaymentIn, InvoiceSummaryOut } from '../../api/types'
import { useIdempotencyKey } from '../../api/useIdempotencyKey'
import { monthName } from '../../domain/dates'
import {
  addMoney,
  formatBRL,
  formatBRLNoBreak,
  isPositive,
  multiplyMoney,
  subtractMoney,
  tryParseMoney,
} from '../../domain/money'
import { Field, invalid } from '../../ui/Field'
import { MoneyInput } from '../../ui/MoneyInput'
import {
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

const MAX_SOURCES = 5
const INSTALLMENTS = Array.from({ length: 23 }, (_, k) => k + 2)
const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'

type Choice = 'NONE' | 'CARRY_OVER' | 'INSTALLMENTS'

interface Source {
  id: number
  accountId: string
  amount: string
}

interface Props {
  invoice: InvoiceSummaryOut
  cardName: string
  onDone: (message: string) => void
  onCancel: () => void
}

/** "2300.00" → "2.300,00": o valor como se digita no campo. */
function inputAmount(amount: string): string {
  return formatBRL(amount).replace('R$ ', '')
}

/** Pagamento da fatura, de uma ou mais contas; o que faltar pode ficar, ir adiante ou ser parcelado. */
export function InvoicePaymentForm({ invoice, cardName, onDone, onCancel }: Props) {
  const id = useId()
  const hints = useEntryHints()
  const accounts = useAccounts()
  const invalidate = useInvalidateLedger()
  const keyFor = useIdempotencyKey()
  const month = monthName(invoice.reference_month)
  const balance = invoice.balance

  const [sources, setSources] = useState<Source[]>([
    { id: 1, accountId: '', amount: inputAmount(balance) },
  ])
  const [date, setDate] = useState<string | null>(null)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [count, setCount] = useState('')
  const [installmentAmount, setInstallmentAmount] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const accountList = accounts.data ?? []
  // A conta mais usada nos lançamentos (vem primeiro nas sugestões) já vem escolhida.
  const preferred =
    hints.data?.top_payment_options.find(
      (option) => option.account_id && accountList.some((a) => a.id === option.account_id),
    )?.account_id ??
    accountList[0]?.id ??
    ''
  const accountOf = (source: Source, index: number) =>
    source.accountId || (index === 0 ? preferred : '')
  const occurredOn = date ?? hints.data?.today ?? ''

  const paying = sources.reduce(
    (sum, source) => addMoney(sum, tryParseMoney(source.amount) ?? '0.00'),
    '0.00',
  )
  const remaining = subtractMoney(balance, paying)
  const hasRemainder = isPositive(remaining)
  const offersRemainder = hasRemainder && invoice.state === 'CLOSED'
  const plan = installmentPlan(count, installmentAmount)

  function update(sourceId: number, changes: Partial<Source>) {
    setSources((current) => current.map((s) => (s.id === sourceId ? { ...s, ...changes } : s)))
  }

  function addSource() {
    setSources((current) => [
      ...current,
      { id: Math.max(...current.map((s) => s.id)) + 1, accountId: '', amount: '' },
    ])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const local: Record<string, string> = {}
    const parsed = sources.map((source, index) => {
      const amount = tryParseMoney(source.amount)
      const accountId = accountOf(source, index)
      if (!accountId) local[`account-${source.id}`] = 'Escolha a conta.'
      if (amount === null || !isPositive(amount)) {
        local[`amount-${source.id}`] = 'Informe um valor maior que zero.'
      }
      return { account_id: accountId, amount: amount ?? '0.00' }
    })
    if (!occurredOn) local.date = 'Informe a data.'
    if (offersRemainder && choice === null) local.choice = 'Escolha o que fazer com o restante.'
    if (offersRemainder && choice === 'INSTALLMENTS' && plan === null) {
      local.plan = 'Informe as parcelas e o valor de cada uma.'
    }
    setErrors(local)
    if (Object.keys(local).length > 0) return

    let remainder: InvoicePaymentIn['remainder'] = 'NONE'
    if (offersRemainder && choice === 'CARRY_OVER') remainder = 'CARRY_OVER'
    if (offersRemainder && choice === 'INSTALLMENTS' && plan) remainder = plan
    const body: InvoicePaymentIn = { occurred_on: occurredOn, sources: parsed, remainder }

    if (invoice.id === null) return
    setSending(true)
    try {
      await api.payInvoice(invoice.id, body, keyFor(body))
      await invalidate()
      onDone('Pagamento registrado.')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.detail : 'Sem conexão. Tente de novo.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      aria-label={`Pagar fatura de ${month}`}
      onSubmit={submit}
      noValidate
      className="mt-4 flex flex-col gap-3 border-t border-rule pt-4"
    >
      <h2 className="text-lg font-[650]">Pagar fatura de {month}</h2>
      <p className="tabular">Total {formatBRLNoBreak(balance)}</p>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">De onde sai o dinheiro</legend>
        {sources.map((source, index) => (
          <fieldset key={source.id} className="flex flex-col gap-2 border-b border-rule pb-3">
            <legend className="sr-only">Conta {index + 1}</legend>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <Field
                id={`${id}-account-${source.id}`}
                label="Conta"
                error={errors[`account-${source.id}`]}
              >
                <select
                  id={`${id}-account-${source.id}`}
                  value={accountOf(source, index)}
                  onChange={(e) => update(source.id, { accountId: e.target.value })}
                  {...invalid(`${id}-account-${source.id}`, errors[`account-${source.id}`])}
                  className={inputClass}
                >
                  <option value="">Escolha</option>
                  {accountList.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </Field>
              <MoneyInput
                id={`${id}-amount-${source.id}`}
                label="Valor"
                value={source.amount}
                onChange={(amount) => update(source.id, { amount })}
                error={errors[`amount-${source.id}`]}
              />
            </div>
            {index > 0 && (
              <button
                type="button"
                onClick={() => setSources((current) => current.filter((s) => s.id !== source.id))}
                className={`${textButton} self-start`}
              >
                Remover conta {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        {sources.length < MAX_SOURCES && (
          <button type="button" onClick={addSource} className={`${textButton} self-start`}>
            Adicionar outra conta
          </button>
        )}
      </fieldset>

      <Field id={`${id}-date`} label="Data" error={errors.date}>
        <input
          id={`${id}-date`}
          type="date"
          value={occurredOn}
          onChange={(e) => setDate(e.target.value)}
          {...invalid(`${id}-date`, errors.date)}
          className={`${inputClass} max-w-xs`}
        />
      </Field>

      <div className="tabular">
        <p>Pagando {formatBRLNoBreak(paying)}</p>
        {hasRemainder && <p className="font-semibold">Faltam {formatBRLNoBreak(remaining)}</p>}
        {remaining.startsWith('-') && (
          <p className="text-stamp">
            Passa do total em {formatBRLNoBreak(remaining.slice(1))}
          </p>
        )}
      </div>

      {offersRemainder && (
        <RemainderOptions
          remaining={remaining}
          cardName={cardName}
          choice={choice}
          onChoice={setChoice}
          count={count}
          onCount={setCount}
          installmentAmount={installmentAmount}
          onInstallmentAmount={setInstallmentAmount}
          errors={errors}
        />
      )}

      {formError && (
        <p role="alert" className={errorTextClass}>
          {formError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={sending} className={primaryButtonClass}>
          Registrar pagamento
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function installmentPlan(count: string, amount: string) {
  const parsed = tryParseMoney(amount)
  if (count === '' || parsed === null || !isPositive(parsed)) return null
  return { installments: Number(count), installment_amount: parsed }
}

function RemainderOptions({
  remaining,
  cardName,
  choice,
  onChoice,
  count,
  onCount,
  installmentAmount,
  onInstallmentAmount,
  errors,
}: {
  remaining: string
  cardName: string
  choice: Choice | null
  onChoice: (choice: Choice) => void
  count: string
  onCount: (count: string) => void
  installmentAmount: string
  onInstallmentAmount: (amount: string) => void
  errors: Record<string, string>
}) {
  const id = useId()
  const plan = installmentPlan(count, installmentAmount)
  const interest = plan
    ? subtractMoney(multiplyMoney(plan.installment_amount, plan.installments), remaining)
    : null
  const options: [Choice, string][] = [
    ['NONE', 'Só pagar esta parte agora'],
    ['CARRY_OVER', 'Deixar para a próxima fatura'],
    ['INSTALLMENTS', `Parcelar com o ${cardName}`],
  ]

  return (
    <fieldset className="flex flex-col gap-1" {...invalid(`${id}-choice`, errors.choice)}>
      <legend className="mb-1 font-semibold">
        O que fazer com os {formatBRL(remaining)}?
      </legend>
      {options.map(([value, label]) => (
        <label key={value} className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name={`${id}-choice`}
            value={value}
            checked={choice === value}
            onChange={() => onChoice(value)}
            className="size-5 accent-pen"
          />
          {label}
        </label>
      ))}
      {errors.choice && (
        <p id={`${id}-choice-error`} className={errorTextClass}>
          {errors.choice}
        </p>
      )}
      {choice === 'INSTALLMENTS' && (
        <div className="mt-2 flex flex-col gap-3 border-l-2 border-rule pl-3">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <Field id={`${id}-count`} label="Parcelas">
              <select
                id={`${id}-count`}
                value={count}
                onChange={(e) => onCount(e.target.value)}
                className={inputClass}
              >
                <option value="">Escolha</option>
                {INSTALLMENTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <MoneyInput
              id={`${id}-installment`}
              label="Valor de cada parcela"
              value={installmentAmount}
              onChange={onInstallmentAmount}
            />
          </div>
          {interest !== null && isPositive(interest) && (
            <p className="tabular text-sm">
              Juros que serão registrados: {formatBRLNoBreak(interest)}
            </p>
          )}
          {interest !== null && interest.startsWith('-') && (
            <p className="text-sm text-stamp">As parcelas somam menos que o restante.</p>
          )}
          {errors.plan && <p className={errorTextClass}>{errors.plan}</p>}
        </div>
      )}
    </fieldset>
  )
}
