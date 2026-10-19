import { useAccounts, useCards } from '../../api/queries'
import { PAYMENT_METHOD_LABELS } from '../../domain/labels'
import { Field } from '../../ui/Field'
import { inputClass } from '../../ui/styles'

export type SourceKind = 'account' | 'card'

interface Props {
  id: string
  /** "account:<id>", "card:<id>" ou "" (todos). */
  value: string
  onChange: (value: string) => void
  /** Quais aparecem; sem isto, todos (arquivados inclusive, marcados como tal). */
  include?: (kind: SourceKind, item: { id: string; archived_at: string | null }) => boolean
  className?: string
}

/** "Conta ou cartão": contas e cartões num campo só (um ou outro), como Lançamentos e Análise usam. */
export function SourceSelect({ id, value, onChange, include = () => true, className = '' }: Props) {
  const accounts = useAccounts(true)
  const cards = useCards(true)
  return (
    <Field id={id} label="Conta ou cartão">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} ${className}`}
      >
        <option value="">Todos</option>
        <optgroup label="Contas">
          {(accounts.data ?? [])
            .filter((a) => include('account', a))
            .map((a) => (
              <option key={a.id} value={`account:${a.id}`}>
                {a.archived_at ? `${a.name} (arquivada)` : a.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Cartões">
          {(cards.data ?? [])
            .filter((c) => include('card', c))
            .map((c) => (
              <option key={c.id} value={`card:${c.id}`}>
                {PAYMENT_METHOD_LABELS.CREDIT} {c.name}
                {c.archived_at ? ' (arquivado)' : ''}
              </option>
            ))}
        </optgroup>
      </select>
    </Field>
  )
}

/** "account:<id>" → { account_id }; "card:<id>" → { card_id }; outro valor → nada. */
export function sourceParams(source: string): { account_id?: string; card_id?: string } {
  const [kind, id] = source.split(':')
  if (!id) return {}
  if (kind === 'account') return { account_id: id }
  if (kind === 'card') return { card_id: id }
  return {}
}
