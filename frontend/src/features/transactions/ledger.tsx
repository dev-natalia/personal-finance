/** Livro-caixa: o valor com sinal e a segunda linha de cada lançamento (Lançamentos, Análise). */
import type { TransactionOut } from '../../api/types'
import { PAYMENT_METHOD_LABELS } from '../../domain/labels'
import { formatBRL } from '../../domain/money'

/** Nomes para a segunda linha do livro-caixa. */
export interface LedgerNames {
  accounts: Map<string, string>
  categories: Map<string, string>
  cards: Map<string, string>
}

/** Saídas de dinheiro (ou de limite, no cartão). */
const OUTFLOWS: TransactionOut['type'][] = ['EXPENSE', 'TRANSFER', 'INVOICE_PAYMENT', 'CHARGE']

/** Valor do livro-caixa: sem "R$", com sinal; saídas em carimbo, entradas em verde. */
export function LedgerAmount({ tx }: { tx: TransactionOut }) {
  const outflow = OUTFLOWS.includes(tx.type)
  const value = formatBRL(tx.amount).replace('R$ ', '')
  return (
    <span className={`tabular shrink-0 ${outflow ? 'text-stamp' : 'text-income'}`}>
      {outflow ? '−' : '+'}
      {value}
    </span>
  )
}

/** Segunda linha: categoria e pagamento, separados por vírgula. */
export function ledgerDetail(tx: TransactionOut, names: LedgerNames): string {
  const account = (tx.account_id && names.accounts.get(tx.account_id)) || ''
  const card = tx.card_id ? (names.cards.get(tx.card_id) ?? 'cartão') : null
  if (tx.type === 'TRANSFER') {
    const destination = tx.destination_account_id ? names.accounts.get(tx.destination_account_id) : ''
    return `Transferência, de ${account} para ${destination ?? ''}`
  }
  if (tx.type === 'INVOICE_PAYMENT') return `Pagamento de fatura, ${account}`
  const categoryName = tx.category_id ? names.categories.get(tx.category_id) : undefined
  if (tx.type === 'CHARGE') return `${categoryName ?? 'Encargos financeiros'}, ${card ?? ''}`
  const category = categoryName ?? 'A classificar'
  if (card !== null) {
    const installments = tx.installments ? ` em ${tx.installments}x` : ''
    // Parcelada que já corria antes do cartão entrar no app: só as parcelas que faltam contam aqui.
    const inProgress = tx.remaining_installments ? ', já em andamento' : ''
    return `${category}, crédito ${card}${installments}${inProgress}`
  }
  if (tx.type === 'EXPENSE' && tx.payment_method) {
    return `${category}, ${PAYMENT_METHOD_LABELS[tx.payment_method]} ${account}`
  }
  return `${category}, ${account}`
}
