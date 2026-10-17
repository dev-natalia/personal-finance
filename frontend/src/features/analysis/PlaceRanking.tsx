import { useState } from 'react'
import { Link } from 'react-router'

import type { PlaceTotalOut } from '../../api/types'
import { formatBRL } from '../../domain/money'
import { ledgerRowClass, secondaryButtonClass } from '../../ui/styles'

const VISIBLE = 5

interface Props {
  places: PlaceTotalOut[]
  /** Busca levada à tela do lugar (só o modo), já pronta: "?mode=purchase" ou "". */
  search: string
  /** Busca da análise, para o "‹ Análise" da tela do lugar voltar à mesma vista. */
  from: string
}

/** "Onde você mais gastou": lugares do maior para o menor, com barra proporcional. */
export function PlaceRanking({ places, search, from }: Props) {
  const [expanded, setExpanded] = useState(false)
  // Number() só para o comprimento das barras.
  const largest = Math.max(...places.map((p) => Number(p.amount)), 0)
  const shown = expanded ? places : places.slice(0, VISIBLE)

  return (
    <section aria-labelledby="ranking-title" className="mt-6">
      <h2 id="ranking-title" className="mb-1 text-lg font-[650]">
        Onde você mais gastou
      </h2>
      <ul aria-label="Onde você mais gastou">
        {shown.map((place) => (
          <li key={place.key} className={`${ledgerRowClass} flex-col gap-1`}>
            <div className="flex w-full items-baseline justify-between gap-3">
              <Link
                to={`/analise/lugar/${encodeURIComponent(place.key)}${search}`}
                state={{ from }}
                className="min-w-0 truncate text-pen underline-offset-2 hover:underline"
              >
                {place.name}
              </Link>
              <span className="tabular shrink-0">{formatBRL(place.amount)}</span>
            </div>
            <div aria-hidden="true" className="h-1.5 w-full rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-pen"
                style={{
                  width: `${largest > 0 ? (Math.max(Number(place.amount), 0) / largest) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="text-[13px] text-ink-soft">
              {/* Lugar só com estorno no período: fica negativo e sem compras. */}
              {place.purchases === 0
                ? 'Estorno'
                : `${place.purchases} ${place.purchases === 1 ? 'compra' : 'compras'}`}
              {place.category_name ? ` · ${place.category_name}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {!expanded && places.length > VISIBLE && (
        <button type="button" onClick={() => setExpanded(true)} className={`${secondaryButtonClass} mt-3`}>
          Ver todos os {places.length} lugares
        </button>
      )}
    </section>
  )
}
