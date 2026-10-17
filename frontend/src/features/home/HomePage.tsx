import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useEntryHints } from '../../api/queries'
import { type ParsedItem, batchHeader, parseEntry } from '../../domain/parser'
import { OfflineBanner } from '../../ui/OfflineBanner'
import { useOnlineStatus } from '../../ui/useOnlineStatus'
import { ConfirmationCard } from '../entry/ConfirmationCard'
import type { SavedEntry } from '../entry/describe'
import { BalanceHeader } from './BalanceHeader'
import { Composer } from './Composer'
import { loadDraft, saveDraft } from './draft'
import { Timeline } from './Timeline'

interface OpenCard {
  id: number
  parsed: ParsedItem[]
  /** A frase como foi digitada. */
  text: string
  today: string
}

/** Texto dos itens ainda não gravados: a frase inteira se nada gravou; senão, só os que faltam. */
function remainingText(card: OpenCard, unsaved: number[]): string {
  if (unsaved.length === 0) return ''
  if (unsaved.length === card.parsed.length) return card.text
  const items = unsaved.map((index) => card.parsed[index]!.raw).join('; ')
  const header = batchHeader(card.text, card.today)
  return header ? `${header} ${items}` : items
}

/** Tela inicial em formato de conversa: livro-caixa em cima, campo de texto embaixo. */
export function HomePage() {
  const hints = useEntryHints()
  const online = useOnlineStatus()
  const [card, setCard] = useState<OpenCard | null>(null)
  const [text, setText] = useState(loadDraft)
  // Texto do comprovante aberto que ainda não foi gravado. O rascunho guardado é ele mais o
  // campo: se a sessão expirar ou a página recarregar, nada que não foi gravado se perde.
  const pendingCard = useRef('')
  const textRef = useRef(text)
  const location = useLocation()
  // O formulário completo volta para cá com a frase do que foi gravado.
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [entries, setEntries] = useState<SavedEntry[]>(() => {
    const saved = (location.state as { saved?: SavedEntry } | null)?.saved
    return saved ? [saved] : []
  })
  const navigate = useNavigate()
  const hasState = location.state !== null
  // Limpa o estado do histórico para a frase não reaparecer ao recarregar a página.
  useEffect(() => {
    if (hasState) navigate('.', { replace: true, state: null })
  }, [hasState, navigate])

  function persist(composer: string) {
    textRef.current = composer
    saveDraft([pendingCard.current, composer].filter(Boolean).join('\n'))
  }

  function changeText(value: string) {
    setText(value)
    persist(value)
  }

  function submit(value: string) {
    if (!hints.data) return
    const parsed = parseEntry(value, {
      today: hints.data.today,
      accounts: hints.data.accounts,
      cards: hints.data.cards,
    })
    if (parsed.length === 0) return
    setCard({ id: Date.now(), parsed, text: value, today: hints.data.today })
    pendingCard.current = value
    changeText('')
  }

  function settle(open: OpenCard, unsaved: number[]) {
    pendingCard.current = remainingText(open, unsaved)
    persist(textRef.current)
  }

  const names = {
    accounts: new Map((hints.data?.accounts ?? []).map((a) => [a.id, a.name])),
    cards: new Map((hints.data?.cards ?? []).map((c) => [c.id, c.name])),
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col px-4 md:min-h-dvh">
      <h1 className="sr-only">Início</h1>
      <BalanceHeader />
      <div className="flex-1">
        {hints.data && (
          <Timeline today={hints.data.today} names={names} sessionEntries={entries} />
        )}
      </div>
      {card && hints.data && (
        <ConfirmationCard
          key={card.id}
          parsed={card.parsed}
          hints={hints.data}
          onSaved={(saved, unsaved) => {
            settle(card, unsaved)
            setEntries((previous) => [...previous, ...saved])
          }}
          onClose={(unsaved) => {
            // O que não foi gravado volta para o campo, antes do que já estava digitado.
            const rest = remainingText(card, unsaved)
            pendingCard.current = ''
            setCard(null)
            changeText([rest, textRef.current].filter(Boolean).join('\n'))
            // Sem isto o foco cairia no <body> quando o comprovante some.
            composerRef.current?.focus()
          }}
        />
      )}
      {!online && <OfflineBanner />}
      <div className="sticky bottom-16 bg-paper pt-2 md:bottom-0">
        <Composer
          value={text}
          onChange={changeText}
          onSubmit={submit}
          disabled={!hints.data || card !== null}
          inputRef={composerRef}
        />
      </div>
    </div>
  )
}
