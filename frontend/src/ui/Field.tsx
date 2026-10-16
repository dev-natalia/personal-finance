import type { ReactNode } from 'react'

import { errorTextClass, fieldLabelClass } from './styles'

/** Atributos de campo inválido, ligando o campo à mensagem de erro do `Field`. */
export function invalid(id: string, error: string | undefined) {
  return error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {}
}

/** Rótulo, campo e mensagem de erro (id `${id}-error`). */
export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className={errorTextClass}>
          {error}
        </p>
      )}
    </div>
  )
}
