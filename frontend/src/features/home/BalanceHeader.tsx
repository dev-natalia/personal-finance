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
      {/* Fatura e limite não são saldo: ficam abaixo, separados, e levam à tela do cartão. */}
      {(cards.data ?? []).length > 0 && (
        <ul aria-label="Cartões" className="mt-3 border-t border-rule pt-1">
          {(cards.data ?? []).flatMap(({ card, open_invoice: open, limit }) => [
            ['Fatura aberta', open.total, 'invoice'],
            ['Limite livre', limit.available, 'limit'],
          ].map(([label, amount, kind]) => (
            <li key={`${card.id}-${kind}`}>
              <Link
                to={`/cartoes/${card.id}`}
                className="flex min-h-10 items-center justify-between gap-3 text-sm hover:text-pen"
              >
                <span className="text-ink-soft">
                  {label} {card.name}
                </span>{' '}
                <span className="tabular">{formatBRL(amount!)}</span>
              </Link>
            </li>
          )))}
        </ul>
      )}
    </header>
  )
}
