import { type ReactNode, useState } from 'react'

import { ApiError } from '../../api/client'
import { errorTextClass, ledgerRowClass } from '../../ui/styles'

const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'

export interface ArchivedItem {
  id: string
  name: string
  /** Texto à direita (saldo da conta); opcional. */
  detail?: ReactNode
}

/**
 * Seção recolhida com o que foi arquivado e o botão "Desarquivar". O conteúdo só monta (e
 * busca os dados) quando a seção é aberta.
 */
export function ArchivedSection({ title, children }: { title: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false)
  return (
    <details
      className="mt-4 border-t border-rule"
      onToggle={(e) => setOpened(opened || e.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer items-center py-2 font-[650] text-pen">
        {title}
      </summary>
      {opened && children}
    </details>
  )
}

export function ArchivedList({
  label,
  items,
  emptyText,
  onUnarchive,
}: {
  label: string
  items: ArchivedItem[] | undefined
  emptyText: string
  onUnarchive: (item: ArchivedItem) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  if (items === undefined) return <p className="pb-3 text-sm text-ink-soft">Carregando…</p>
  if (items.length === 0) return <p className="pb-3 text-sm text-ink-soft">{emptyText}</p>

  async function unarchive(item: ArchivedItem) {
    setError(null)
    try {
      await onUnarchive(item)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Erro inesperado. Tente de novo.')
    }
  }

  return (
    <div className="pb-3">
      <ul aria-label={label}>
        {items.map((item) => (
          <li key={item.id} className={`${ledgerRowClass} flex-wrap`}>
            <span className="min-w-0 truncate text-ink-soft">{item.name}</span>
            {item.detail && <span className="tabular shrink-0 text-ink-soft">{item.detail}</span>}
            <div className="-ml-2 w-full">
              <button
                type="button"
                aria-label={`Desarquivar ${item.name}`}
                onClick={() => unarchive(item)}
                className={textButton}
              >
                Desarquivar
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
    </div>
  )
}
