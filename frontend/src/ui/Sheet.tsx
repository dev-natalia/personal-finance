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
  dismissOnBackdrop = true,
  children,
}: {
  title: string
  onClose: () => void
  /** Quando muda (ex.: das opções para o formulário), o foco volta ao primeiro campo. */
  focusKey?: string
  /**
   * Toque fora fecha (padrão). Formulários passam `false`: no celular é fácil tocar acima da
   * janela sem querer e perder o que foi digitado.
   */
  dismissOnBackdrop?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  // Começa no elemento marcado com data-autofocus (ex.: a pergunta de uma confirmação
  // destrutiva, para Enter não confirmar sozinho) ou no primeiro campo.
  useEffect(() => {
    const target =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(target ?? panel.current)?.focus()
  }, [focusKey])

  // A página de trás não rola enquanto a janela está aberta.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    // Foco no próprio painel (toque num ponto sem controle) ou fora da lista: volta para dentro.
    if (!items.includes(document.activeElement as HTMLElement)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && document.activeElement === first) {
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
        onClick={dismissOnBackdrop ? onClose : undefined}
        className="absolute inset-0 bg-ink/35"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl bg-slip px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] outline-none md:rounded-2xl md:pb-6"
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
