import { type FormEvent, type ReactNode, useId, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import {
  useCardCycle,
  useCards,
  useCategories,
  useEntryHints,
  useInvalidateLedger,
} from '../../api/queries'
import type {
  ExpenseIn,
  IncomeIn,
  TransactionOut,
  TransactionPatch,
  TransactionType,
  TransactionWriteOut,
  TransferIn,
} from '../../api/types'
import { useIdempotencyKey } from '../../api/useIdempotencyKey'
import {
  ACCOUNT_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_TYPE_LABELS,
} from '../../domain/labels'
import { monthName } from '../../domain/dates'
import { isPositive, toInputAmount, tryParseMoney } from '../../domain/money'
import type { PaymentMethod } from '../../domain/parser'
import { CardImpact } from '../entry/CardImpact'
import { Field, invalid } from '../../ui/Field'
import { MoneyInput } from '../../ui/MoneyInput'
import {
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

type NewType = Extract<TransactionType, 'EXPENSE' | 'INCOME' | 'TRANSFER'>
type Errors = Record<string, string>

const NEW_TYPES: NewType[] = ['EXPENSE', 'INCOME', 'TRANSFER']
const PAYMENT_METHODS = ACCOUNT_PAYMENT_METHODS.map((m): [PaymentMethod, string] => [
  m,
  PAYMENT_METHOD_LABELS[m],
])
const AUTOMATIC = ''
const INSTALLMENT_CHOICES = Array.from({ length: 23 }, (_, k) => k + 2)

interface Fields {
  type: TransactionType
  amount: string
  date: string | null
  description: string
  merchant: string
  notes: string
  account: string
  destination: string
  method: PaymentMethod | ''
  category: string
  /** Cartão da compra; vazio quando sai de uma conta. */
  card: string
  /** Número de parcelas; vazio é à vista. */
  installments: string
  /** Parcelada de antes do início do cartão: quantas faltam depois da fatura do início. */
  remaining: string
}

/** Atalho da tela do cartão: `/lancamentos/novo?card=…&date=…`. */
export interface FormDefaults {
  cardId?: string
  date?: string
}

function fieldsOf(initial: TransactionOut | undefined, defaults: FormDefaults): Fields {
  return {
    type: initial?.type ?? 'EXPENSE',
    amount: initial ? toInputAmount(initial.amount) : '',
    date: initial?.occurred_on ?? defaults.date ?? null,
    description: initial?.description ?? '',
    merchant: '',
    notes: initial?.notes ?? '',
    account: initial?.account_id ?? '',
    destination: initial?.destination_account_id ?? '',
    method: initial?.payment_method ?? '',
    category: initial?.category_id ?? AUTOMATIC,
    card: initial ? (initial.card_id ?? '') : (defaults.cardId ?? ''),
    installments: initial?.installments ? String(initial.installments) : '',
    remaining: '',
  }
}

const installmentsOf = (f: Fields): number | null => (f.installments ? Number(f.installments) : null)

function serverErrors(error: unknown): { fields: Errors; detail: string } {
  if (!(error instanceof ApiError)) return { fields: {}, detail: 'Erro inesperado. Tente de novo.' }
  return {
    fields: Object.fromEntries(error.fieldErrors.map((f) => [f.field, f.message])),
    detail: error.detail,
  }
}

/** Campos alterados em relação ao lançamento original; o PATCH leva só eles. */
function changedFields(initial: TransactionOut, f: Fields, amount: string, date: string): TransactionPatch {
  const patch: TransactionPatch = {}
  const notes = f.notes.trim() || null
  if (amount !== initial.amount) patch.amount = amount
  if (date !== initial.occurred_on) patch.occurred_on = date
  if (f.description.trim() !== initial.description) patch.description = f.description.trim()
  if (notes !== initial.notes) patch.notes = notes
  if (initial.account_id !== null && f.account !== initial.account_id) patch.account_id = f.account
  if (initial.card_id !== null && f.card !== initial.card_id) patch.card_id = f.card
  if (initial.type === 'EXPENSE' && initial.card_id !== null) {
    const installments = installmentsOf(f)
    if (installments !== initial.installments) patch.installments = installments
  }
  if (initial.type === 'TRANSFER' && f.destination !== initial.destination_account_id) {
    patch.destination_account_id = f.destination
  }
  if (initial.type === 'EXPENSE' && f.method && f.method !== initial.payment_method) {
    patch.payment_method = f.method
  }
  if (f.category !== AUTOMATIC && f.category !== initial.category_id) patch.category_id = f.category
  return patch
}

/** `inProgress`: compra no cartão de antes do início dele (só as parcelas que faltam). */
function newBody(
  f: Fields,
  amount: string,
  date: string,
  inProgress: boolean,
): ExpenseIn | IncomeIn | TransferIn {
  const common = { amount, occurred_on: date, description: f.description.trim() }
  const notes = f.notes.trim() ? { notes: f.notes.trim() } : {}
  if (f.type === 'TRANSFER') {
    return {
      type: 'TRANSFER',
      ...common,
      account_id: f.account,
      destination_account_id: f.destination,
      ...notes,
    }
  }
  const extra = {
    ...(f.merchant.trim() ? { merchant: f.merchant.trim() } : {}),
    ...notes,
    ...(f.category !== AUTOMATIC ? { category_id: f.category } : {}),
  }
  if (f.type === 'INCOME') return { type: 'INCOME', ...common, account_id: f.account, ...extra }
  if (f.card) {
    const installments = installmentsOf(f)
    return {
      type: 'EXPENSE',
      ...common,
      card_id: f.card,
      ...(installments !== null ? { installments } : {}),
      ...(inProgress && f.remaining ? { remaining_installments: Number(f.remaining) } : {}),
      ...extra,
    }
  }
  return {
    type: 'EXPENSE',
    ...common,
    account_id: f.account,
    payment_method: f.method as PaymentMethod,
    ...extra,
  }
}

interface Props {
  initial?: TransactionOut
  defaults?: FormDefaults
  onDone: (result: TransactionWriteOut) => void
  onCancel?: () => void
}

/** Formulário com todos os campos: cria despesa, receita ou transferência, ou edita um lançamento. */
export function TransactionForm({ initial, defaults = {}, onDone, onCancel }: Props) {
  const id = useId()
  const hints = useEntryHints()
  const categories = useCategories()
  const invalidate = useInvalidateLedger()
  const keyFor = useIdempotencyKey()
  const [f, setF] = useState<Fields>(() => fieldsOf(initial, defaults))
  const [errors, setErrors] = useState<Errors>({})
  const [detail, setDetail] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const editing = initial !== undefined
  const date = f.date ?? hints.data?.today ?? ''
  const set = <K extends keyof Fields>(name: K) => (value: Fields[K]) => setF((p) => ({ ...p, [name]: value }))

  const accounts = hints.data?.accounts ?? []
  const missingAccounts = [initial?.account_id, initial?.destination_account_id].filter(
    (accountId): accountId is string => !!accountId && !accounts.some((a) => a.id === accountId),
  )
  const kind = f.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
  const kindCategories = (categories.data ?? []).filter((c) => c.kind === kind && !c.archived_at)
  const hasCategory = f.type === 'EXPENSE' || f.type === 'INCOME'
  // Compra no cartão (ou encargo): sem conta nem meio; o cartão faz esse papel.
  const onCard = f.card !== ''
  const cards = hints.data?.cards ?? []
  const missingCard = onCard && hints.data !== undefined && !cards.some((c) => c.id === f.card)
  // Compra no cartão com data de antes do início dele: parcelada que já vinha correndo. Só as
  // parcelas que faltam entram; à vista, ela já está no total da fatura do início.
  const cardInfo = useCards().data?.find((c) => c.id === f.card)
  const beforeStart =
    !editing && f.type === 'EXPENSE' && cardInfo !== undefined && !!date && date < cardInfo.opening_date
  const startCycle = useCardCycle(
    beforeStart
      ? {
          closingDay: cardInfo.closing_day,
          dueDay: cardInfo.due_day,
          openingDate: cardInfo.opening_date,
        }
      : null,
  ).data
  const installmentCount = installmentsOf(f)

  function validate(amount: string | null): Errors {
    const local: Errors = {}
    if (amount === null) local.amount = 'Use um valor como 1.234,56.'
    else if (!isPositive(amount)) local.amount = 'Informe um valor maior que zero.'
    if (!date) local.occurred_on = 'Informe a data.'
    if (f.description.trim() === '') local.description = 'Informe uma descrição.'
    if (!onCard && !f.account) local.account_id = 'Escolha a conta.'
    if (f.type === 'TRANSFER' && !f.destination) local.destination_account_id = 'Escolha a conta de destino.'
    if (f.type === 'EXPENSE' && !onCard && !f.method) local.payment_method = 'Escolha o meio de pagamento.'
    if (beforeStart && installmentCount === null) local.installments = 'Escolha as parcelas da compra.'
    else if (beforeStart && !f.remaining) local.remaining_installments = 'Escolha quantas parcelas faltam.'
    return local
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setDetail(null)
    const amount = tryParseMoney(f.amount)
    const local = validate(amount)
    setErrors(local)
    if (Object.keys(local).length > 0 || amount === null) return

    let request: Promise<TransactionWriteOut>
    if (initial) {
      const patch = changedFields(initial, f, amount, date)
      if (Object.keys(patch).length === 0) {
        setDetail('Nada mudou. Altere algum campo ou feche o formulário.')
        return
      }
      request = api.updateTransaction(initial.id, patch)
    } else {
      const body = newBody(f, amount, date, beforeStart)
      request = api.createTransaction(body, keyFor(body))
    }

    setSaving(true)
    try {
      const result = await request
      await invalidate()
      onDone(result)
    } catch (error) {
      const { fields, detail: message } = serverErrors(error)
      setErrors(fields)
      setDetail(message)
    } finally {
      setSaving(false)
    }
  }

  const accountOptions = (
    <>
      <option value="">Selecione</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
      {missingAccounts.map((accountId) => (
        <option key={accountId} value={accountId}>
          Conta arquivada
        </option>
      ))}
    </>
  )

  return (
    <form
      aria-label={editing ? 'Editar lançamento' : 'Novo lançamento'}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
    >
      {!editing && (
        <Field id={`${id}-type`} label="Tipo">
          <select
            id={`${id}-type`}
            value={f.type}
            // Categoria é por tipo (despesa ou receita): a escolhida antes não vale mais.
            onChange={(e) =>
              setF((p) => ({
                ...p,
                type: e.target.value as NewType,
                category: AUTOMATIC,
                ...(e.target.value === 'EXPENSE' ? {} : { card: '', installments: '' }),
              }))
            }
            className={inputClass}
          >
            {NEW_TYPES.map((type) => (
              <option key={type} value={type}>
                {TRANSACTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <MoneyInput
        id={`${id}-amount`}
        label={beforeStart ? 'Valor total' : 'Valor'}
        value={f.amount}
        onChange={set('amount')}
        error={errors.amount}
      />
      <Field id={`${id}-date`} label="Data" error={errors.occurred_on}>
        <input
          id={`${id}-date`}
          type="date"
          min="1900-01-01"
          max="2100-12-31"
          value={date}
          onChange={(e) => set('date')(e.target.value)}
          {...invalid(`${id}-date`, errors.occurred_on)}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-description`} label="Descrição" error={errors.description}>
        <input
          id={`${id}-description`}
          value={f.description}
          onChange={(e) => set('description')(e.target.value)}
          {...invalid(`${id}-description`, errors.description)}
          className={inputClass}
        />
      </Field>
      {!editing && hasCategory && (
        <Field id={`${id}-merchant`} label="Estabelecimento (opcional)" error={errors.merchant}>
          <input
            id={`${id}-merchant`}
            value={f.merchant}
            onChange={(e) => set('merchant')(e.target.value)}
            {...invalid(`${id}-merchant`, errors.merchant)}
            className={inputClass}
          />
        </Field>
      )}

      {f.type === 'TRANSFER' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field id={`${id}-from`} label="De" error={errors.account_id}>
            <select
              id={`${id}-from`}
              value={f.account}
              onChange={(e) => set('account')(e.target.value)}
              {...invalid(`${id}-from`, errors.account_id)}
              className={inputClass}
            >
              {accountOptions}
            </select>
          </Field>
          <Field id={`${id}-to`} label="Para" error={errors.destination_account_id}>
            <select
              id={`${id}-to`}
              value={f.destination}
              onChange={(e) => set('destination')(e.target.value)}
              {...invalid(`${id}-to`, errors.destination_account_id)}
              className={inputClass}
            >
              {accountOptions}
            </select>
          </Field>
        </div>
      ) : (
        <SourceField
          id={`${id}-account`}
          f={f}
          editing={editing}
          accounts={accounts}
          cards={cards}
          missingCard={missingCard}
          accountOptions={accountOptions}
          error={errors.account_id ?? errors.card_id}
          onAccount={(account) => setF((p) => ({ ...p, account, card: '', installments: '' }))}
          onCard={(card) => setF((p) => ({ ...p, card, account: '', method: '' }))}
        />
      )}

      {f.type === 'EXPENSE' && onCard && (
        <Field id={`${id}-installments`} label="Parcelas" error={errors.installments}>
          <select
            id={`${id}-installments`}
            value={f.installments}
            onChange={(e) => setF((p) => ({ ...p, installments: e.target.value, remaining: '' }))}
            {...invalid(`${id}-installments`, errors.installments)}
            className={inputClass}
          >
            <option value="">À vista</option>
            {INSTALLMENT_CHOICES.map((count) => (
              <option key={count} value={count}>
                {count}x
              </option>
            ))}
          </select>
        </Field>
      )}

      {beforeStart && (
        <InProgressFields
          id={`${id}-remaining`}
          count={installmentCount}
          openingDate={cardInfo.opening_date}
          openMonth={startCycle ? monthName(startCycle.open_reference_month) : null}
          nextMonth={startCycle ? monthName(startCycle.next_reference_month) : null}
          value={f.remaining}
          error={errors.remaining_installments}
          onChange={set('remaining')}
        />
      )}

      {!editing && f.type === 'EXPENSE' && onCard && !beforeStart && (
        <CardImpact input={previewOf(f, date)} />
      )}

      {f.type === 'EXPENSE' && !onCard && (
        <Field id={`${id}-method`} label="Meio" error={errors.payment_method}>
          <select
            id={`${id}-method`}
            value={f.method}
            onChange={(e) => set('method')(e.target.value as PaymentMethod)}
            {...invalid(`${id}-method`, errors.payment_method)}
            className={inputClass}
          >
            <option value="">Selecione</option>
            {PAYMENT_METHODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {hasCategory && (
        <Field id={`${id}-category`} label="Categoria" error={errors.category_id}>
          <select
            id={`${id}-category`}
            value={f.category}
            onChange={(e) => set('category')(e.target.value)}
            {...invalid(`${id}-category`, errors.category_id)}
            className={inputClass}
          >
            {!editing && <option value={AUTOMATIC}>Sugestão automática</option>}
            {kindCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field id={`${id}-notes`} label="Notas (opcional)" error={errors.notes}>
        <textarea
          id={`${id}-notes`}
          rows={2}
          value={f.notes}
          onChange={(e) => set('notes')(e.target.value)}
          {...invalid(`${id}-notes`, errors.notes)}
          className={inputClass}
        />
      </Field>

      {detail && (
        <p role="alert" className={errorTextClass}>
          {detail}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !hints.data} className={primaryButtonClass}>
          {editing ? 'Salvar alterações' : 'Salvar lançamento'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

/** "2026-09-01" → "01/09/2026". */
function fullDate(iso: string): string {
  return iso.split('-').reverse().join('/')
}

/** Parcelada que já corria antes do início do cartão: quantas faltam, ou o aviso se à vista. */
function InProgressFields({
  id,
  count,
  openingDate,
  openMonth,
  nextMonth,
  value,
  error,
  onChange,
}: {
  id: string
  count: number | null
  openingDate: string
  /** Fatura aberta no início do cartão; nula enquanto não se sabe (rótulo genérico). */
  openMonth: string | null
  nextMonth: string | null
  value: string
  error: string | undefined
  onChange: (value: string) => void
}) {
  if (count === null) {
    return (
      <p className="text-sm text-ink-soft">
        Compra à vista de antes do início do cartão já está no total da fatura
        {openMonth ? ` de ${openMonth}` : ' do início'} (ou já foi paga): não precisa lançar.
      </p>
    )
  }
  return (
    <>
      <p className="text-sm text-ink-soft">
        Compra de antes de o cartão entrar no app (início em {fullDate(openingDate)}): só as
        parcelas que ainda faltam entram nas próximas faturas
        {nextMonth ? `, a partir da de ${nextMonth}` : ''}.
      </p>
      <Field
        id={id}
        label={`Quantas faltam depois da fatura ${openMonth ? `de ${openMonth}` : 'do início'}`}
        error={error}
      >
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...invalid(id, error)}
          className={inputClass}
        >
          <option value="">Escolha</option>
          {Array.from({ length: count - 1 }, (_, k) => k + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}

/** Prévia da compra no cartão; nula enquanto o valor não é válido. */
function previewOf(f: Fields, date: string) {
  const amount = tryParseMoney(f.amount)
  if (amount === null || !isPositive(amount) || !date) return null
  const installments = installmentsOf(f)
  return {
    cardId: f.card,
    body: { amount, occurred_on: date, ...(installments !== null ? { installments } : {}) },
  }
}

interface Named {
  id: string
  name: string
}

/**
 * De onde sai o dinheiro. Despesa nova escolhe entre contas e cartões no mesmo campo; na
 * edição, uma compra no cartão troca só de cartão e uma de conta, só de conta.
 */
function SourceField({
  id,
  f,
  editing,
  accounts,
  cards,
  missingCard,
  accountOptions,
  error,
  onAccount,
  onCard,
}: {
  id: string
  f: Fields
  editing: boolean
  accounts: Named[]
  cards: Named[]
  missingCard: boolean
  accountOptions: ReactNode
  error: string | undefined
  onAccount: (account: string) => void
  onCard: (card: string) => void
}) {
  const cardLabel = (card: Named) => `${PAYMENT_METHOD_LABELS.CREDIT} ${card.name}`

  if (editing || f.type === 'INCOME') {
    const card = f.card !== ''
    return (
      <Field
        id={id}
        label={card ? 'Cartão' : f.type === 'INCOME' ? 'Recebido em' : 'Conta'}
        error={error}
      >
        <select
          id={id}
          value={card ? f.card : f.account}
          onChange={(e) => (card ? onCard(e.target.value) : onAccount(e.target.value))}
          {...invalid(id, error)}
          className={inputClass}
        >
          {card ? (
            <>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {cardLabel(c)}
                </option>
              ))}
              {missingCard && <option value={f.card}>Cartão arquivado</option>}
            </>
          ) : (
            accountOptions
          )}
        </select>
      </Field>
    )
  }

  // Um valor só para os dois grupos: "account:<id>" ou "card:<id>".
  const value = f.card ? `card:${f.card}` : f.account ? `account:${f.account}` : ''
  function choose(choice: string) {
    const [kind, sourceId = ''] = choice.split(':')
    if (kind === 'card') onCard(sourceId)
    else onAccount(sourceId)
  }
  return (
    <Field id={id} label="Conta ou cartão" error={error}>
      <select
        id={id}
        value={value}
        onChange={(e) => choose(e.target.value)}
        {...invalid(id, error)}
        className={inputClass}
      >
        <option value="">Selecione</option>
        <optgroup label="Contas">
          {accounts.map((a) => (
            <option key={a.id} value={`account:${a.id}`}>
              {a.name}
            </option>
          ))}
        </optgroup>
        {(cards.length > 0 || missingCard) && (
          <optgroup label="Cartões">
            {cards.map((c) => (
              <option key={c.id} value={`card:${c.id}`}>
                {cardLabel(c)}
              </option>
            ))}
            {missingCard && <option value={`card:${f.card}`}>Cartão arquivado</option>}
          </optgroup>
        )}
      </select>
    </Field>
  )
}
