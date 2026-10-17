import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'

import { useAnalysisPlace, useAnalysisPlaceTransactions, useEntryHints } from '../../api/queries'
import type { PlaceTotalsOut, TransactionOut } from '../../api/types'
import { dayLabel, monthName } from '../../domain/dates'
import { PAYMENT_METHOD_LABELS } from '../../domain/labels'
import { formatBRL } from '../../domain/money'
import { Page } from '../../ui/Page'
import {
  chipClass,
  errorTextClass,
  ledgerRowClass,
  linkClass,
  secondaryButtonClass,
} from '../../ui/styles'
import { LedgerAmount, ledgerDetail } from '../home/Timeline'
import { useLedgerNames } from './useLedgerNames'

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const purchasesText = (n: number) => `${n} ${n === 1 ? 'compra' : 'compras'}`

/** Cartão ou conta de um lançamento, no formato do filtro: "card:<id>" ou "account:<id>". */
function sourceOf(tx: TransactionOut): string | null {
  if (tx.card_id) return `card:${tx.card_id}`
  if (tx.account_id) return `account:${tx.account_id}`
  return null
}

/** `/analise/lugar/:key`: quanto foi gasto num lugar na semana, no mês e no ano, e as compras. */
export function PlacePage() {
  const { key = '' } = useParams()
  const [search] = useSearchParams()
  const location = useLocation()
  const mode = search.get('mode') === 'purchase' ? 'purchase' : 'installments'
  // Sempre todas as compras do lugar: o filtro de cartão ou conta é escolhido aqui, nos chips.
  const detail = useAnalysisPlace(key, { mode })
  const from = (location.state as { from?: unknown } | null)?.from
  const back = `/analise${typeof from === 'string' && from.startsWith('?') ? from : mode === 'purchase' ? '?mode=purchase' : ''}`
  const hints = useEntryHints()
  const today = hints.data?.today ?? ''

  if (detail.isError) {
    return (
      <Page title="Lugar">
        <p className="mb-3">Não encontramos este lugar.</p>
        <Link to="/analise" className={linkClass}>
          Voltar para a análise
        </Link>
      </Page>
    )
  }
  if (!detail.data) {
    return (
      <Page title="Lugar">
        <p className="text-ink-soft">Carregando…</p>
      </Page>
    )
  }

  const { name, category_name: category, week, month, year, average } = detail.data
  const boxes: [string, PlaceTotalsOut][] = [
    ['Esta semana', week],
    [today ? capitalize(monthName(today)) : 'Este mês', month],
    [today ? today.slice(0, 4) : 'Este ano', year],
  ]
  return (
    <Page title={name}>
      <Link to={back} className={`${linkClass} -mt-3 mb-2 inline-block text-sm`}>
        ‹ Análise
      </Link>
      {category && <p className="text-ink-soft">{category}</p>}
      <ul aria-label="Totais do lugar" className="mt-3 grid grid-cols-3 gap-2">
        {boxes.map(([label, totals]) => (
          <li key={label} className="rounded-lg border border-rule bg-slip p-2">
            <p className="text-[12px] text-ink-soft">{label}</p>
            <p className="tabular font-[650]">{formatBRL(totals.amount)}</p>
            <p className="text-[12px] text-ink-soft">{purchasesText(totals.purchases)}</p>
          </li>
        ))}
      </ul>
      {average && <p className="mt-2 text-sm">Média por compra: {formatBRL(average)}</p>}
      <Purchases placeKey={key} today={today} />
    </Page>
  )
}

function Purchases({ placeKey, today }: { placeKey: string; today: string }) {
  const [source, setSource] = useState<string | null>(null)
  const list = useAnalysisPlaceTransactions(placeKey, source ?? undefined)
  const names = useLedgerNames()
  const items = (list.data?.pages ?? []).flatMap((page) => page.items)
  // Os chips são os cartões e contas que já apareceram nas compras (não somem ao filtrar).
  const [known, setKnown] = useState<string[]>([])
  useEffect(() => {
    const seen = items.map(sourceOf).filter((s): s is string => s !== null)
    setKnown((current) => {
      const merged = [...new Set([...current, ...seen])]
      return merged.length === current.length ? current : merged
    })
  }, [items])

  const labelOf = (value: string) => {
    const [kind, id = ''] = value.split(':')
    return kind === 'card'
      ? `${PAYMENT_METHOD_LABELS.CREDIT} ${names.cards.get(id) ?? 'cartão'}`
      : (names.accounts.get(id) ?? 'conta')
  }
  const days = new Map<string, TransactionOut[]>()
  for (const tx of items) days.set(tx.occurred_on, [...(days.get(tx.occurred_on) ?? []), tx])

  return (
    <section aria-labelledby="purchases-title" className="mt-6">
      <h2 id="purchases-title" className="mb-2 text-lg font-[650]">
        Compras
      </h2>
      {known.length > 1 && (
        <div role="group" aria-label="Cartão ou conta" className="mb-2 flex flex-wrap gap-2">
          <button type="button" aria-pressed={source === null} onClick={() => setSource(null)} className={chipClass}>
            Todas
          </button>
          {known.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={source === value}
              onClick={() => setSource(value)}
              className={chipClass}
            >
              {labelOf(value)}
            </button>
          ))}
        </div>
      )}
      {list.isError && <p className={errorTextClass}>Não foi possível carregar as compras.</p>}
      {[...days.entries()].map(([day, txs]) => (
        <div key={day}>
          <h3 className="mt-3 mb-1 text-[13px] font-semibold text-ink-soft">
            {today ? dayLabel(day, today) : day}
          </h3>
          <ul>
            {txs.map((tx) => (
              <li key={tx.id} className={ledgerRowClass}>
                <div className="min-w-0">
                  <p className="truncate">{tx.description}</p>
                  <p className="text-[13px] text-ink-soft">{ledgerDetail(tx, names)}</p>
                </div>
                <LedgerAmount tx={tx} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className={`${secondaryButtonClass} mt-4`}
        >
          Carregar mais
        </button>
      )}
    </section>
  )
}
