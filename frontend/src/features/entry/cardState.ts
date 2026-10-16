/**
 * Estado do cartão de confirmação (lógica pura, sem tela).
 *
 * Regra da chave contra clique duplo, decidida na hora do envio (`prepareSend`): enviar de
 * novo o mesmo conteúdo reaproveita a chave (é a mesma tentativa); conteúdo diferente do
 * último envio gera chave nova (é outra intenção). Editar e desfazer não muda nada.
 */
import { newIdempotencyKey } from '../../api/client'
import type { ExpenseIn, IncomeIn } from '../../api/types'
import { isPositive, toInputAmount, tryParseMoney } from '../../domain/money'
import type { EntryType, ParsedItem, PaymentMethod, PendingField } from '../../domain/parser'

export type ItemStatus = 'draft' | 'sending' | 'saved' | 'error'

export interface CardItem {
  /** Identidade do item na tela; nunca muda (a chave de idempotência pode mudar). */
  id: string
  key: string
  /** Corpo do último envio (JSON), para saber se uma nova tentativa é o mesmo conteúdo. */
  sentBody: string | null
  included: boolean
  type: EntryType
  /** O que a usuária vê e edita ("42,50"). */
  amountText: string
  description: string
  occurredOn: string
  accountId: string | null
  paymentMethod: PaymentMethod | null
  /** Só quando a usuária escolheu; `null` mantém a sugestão (e não ensina a memória). */
  categoryId: string | null
  status: ItemStatus
  error: string | null
  warnings: string[]
  savedLine: string | null
  duplicates: number
}

export type EditableFields = Pick<
  CardItem,
  'amountText' | 'description' | 'occurredOn' | 'accountId' | 'paymentMethod' | 'categoryId'
>

export type CardAction =
  | { type: 'edit'; index: number; patch: Partial<EditableFields> }
  | { type: 'toggle'; index: number }
  | { type: 'duplicates'; index: number; count: number }
  | { type: 'sending'; index: number; key: string; sentBody: string }
  | { type: 'saved'; index: number; line: string; warnings: string[] }
  | { type: 'failed'; index: number; message: string }

export function initCard(parsed: ParsedItem[]): CardItem[] {
  return parsed.map((item) => ({
    id: newIdempotencyKey(),
    key: newIdempotencyKey(),
    sentBody: null,
    included: true,
    type: item.type,
    amountText: item.amount ? toInputAmount(item.amount) : '',
    description: item.description ?? '',
    occurredOn: item.occurredOn,
    accountId: item.accountId,
    paymentMethod: item.paymentMethod,
    categoryId: null,
    status: 'draft',
    error: null,
    warnings: [],
    savedLine: null,
    duplicates: 0,
  }))
}

export function cardReducer(state: CardItem[], action: CardAction): CardItem[] {
  return state.map((item, index) => (index === action.index ? apply(item, action) : item))
}

function apply(item: CardItem, action: CardAction): CardItem {
  if (item.status === 'saved' && (action.type === 'edit' || action.type === 'toggle')) return item
  switch (action.type) {
    case 'edit':
      return {
        ...item,
        ...action.patch,
        status: item.status === 'error' ? 'draft' : item.status,
        error: null,
      }
    case 'toggle':
      return { ...item, included: !item.included }
    case 'duplicates':
      return { ...item, duplicates: action.count }
    case 'sending':
      return { ...item, status: 'sending', error: null, key: action.key, sentBody: action.sentBody }
    case 'saved':
      return { ...item, status: 'saved', savedLine: action.line, warnings: action.warnings }
    case 'failed':
      return { ...item, status: 'error', error: action.message }
  }
}

/** Valor canônico positivo, ou `null` se o texto não for um valor válido maior que zero. */
export function amountOf(item: CardItem): string | null {
  const amount = tryParseMoney(item.amountText)
  return amount !== null && isPositive(amount) ? amount : null
}

export function missingFields(item: CardItem): PendingField[] {
  const missing: PendingField[] = []
  if (amountOf(item) === null) missing.push('amount')
  if (item.description.trim() === '') missing.push('description')
  if (item.accountId === null) missing.push('account')
  if (item.type === 'EXPENSE' && item.paymentMethod === null) missing.push('paymentMethod')
  return missing
}

/** Há algo incluído para gravar, nada sendo enviado e nada incompleto. */
export function canConfirm(items: CardItem[]): boolean {
  const toSend = items.filter((item) => item.included && item.status !== 'saved')
  return (
    toSend.length > 0 &&
    toSend.every((item) => item.status !== 'sending' && missingFields(item).length === 0)
  )
}

export function toRequestBody(item: CardItem): IncomeIn | ExpenseIn {
  const amount = amountOf(item)
  if (amount === null || item.accountId === null || item.description.trim() === '') {
    throw new Error('Item incompleto não pode ser enviado.')
  }
  const base = {
    amount,
    occurred_on: item.occurredOn,
    description: item.description.trim(),
    account_id: item.accountId,
    ...(item.categoryId !== null ? { category_id: item.categoryId } : {}),
  }
  if (item.type === 'INCOME') return { type: 'INCOME', ...base }
  if (item.paymentMethod === null) throw new Error('Despesa sem meio de pagamento.')
  return { type: 'EXPENSE', ...base, payment_method: item.paymentMethod }
}

/** Corpo e chave do envio: mesma chave para o mesmo conteúdo, chave nova se ele mudou. */
export function prepareSend(item: CardItem): {
  body: IncomeIn | ExpenseIn
  key: string
  sentBody: string
} {
  const body = toRequestBody(item)
  const sentBody = JSON.stringify(body)
  const key = item.sentBody === null || item.sentBody === sentBody ? item.key : newIdempotencyKey()
  return { body, key, sentBody }
}
