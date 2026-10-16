import { useState } from 'react'

import { useEntryHints } from '../../api/queries'
import { type ParsedItem, parseEntry } from '../../domain/parser'
import { OfflineBanner } from '../../ui/OfflineBanner'
import { useOnlineStatus } from '../../ui/useOnlineStatus'
import { ConfirmationCard } from '../entry/ConfirmationCard'
import type { SavedEntry } from '../entry/describe'
import { BalanceHeader } from './BalanceHeader'
import { Composer } from './Composer'
import { Timeline } from './Timeline'

/** Tela inicial em formato de conversa: livro-caixa em cima, campo de texto embaixo. */
export function HomePage() {
  const hints = useEntryHints()
  const online = useOnlineStatus()
  const [card, setCard] = useState<{ id: number; parsed: ParsedItem[] } | null>(null)
  const [entries, setEntries] = useState<SavedEntry[]>([])

  function submit(text: string): boolean {
    if (!hints.data) return false
    const parsed = parseEntry(text, { today: hints.data.today, accounts: hints.data.accounts })
    if (parsed.length === 0) return false
    setCard({ id: Date.now(), parsed })
    return true
  }

  const accountNames = new Map((hints.data?.accounts ?? []).map((a) => [a.id, a.name]))

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col px-4 md:min-h-dvh">
      <h1 className="sr-only">Início</h1>
      <BalanceHeader />
      <div className="flex-1">
        {hints.data && (
          <Timeline today={hints.data.today} accountNames={accountNames} sessionEntries={entries} />
        )}
      </div>
      {card && hints.data && (
        <ConfirmationCard
          key={card.id}
          parsed={card.parsed}
          hints={hints.data}
          onSaved={(saved) => setEntries((previous) => [...previous, ...saved])}
          onClose={() => setCard(null)}
        />
      )}
      {!online && <OfflineBanner />}
      <div className="sticky bottom-16 bg-paper pt-2 md:bottom-0">
        <Composer onSubmit={submit} disabled={!hints.data || card !== null} />
      </div>
    </div>
  )
}
