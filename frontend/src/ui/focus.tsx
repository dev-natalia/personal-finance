import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

/**
 * Quando um formulário aberto dentro da linha fecha (`mode` volta a "view"), devolve o foco
 * ao botão que o abriu; sem isto o foco cairia no <body> e o teclado perderia a posição.
 */
export function useFocusOnReturn(mode: string, target: RefObject<HTMLElement | null>): void {
  const previous = useRef(mode)
  useEffect(() => {
    if (previous.current !== 'view' && mode === 'view') target.current?.focus()
    previous.current = mode
  }, [mode, target])
}

/** Foco no elemento assim que ele aparece (formulário ou confirmação aberta no lugar do botão). */
export function useFocusOnMount<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}

/**
 * Botão que dá lugar a um formulário na própria tela. `close()` fecha e devolve o foco ao
 * botão; `close({ keepFocus: true })` só fecha, para quem leva o foco à mensagem de resultado.
 */
export function useInPlace(): {
  open: boolean
  show: () => void
  close: (options?: { keepFocus?: boolean }) => void
  buttonRef: RefObject<HTMLButtonElement | null>
} {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  useEffect(() => {
    if (!open && returnFocus.current) buttonRef.current?.focus()
    returnFocus.current = false
  }, [open])
  return {
    open,
    show: () => setOpen(true),
    close: (options = {}) => {
      returnFocus.current = !options.keepFocus
      setOpen(false)
    },
    buttonRef,
  }
}

export type Announce =(text: string, options?: { focus?: boolean }) => void

/**
 * Mensagem de resultado da tela (`role="status"`). Com `focus`, o foco vai até ela: é o que
 * se usa quando a linha que tinha o foco some (anular, arquivar).
 */
export function useStatus(): { announce: Announce; status: ReactNode } {
  const [current, setCurrent] = useState<{ text: string; focus: boolean; id: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (current?.focus) ref.current?.focus()
  }, [current])

  const announce: Announce = (text, options = {}) =>
    setCurrent((previous) => ({ text, focus: options.focus ?? false, id: (previous?.id ?? 0) + 1 }))

  // A região existe desde o início (vazia): leitores de tela ignoram uma que nasce já com texto.
  const status = (
    <div ref={ref} role="status" tabIndex={-1}>
      {current && (
        <p className="mb-2 border-l-4 border-pen bg-slip px-3 py-2 text-sm">{current.text}</p>
      )}
    </div>
  )
  return { announce, status }
}

/** Mensagem deixada por outra tela ao voltar para cá (ex.: cartão arquivado, com aviso). */
export function useMessageFromNavigation(announce: Announce): void {
  const location = useLocation()
  const message = (location.state as { message?: unknown } | null)?.message
  const shown = useRef(false)
  useEffect(() => {
    if (shown.current || typeof message !== 'string') return
    shown.current = true
    announce(message, { focus: true })
  }, [announce, message])
}
