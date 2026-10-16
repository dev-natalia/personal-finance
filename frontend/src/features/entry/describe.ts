import type { TransactionOut } from '../../api/types'
import { PAYMENT_METHOD_LABELS } from '../../domain/labels'
import { formatBRL } from '../../domain/money'

export interface SavedEntry {
  line: string
  warnings: string[]
}

export interface Names {
  accounts: Map<string, string>
  categories: Map<string, string>
}

/** Frase de confirmação montada a partir do que o backend gravou (nunca do que foi digitado). */
export function describeSaved(tx: TransactionOut, names: Names): string {
  const amount = formatBRL(tx.amount)
  const accountName = (id: string | null) => (id && names.accounts.get(id)) || 'conta'
  if (tx.type === 'TRANSFER') {
    const from = accountName(tx.account_id)
    const to = (tx.destination_account_id && names.accounts.get(tx.destination_account_id)) || 'conta'
    return `Transferência registrada: ${amount} de ${from} para ${to}.`
  }
  const category = (tx.category_id && names.categories.get(tx.category_id)) || 'A classificar'
  // "em A classificar" soa estranho: sem categoria definida, a frase diz isso.
  const where = category === 'A classificar' ? ', ainda sem categoria' : ` em ${category}`
  const account = accountName(tx.account_id)
  if (tx.type === 'INCOME') {
    return `Receita registrada: ${amount}${where}, recebida na ${account}.`
  }
  const method = tx.payment_method ? PAYMENT_METHOD_LABELS[tx.payment_method] : 'Outro'
  return `Despesa registrada: ${amount}${where}, paga com ${method} ${account}.`
}
