import { Link } from 'react-router'

import { api } from '../../api/endpoints'
import { useCards, useCardsSummary, useInvalidateLedger } from '../../api/queries'
import type { CardSummaryOut } from '../../api/types'
import { monthName, shortDate } from '../../domain/dates'
import { formatBRL, isPositive } from '../../domain/money'
import { type Announce, useMessageFromNavigation, useStatus } from '../../ui/focus'
import { Page } from '../../ui/Page'
import { primaryButtonClass } from '../../ui/styles'
import { ArchivedList, ArchivedSection } from '../accounts/ArchivedList'

/** `/cartoes`: um bloco por cartão (fatura, datas, limite) e o acesso ao cadastro. */
export function CardsPage() {
  const summary = useCardsSummary()
  const { announce, status } = useStatus()
  useMessageFromNavigation(announce)
  const cards = summary.data ?? []

  return (
    <Page title="Cartões">
      <div className="-mt-2 mb-4 flex justify-end">
        <Link to="/cartoes/novo" className={`${primaryButtonClass} px-4 text-sm`}>
          + Adicionar cartão
        </Link>
      </div>
      {status}
      {summary.isSuccess && cards.length === 0 && (
        <p className="py-2 text-ink-soft">
          Nenhum cartão ainda. Adicione o seu para ver a fatura e o limite a cada compra.
        </p>
      )}
      <ul aria-label="Seus cartões" className="mb-6 flex flex-col gap-3">
        {cards.map((item) => (
          <CardBlock key={item.card.id} summary={item} />
        ))}
      </ul>
      <ArchivedSection title="Cartões arquivados">
        <ArchivedCards onMessage={announce} />
      </ArchivedSection>
    </Page>
  )
}

function CardBlock({ summary }: { summary: CardSummaryOut }) {
  const { card, open_invoice: open, payable, limit } = summary
  const used = Number(limit.used)
  const total = Number(limit.limit)
  const share = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0
  return (
    // O bloco inteiro abre o cartão: o link do nome se estende sobre ele (after:inset-0).
    <li className="relative rounded-xl border border-rule bg-slip p-4 shadow-[0_2px_8px_rgba(27,35,64,0.06)]">
      <Link
        to={`/cartoes/${card.id}`}
        className="mb-2 flex items-center justify-between text-lg font-[650] after:absolute after:inset-0 after:rounded-xl"
      >
        {card.name}
        <span aria-hidden="true" className="text-ink-soft">
          ›
        </span>
      </Link>
      <p className="flex justify-between gap-3 text-sm text-ink-soft">
        <span>Fatura de {monthName(open.reference_month)} (aberta)</span>
        <span className="tabular shrink-0 font-semibold whitespace-nowrap text-ink">{formatBRL(open.total)}</span>
      </p>
      <p className="text-sm text-ink-soft">
        Fecha {shortDate(open.closing_date)} · vence {shortDate(open.due_date)}
      </p>
      {payable && isPositive(payable.balance) && (
        <p className="mt-1 flex justify-between gap-3 text-sm text-stamp">
          <span>Fatura de {monthName(payable.reference_month)}: falta pagar</span>
          <span className="tabular shrink-0 font-semibold whitespace-nowrap">
            {formatBRL(payable.balance)} · vence {shortDate(payable.due_date)}
          </span>
        </p>
      )}
      <div
        role="img"
        aria-label={`Limite usado: ${formatBRL(limit.used)} de ${formatBRL(limit.limit)}`}
        className="mt-3 mb-1 h-1.5 overflow-hidden rounded-full bg-rule"
      >
        <div className="h-full bg-pen" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="flex justify-between gap-3 text-sm text-ink-soft">
        <span>Limite livre</span>
        <span className="tabular shrink-0 font-semibold whitespace-nowrap text-ink">
          {formatBRL(limit.available)} de {formatBRL(limit.limit)}
        </span>
      </p>
    </li>
  )
}

function ArchivedCards({ onMessage }: { onMessage: Announce }) {
  const all = useCards(true)
  const invalidate = useInvalidateLedger()
  const items = all.data
    ?.filter((c) => c.archived_at !== null)
    .map((c) => ({ id: c.id, name: c.name }))
  return (
    <ArchivedList
      label="Cartões arquivados"
      items={items}
      emptyText="Nenhum cartão arquivado."
      onUnarchive={async (item) => {
        await api.unarchiveCard(item.id)
        onMessage(`Cartão ${item.name} desarquivado.`, { focus: true })
        await invalidate()
      }}
    />
  )
}
