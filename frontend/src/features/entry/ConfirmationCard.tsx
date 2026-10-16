import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useCategories, useInvalidateLedger } from '../../api/queries'
import type { EntryHintsOut } from '../../api/types'
import type { ParsedItem } from '../../domain/parser'
import { primaryButtonClass, secondaryButtonClass, slipClass } from '../../ui/styles'
import {
  type CardItem,
  amountOf,
  canConfirm,
  cardReducer,
  initCard,
  prepareSend,
} from './cardState'
import { type Names, type SavedEntry, describeSaved } from './describe'
import { ItemEditor } from './ItemEditor'

interface Props {
  parsed: ParsedItem[]
  hints: EntryHintsOut
  /** `unsaved`: índices dos itens ainda não gravados (a tela guarda o texto deles). */
  onSaved: (entries: SavedEntry[], unsaved: number[]) => void
  /** Ao fechar; `unsaved` volta para o campo (vazio quando tudo o que foi incluído gravou). */
  onClose: (unsaved: number[]) => void
}

function unsavedOf(items: CardItem[], savedNow: Set<number>): number[] {
  return items.flatMap((item, index) =>
    item.status === 'saved' || savedNow.has(index) ? [] : [index],
  )
}

/** Comprovante de confirmação: nada é gravado sem o toque em "Confirmar". */
export function ConfirmationCard({ parsed, hints, onSaved, onClose }: Props) {
  const [items, dispatch] = useReducer(cardReducer, parsed, initCard)
  const [busy, setBusy] = useState(false)
  const categories = useCategories()
  const invalidateLedger = useInvalidateLedger()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const names: Names = useMemo(
    () => ({
      accounts: new Map(hints.accounts.map((a) => [a.id, a.name])),
      categories: new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    }),
    [hints.accounts, categories.data],
  )

  useEffect(() => headingRef.current?.focus(), [])

  // Aviso de possível duplicata, consultado uma vez ao abrir (não bloqueia nada se falhar).
  useEffect(() => {
    let active = true
    const checks = items
      .map((item, index) => ({ item, index, amount: amountOf(item) }))
      .filter((c) => c.amount !== null && c.item.description.trim() !== '')
    if (checks.length === 0) return
    api
      .entryChecks(
        checks.map((c) => ({
          amount: c.amount!,
          merchant: c.item.description.trim(),
          occurred_on: c.item.occurredOn,
        })),
      )
      .then((result) => {
        if (!active) return
        for (const r of result.results) {
          const target = checks[r.index]
          if (target && r.possible_duplicates.length > 0) {
            dispatch({ type: 'duplicates', index: target.index, count: r.possible_duplicates.length })
          }
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, []) // só ao abrir o comprovante

  async function confirm() {
    if (busy) return
    setBusy(true)
    const saved: SavedEntry[] = []
    const savedNow = new Set<number>()
    let failures = 0
    // Em sequência, só os incluídos e ainda não gravados, cada um com a sua chave.
    for (const [index, item] of items.entries()) {
      if (!item.included || item.status === 'saved') continue
      const { body, key, sentBody } = prepareSend(item)
      dispatch({ type: 'sending', index, key, sentBody })
      try {
        const result = await api.createTransaction(body, key)
        const entry = {
          line: describeSaved(result.transaction, names),
          warnings: (result.warnings ?? []).map((w) => w.detail),
        }
        dispatch({ type: 'saved', index, ...entry })
        saved.push(entry)
        savedNow.add(index)
      } catch (error) {
        failures += 1
        const message = error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
        dispatch({ type: 'failed', index, message })
      }
    }
    setBusy(false)
    const unsaved = unsavedOf(items, savedNow)
    if (saved.length > 0) {
      // Primeiro o rascunho (mesmo que a sessão expire no meio), depois o recarregamento.
      onSaved(saved, unsaved)
      await invalidateLedger()
    }
    // Tudo o que foi incluído gravou: os itens desmarcados foram descartados de propósito.
    if (failures === 0) onClose([])
  }

  function cancel() {
    onClose(unsavedOf(items, new Set()))
  }

  const title = items.length > 1 ? 'Confirmar lançamentos' : 'Confirmar lançamento'
  const hasErrors = items.some((item) => item.status === 'error')

  return (
    <section
      aria-labelledby="confirmation-title"
      // Esc fecha o comprovante (como Cancelar), exceto durante o envio.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault()
          cancel()
        }
      }}
      className={`${slipClass} mx-1 my-3`}
    >
      <h2
        id="confirmation-title"
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 text-base font-[650] outline-none"
      >
        {title}
      </h2>
      <div className="divide-y divide-dashed divide-ink-soft/40">
        {items.map((item, index) => (
          <ItemEditor
            key={item.id}
            item={item}
            index={index}
            total={items.length}
            hints={hints}
            categories={categories.data ?? []}
            dispatch={dispatch}
            locked={busy}
          />
        ))}
      </div>
      <p aria-live="polite" className="sr-only">
        {busy ? 'Enviando…' : ''}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={confirm}
          // Durante o envio o botão só ignora toques: desabilitá-lo tiraria o foco dele.
          disabled={!busy && !canConfirm(items)}
          aria-disabled={busy || undefined}
          className={`${primaryButtonClass} flex-1`}
        >
          {hasErrors ? 'Tentar de novo' : 'Confirmar'}
        </button>
        <button type="button" onClick={cancel} disabled={busy} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </section>
  )
}
