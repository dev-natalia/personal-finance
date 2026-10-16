import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useCategories, useInvalidateLedger } from '../../api/queries'
import type { EntryHintsOut } from '../../api/types'
import type { ParsedItem } from '../../domain/parser'
import { primaryButtonClass, secondaryButtonClass, slipClass } from '../../ui/styles'
import { amountOf, canConfirm, cardReducer, initCard, toRequestBody } from './cardState'
import { type Names, type SavedEntry, describeSaved } from './describe'
import { ItemEditor } from './ItemEditor'

interface Props {
  parsed: ParsedItem[]
  hints: EntryHintsOut
  onSaved: (entries: SavedEntry[]) => void
  onClose: () => void
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
    setBusy(true)
    const saved: SavedEntry[] = []
    let failures = 0
    // Em sequência, só os incluídos e ainda não gravados, cada um com a sua chave.
    for (const [index, item] of items.entries()) {
      if (!item.included || item.status === 'saved') continue
      dispatch({ type: 'sending', index })
      try {
        const result = await api.createTransaction(toRequestBody(item), item.key)
        const entry = {
          line: describeSaved(result.transaction, names),
          warnings: (result.warnings ?? []).map((w) => w.detail),
        }
        dispatch({ type: 'saved', index, ...entry })
        saved.push(entry)
      } catch (error) {
        failures += 1
        const message = error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
        dispatch({ type: 'failed', index, message })
      }
    }
    setBusy(false)
    if (saved.length > 0) {
      await invalidateLedger()
      onSaved(saved)
    }
    if (failures === 0) onClose()
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
          onClose()
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
            key={item.key}
            item={item}
            index={index}
            total={items.length}
            hints={hints}
            categories={categories.data ?? []}
            dispatch={dispatch}
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
          disabled={busy || !canConfirm(items)}
          className={`${primaryButtonClass} flex-1`}
        >
          {hasErrors ? 'Tentar de novo' : 'Confirmar'}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </section>
  )
}
