import { type FormEvent, useId, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useCategories, useEntryHints, useInvalidateLedger } from '../../api/queries'
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
import { PAYMENT_METHOD_LABELS, TRANSACTION_TYPE_LABELS } from '../../domain/labels'
import { isPositive, toInputAmount, tryParseMoney } from '../../domain/money'
import type { PaymentMethod } from '../../domain/parser'
import { Field, invalid } from '../../ui/Field'
import { MoneyInput } from '../../ui/MoneyInput'
import {
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

type NewType = Exclude<TransactionType, 'REFUND'>
type Errors = Record<string, string>

const NEW_TYPES: NewType[] = ['EXPENSE', 'INCOME', 'TRANSFER']
const PAYMENT_METHODS = Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]
const AUTOMATIC = ''

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
}

function fieldsOf(initial: TransactionOut | undefined): Fields {
  return {
    type: initial?.type ?? 'EXPENSE',
    amount: initial ? toInputAmount(initial.amount) : '',
    date: initial?.occurred_on ?? null,
    description: initial?.description ?? '',
    merchant: '',
    notes: initial?.notes ?? '',
    account: initial?.account_id ?? '',
    destination: initial?.destination_account_id ?? '',
    method: initial?.payment_method ?? '',
    category: initial?.category_id ?? AUTOMATIC,
  }
}

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
  if (f.account !== initial.account_id) patch.account_id = f.account
  if (initial.type === 'TRANSFER' && f.destination !== initial.destination_account_id) {
    patch.destination_account_id = f.destination
  }
  if (initial.type === 'EXPENSE' && f.method && f.method !== initial.payment_method) {
    patch.payment_method = f.method
  }
  if (f.category !== AUTOMATIC && f.category !== initial.category_id) patch.category_id = f.category
  return patch
}

function newBody(f: Fields, amount: string, date: string): ExpenseIn | IncomeIn | TransferIn {
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
  onDone: (result: TransactionWriteOut) => void
  onCancel?: () => void
}

/** Formulário com todos os campos: cria despesa, receita ou transferência, ou edita um lançamento. */
export function TransactionForm({ initial, onDone, onCancel }: Props) {
  const id = useId()
  const hints = useEntryHints()
  const categories = useCategories()
  const invalidate = useInvalidateLedger()
  const keyFor = useIdempotencyKey()
  const [f, setF] = useState<Fields>(() => fieldsOf(initial))
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

  function validate(amount: string | null): Errors {
    const local: Errors = {}
    if (amount === null) local.amount = 'Use um valor como 1.234,56.'
    else if (!isPositive(amount)) local.amount = 'Informe um valor maior que zero.'
    if (!date) local.occurred_on = 'Informe a data.'
    if (f.description.trim() === '') local.description = 'Informe uma descrição.'
    if (!f.account) local.account_id = 'Escolha a conta.'
    if (f.type === 'TRANSFER' && !f.destination) local.destination_account_id = 'Escolha a conta de destino.'
    if (f.type === 'EXPENSE' && !f.method) local.payment_method = 'Escolha o meio de pagamento.'
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
      const body = newBody(f, amount, date)
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
              setF((p) => ({ ...p, type: e.target.value as NewType, category: AUTOMATIC }))
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
        label="Valor"
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
        <Field
          id={`${id}-account`}
          label={f.type === 'INCOME' ? 'Recebido em' : 'Conta'}
          error={errors.account_id}
        >
          <select
            id={`${id}-account`}
            value={f.account}
            onChange={(e) => set('account')(e.target.value)}
            {...invalid(`${id}-account`, errors.account_id)}
            className={inputClass}
          >
            {accountOptions}
          </select>
        </Field>
      )}

      {f.type === 'EXPENSE' && (
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
