import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Janela que sobe de baixo, por cima da tela (no computador, centralizada). Montada só
 * enquanto aberta: quem chama decide quando, e devolve o foco ao botão que abriu (`useInPlace`).
 * Foco preso dentro; Esc e um toque fora fecham. É um <div role="dialog"> e não um <dialog>
 * porque o `showModal` não é confiável no jsdom dos testes.
 */
export function Sheet({
  title,
  onClose,
  focusKey,
  children,
}: {
  title: string
  onClose: () => void
  /** Quando muda (ex.: das opções para o formulário), o foco volta ao primeiro campo. */
  focusKey?: string
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
  }, [focusKey])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center">
      <div
        data-testid="sheet-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-ink/35"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-slip px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] outline-none md:rounded-2xl md:pb-6"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule md:hidden" />
        <h2 id={titleId} className="mb-3 text-lg font-[650]">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
