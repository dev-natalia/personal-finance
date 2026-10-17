import { useId } from 'react'
import { Link } from 'react-router'

import { useCardsSummary } from '../../api/queries'
import { formatBRL } from '../../domain/money'
import { type Announce, useInPlace } from '../../ui/focus'
import { ledgerRowClass, secondaryButtonClass } from '../../ui/styles'
import { NewCardForm } from './NewCardForm'

/** Seção "Cartões" da tela Contas e cartões: fatura aberta e limite de cada um, e o cadastro. */
export function CardsSection({ onMessage }: { onMessage: Announce }) {
  const id = useId()
  const summary = useCardsSummary()
  const adding = useInPlace()
  const cards = summary.data ?? []

  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="mb-1 text-lg font-[650]">
        Cartões
      </h2>
      {summary.isSuccess && cards.length === 0 && !adding.open && (
        <p className="py-2 text-ink-soft">
          Nenhum cartão ainda. Adicione o seu para ver a fatura e o limite a cada compra.
        </p>
      )}
      <ul aria-label="Seus cartões" className="mb-4">
        {cards.map(({ card, open_invoice: open, limit }) => (
          <li key={card.id} className={ledgerRowClass}>
            <Link to={`/cartoes/${card.id}`} className="min-h-11 text-pen underline-offset-2 hover:underline">
              {card.name}
            </Link>
            <div className="text-right">
              <p className="tabular">Fatura aberta {formatBRL(open.total)}</p>
              <p className="tabular text-[13px] text-ink-soft">
                Limite disponível {formatBRL(limit.available)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {adding.open ? (
        <NewCardForm
          onCreated={(name) => {
            adding.close()
            onMessage(`Cartão ${name} criado.`)
          }}
          onCancel={() => adding.close()}
        />
      ) : (
        <button
          ref={adding.buttonRef}
          type="button"
          onClick={adding.show}
          className={secondaryButtonClass}
        >
          Adicionar cartão
        </button>
      )}
    </section>
  )
}
