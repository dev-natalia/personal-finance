import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'

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

export type Announce = (text: string, options?: { focus?: boolean }) => void

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
