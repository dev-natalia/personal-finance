import { Link } from 'react-router'

import { useBalances, useCardsSummary } from '../../api/queries'
import { formatBRL } from '../../domain/money'

/** O saldo é o maior texto da tela: é a primeira coisa que importa ao abrir o app. */
export function BalanceHeader() {
  const balances = useBalances()
  const cards = useCardsSummary()
  return (
    <header className="pt-6 pb-3">
      <p className="text-sm text-ink-soft">Saldo em contas</p>
      <p className="tabular text-[34px] leading-tight font-[650] tracking-tight">
        {balances.data ? formatBRL(balances.data.total) : '…'}
      </p>
      {/* Fatura não é saldo: fica abaixo, separada, e leva à tela do cartão. */}
      {(cards.data ?? []).length > 0 && (
        <ul aria-label="Faturas abertas" className="mt-3 border-t border-rule pt-1">
          {(cards.data ?? []).map(({ card, open_invoice: open }) => (
            <li key={card.id}>
              <Link
                to={`/cartoes/${card.id}`}
                className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-pen"
              >
                <span className="text-ink-soft">Fatura aberta {card.name}</span>{' '}
                <span className="tabular">{formatBRL(open.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </header>
  )
}
