import { useCategories, useRecentTransactions } from '../../api/queries'
import type { TransactionOut } from '../../api/types'
import { dayLabel } from '../../domain/dates'
import { PAYMENT_METHOD_LABELS } from '../../domain/labels'
import { formatBRL } from '../../domain/money'
import { errorTextClass, ledgerRowClass } from '../../ui/styles'
import type { SavedEntry } from '../entry/describe'

interface Props {
  today: string
  accountNames: Map<string, string>
  sessionEntries: SavedEntry[]
}

/** Valor do livro-caixa: sem "R$", com sinal; saídas em carimbo, entradas em verde. */
export function LedgerAmount({ tx }: { tx: TransactionOut }) {
  const outflow = tx.type === 'EXPENSE' || tx.type === 'TRANSFER'
  const value = formatBRL(tx.amount).replace('R$ ', '')
  return (
    <span className={`tabular shrink-0 ${outflow ? 'text-stamp' : 'text-income'}`}>
      {outflow ? '−' : '+'}
      {value}
    </span>
  )
}

/** Segunda linha: categoria e pagamento, separados por vírgula. */
export function ledgerDetail(
  tx: TransactionOut,
  accountNames: Map<string, string>,
  categoryNames: Map<string, string>,
): string {
  const account = accountNames.get(tx.account_id) ?? ''
  if (tx.type === 'TRANSFER') {
    const destination = tx.destination_account_id ? accountNames.get(tx.destination_account_id) : ''
    return `Transferência, de ${account} para ${destination ?? ''}`
  }
  const category = (tx.category_id && categoryNames.get(tx.category_id)) || 'A classificar'
  if (tx.type === 'EXPENSE' && tx.payment_method) {
    return `${category}, ${PAYMENT_METHOD_LABELS[tx.payment_method]} ${account}`
  }
  return `${category}, ${account}`
}

/** Livro-caixa dos lançamentos recentes, do mais antigo ao mais novo (o novo fica perto do campo). */
export function Timeline({ today, accountNames, sessionEntries }: Props) {
  const recent = useRecentTransactions()
  const categories = useCategories()
  const categoryNames = new Map((categories.data ?? []).map((c) => [c.id, c.name]))

  const items = [...(recent.data?.items ?? [])].reverse()
  const days = new Map<string, TransactionOut[]>()
  for (const tx of items) days.set(tx.occurred_on, [...(days.get(tx.occurred_on) ?? []), tx])

  return (
    <section aria-label="Lançamentos recentes" className="pb-2">
      {recent.isSuccess && items.length === 0 && (
        <p className="py-6 text-ink-soft">
          Anote seu primeiro gasto. Digite algo como “42 mercado pix itaú”.
        </p>
      )}
      {[...days.entries()].map(([day, list]) => (
        <div key={day}>
          <h2 className="mt-4 mb-1 text-[13px] font-semibold text-ink-soft">{dayLabel(day, today)}</h2>
          <ul>
            {list.map((tx) => (
              <li key={tx.id} className={ledgerRowClass}>
                <div className="min-w-0">
                  <p className="truncate">{tx.description}</p>
                  <p className="text-[13px] text-ink-soft">
                    {ledgerDetail(tx, accountNames, categoryNames)}
                  </p>
                </div>
                <LedgerAmount tx={tx} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {/* A região fica sempre na página: leitores de tela ignoram uma que nasce já com texto. */}
      <div aria-live="polite" data-testid="session-entries">
        {sessionEntries.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {sessionEntries.map((entry, index) => (
              <li key={index} className="text-sm">
                <p>{entry.line}</p>
                {entry.warnings.map((warning) => (
                  <p key={warning} className={errorTextClass}>
                    {warning}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
