/**
 * Estado do cartão de confirmação (lógica pura, sem tela).
 *
 * Regra da chave contra clique duplo, decidida na hora do envio (`prepareSend`): enviar de
 * novo o mesmo conteúdo reaproveita a chave (é a mesma tentativa); conteúdo diferente do
 * último envio gera chave nova (é outra intenção). Editar e desfazer não muda nada.
 */
import { newIdempotencyKey } from '../../api/client'
import type { ExpenseIn, IncomeIn, PreviewIn } from '../../api/types'
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
  /** Compra no cartão: `accountId` nulo e meio `CREDIT`. */
  cardId: string | null
  /** Parcelas no cartão; nulo = à vista. */
  installments: number | null
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
  | 'amountText'
  | 'description'
  | 'occurredOn'
  | 'accountId'
  | 'cardId'
  | 'installments'
  | 'paymentMethod'
  | 'categoryId'
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
    cardId: item.cardId,
    installments: item.installments,
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
  if (item.type === 'EXPENSE' && item.cardId !== null) return missing
  if (item.accountId === null) missing.push('account')
  // Crédito é só do cartão: numa conta, o meio ainda falta.
  if (item.type === 'EXPENSE' && (item.paymentMethod === null || item.paymentMethod === 'CREDIT')) {
    missing.push('paymentMethod')
  }
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
  if (amount === null || item.description.trim() === '') {
    throw new Error('Item incompleto não pode ser enviado.')
  }
  const common = {
    amount,
    occurred_on: item.occurredOn,
    description: item.description.trim(),
    ...(item.categoryId !== null ? { category_id: item.categoryId } : {}),
  }
  if (item.type === 'EXPENSE' && item.cardId !== null) {
    return {
      type: 'EXPENSE',
      ...common,
      card_id: item.cardId,
      ...(item.installments !== null ? { installments: item.installments } : {}),
    }
  }
  if (item.accountId === null) throw new Error('Item incompleto não pode ser enviado.')
  const base = { ...common, account_id: item.accountId }
  if (item.type === 'INCOME') return { type: 'INCOME', ...base }
  if (item.paymentMethod === null) throw new Error('Despesa sem meio de pagamento.')
  return { type: 'EXPENSE', ...base, payment_method: item.paymentMethod }
}

/** O que pedir à prévia do cartão (impacto na fatura e no limite), ou nulo se não cabe. */
export function previewInput(item: CardItem): { cardId: string; body: PreviewIn } | null {
  const amount = amountOf(item)
  if (item.type !== 'EXPENSE' || item.cardId === null || amount === null) return null
  return {
    cardId: item.cardId,
    body: {
      amount,
      occurred_on: item.occurredOn,
      ...(item.installments !== null ? { installments: item.installments } : {}),
    },
  }
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
