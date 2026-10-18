/**
 * Frases não entendidas: o que o interpretador deixou pendente ou a usuária teve de corrigir.
 * Ficam guardadas para decidir, com uso real, se a IA faz falta. A categoria nunca conta:
 * ela vem da memória de estabelecimentos, e escolhê-la é uso normal.
 */
import { api } from '../../api/endpoints'
import type { MisreadReason } from '../../api/types'
import type { ParsedItem, PendingField } from '../../domain/parser'
import { type CardItem, amountOf } from './cardState'

const PENDING: Record<PendingField, MisreadReason> = {
  amount: 'PENDING_AMOUNT',
  description: 'PENDING_DESCRIPTION',
  account: 'PENDING_ACCOUNT',
  paymentMethod: 'PENDING_PAYMENT_METHOD',
}

/** Comparações campo a campo; valor e descrição comparados como seriam enviados. */
const CHANGES: [MisreadReason, (item: CardItem) => unknown][] = [
  ['CHANGED_TYPE', (item) => item.type],
  ['CHANGED_AMOUNT', (item) => amountOf(item) ?? item.amountText.trim()],
  ['CHANGED_DESCRIPTION', (item) => item.description.trim()],
  ['CHANGED_DATE', (item) => item.occurredOn],
  ['CHANGED_SOURCE', (item) => `${item.accountId}|${item.cardId}`],
  ['CHANGED_PAYMENT_METHOD', (item) => item.paymentMethod],
  ['CHANGED_INSTALLMENTS', (item) => item.installments],
]

function sorted(reasons: Set<MisreadReason>): MisreadReason[] {
  return [...reasons].sort()
}

export function pendingReasons(parsed: ParsedItem[]): MisreadReason[] {
  return sorted(new Set(parsed.flatMap((item) => item.pending.map((field) => PENDING[field]))))
}

/** O que mudou entre o comprovante como abriu (`initial`) e como foi confirmado (`final`). */
export function changeReasons(initial: CardItem[], final: CardItem[]): MisreadReason[] {
  const reasons = new Set<MisreadReason>()
  initial.forEach((before, index) => {
    const after = final[index]
    if (!after) return
    for (const [reason, value] of CHANGES) {
      if (value(before) !== value(after)) reasons.add(reason)
    }
    if (before.included && !after.included) reasons.add('UNCHECKED_ITEM')
  })
  return sorted(reasons)
}

/** Dispara e esquece: uma falha aqui nunca atrapalha o registro do gasto. */
export function recordMisread(text: string, reasons: MisreadReason[]): void {
  const phrase = text.trim()
  if (phrase === '' || reasons.length === 0) return
  api.recordMisread({ text: phrase.slice(0, 500), reasons }).catch(() => undefined)
}
