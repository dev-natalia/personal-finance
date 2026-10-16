import { type FormEvent, type KeyboardEvent, type Ref } from 'react'
import { Link } from 'react-router'

import { linkClass } from '../../ui/styles'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Chamado com o texto; quem usa decide se ele virou comprovante e limpa o campo. */
  onSubmit: (text: string) => void
  disabled: boolean
  /** Para a tela devolver o foco ao campo quando o comprovante fecha. */
  inputRef?: Ref<HTMLTextAreaElement>
}

/** Campo da tela inicial (o rascunho é guardado pela tela, junto com o comprovante aberto). */
export function Composer({ value, onChange, onSubmit, disabled, inputRef }: Props) {
  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (disabled || value.trim() === '') return
    onSubmit(value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="flex items-end gap-2 rounded-2xl border-[1.5px] border-ink-soft/40 bg-slip px-3 py-2 focus-within:border-pen">
        <textarea
          ref={inputRef}
          aria-label="Novo lançamento"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="42 mercado pix itaú"
          className="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1 outline-none placeholder:text-ink-soft/70"
        />
        <button
          type="submit"
          disabled={disabled}
          className="min-h-11 shrink-0 px-2 font-semibold text-pen disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
      <Link to="/lancamentos/novo" className={`${linkClass} mt-1 inline-flex min-h-11 items-center text-sm`}>
        Formulário completo
      </Link>
    </form>
  )
}
