import { type Dispatch, useId } from 'react'

import { useMerchantSuggestion } from '../../api/queries'
import type { CategoryOut, EntryHintsOut } from '../../api/types'
import { PAYMENT_METHOD_LABELS } from '../../domain/labels'
import type { PaymentMethod, PendingField } from '../../domain/parser'
import { chipClass, errorTextClass, inputClass } from '../../ui/styles'
import { type CardAction, type CardItem, type EditableFields, missingFields } from './cardState'

const PENDING_LABELS: Record<PendingField, string> = {
  amount: 'valor',
  description: 'descrição',
  account: 'conta',
  paymentMethod: 'meio de pagamento',
}

const fieldRow = 'grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1'
const fieldLabel = 'text-sm text-ink-soft'
const slipInput = `${inputClass} slip-mono tabular min-h-10 py-1`

interface Props {
  item: CardItem
  index: number
  total: number
  hints: EntryHintsOut
  categories: CategoryOut[]
  dispatch: Dispatch<CardAction>
}

/** Campos editáveis de um item do comprovante. */
export function ItemEditor({ item, index, total, hints, categories, dispatch }: Props) {
  const id = useId()
  const suggestion = useMerchantSuggestion(item.description)
  const edit: Edit = (patch) => dispatch({ type: 'edit', index, patch })

  if (item.status === 'saved') {
    return (
      <div className="py-2">
        <p>{item.savedLine}</p>
        {item.warnings.map((warning) => (
          <p key={warning} className={errorTextClass}>
            {warning}
          </p>
        ))}
      </div>
    )
  }

  const kind = item.type === 'EXPENSE' ? 'EXPENSE' : 'INCOME'
  const options = categories.filter((c) => c.kind === kind && c.archived_at === null)
  const unclassified = options.find((c) => c.is_system && c.name === 'A classificar')
  const categoryValue = item.categoryId ?? suggestion.data ?? unclassified?.id ?? ''
  const missing = missingFields(item)
  const isRetro = item.occurredOn !== hints.today
  const disabled = item.status === 'sending'

  return (
    <fieldset disabled={disabled} className="py-1">
      <legend className="sr-only">Lançamento {index + 1}</legend>
      {total > 1 && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={item.included}
            onChange={() => dispatch({ type: 'toggle', index })}
            className="size-5 accent-pen"
          />
          Incluir este lançamento
        </label>
      )}

      <div className={fieldRow}>
        <label htmlFor={`${id}-amount`} className={fieldLabel}>
          Valor
        </label>
        <input
          id={`${id}-amount`}
          inputMode="decimal"
          value={item.amountText}
          onChange={(e) => edit({ amountText: e.target.value })}
          aria-invalid={missing.includes('amount')}
          className={`${slipInput} text-lg font-[650]`}
        />
      </div>
      <div className={fieldRow}>
        <label htmlFor={`${id}-description`} className={fieldLabel}>
          Descrição
        </label>
        <input
          id={`${id}-description`}
          value={item.description}
          onChange={(e) => edit({ description: e.target.value })}
          aria-invalid={missing.includes('description')}
          className={slipInput}
        />
      </div>
      <div className={fieldRow}>
        <label htmlFor={`${id}-date`} className={fieldLabel}>
          Data
        </label>
        <input
          id={`${id}-date`}
          type="date"
          value={item.occurredOn}
          onChange={(e) => edit({ occurredOn: e.target.value })}
          className={isRetro ? slipInput.replace('bg-slip', 'bg-highlight') : slipInput}
        />
      </div>
      <div className={fieldRow}>
        <label htmlFor={`${id}-category`} className={fieldLabel}>
          Categoria
        </label>
        <select
          id={`${id}-category`}
          value={categoryValue}
          onChange={(e) => edit({ categoryId: e.target.value })}
          className={slipInput}
        >
          {options.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="my-3 border-t border-dashed border-ink-soft/50" />

      {item.type === 'EXPENSE' ? (
        <PaymentFields item={item} hints={hints} id={id} edit={edit} />
      ) : (
        <div className={fieldRow}>
          <label htmlFor={`${id}-account`} className={fieldLabel}>
            Recebido em
          </label>
          <AccountSelect id={`${id}-account`} item={item} hints={hints} edit={edit} />
        </div>
      )}

      {item.duplicates > 0 && (
        <p role="status" className="mt-2 text-sm">
          Possível duplicata: já existe um lançamento igual em ±2 dias.
        </p>
      )}
      {item.error && (
        <p role="alert" className={`mt-2 ${errorTextClass}`}>
          {item.error}
        </p>
      )}
      {item.included && missing.length > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          Falta: {missing.map((field) => PENDING_LABELS[field]).join(', ')}.
        </p>
      )}
    </fieldset>
  )
}

type Edit = (patch: Partial<EditableFields>) => void

function PaymentFields({
  item,
  hints,
  id,
  edit,
}: {
  item: CardItem
  hints: EntryHintsOut
  id: string
  edit: Edit
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm">Como você pagou?</legend>
      <div className="mb-2 flex flex-wrap gap-2">
        {hints.top_payment_options.map((option) => {
          const pressed =
            item.accountId === option.account_id && item.paymentMethod === option.payment_method
          return (
            <button
              key={`${option.account_id}-${option.payment_method}`}
              type="button"
              aria-pressed={pressed}
              onClick={() =>
                edit({ accountId: option.account_id, paymentMethod: option.payment_method })
              }
              className={chipClass}
            >
              {PAYMENT_METHOD_LABELS[option.payment_method]} {option.account_name}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          Conta
          <AccountSelect id={`${id}-account`} item={item} hints={hints} edit={edit} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-soft">
          Meio
          <select
            value={item.paymentMethod ?? ''}
            onChange={(e) => edit({ paymentMethod: (e.target.value || null) as PaymentMethod | null })}
            className={slipInput}
          >
            <option value="">Escolha</option>
            {hints.payment_methods.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  )
}

function AccountSelect({
  id,
  item,
  hints,
  edit,
}: {
  id: string
  item: CardItem
  hints: EntryHintsOut
  edit: Edit
}) {
  return (
    <select
      id={id}
      value={item.accountId ?? ''}
      onChange={(e) => edit({ accountId: e.target.value || null })}
      className={slipInput}
    >
      <option value="">Escolha</option>
      {hints.accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </select>
  )
}
