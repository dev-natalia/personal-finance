import { errorTextClass, fieldLabelClass, inputClass } from './styles'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | null
}

/** Campo de valor em reais, digitado como texto ("1.234,56"); quem usa converte e valida. */
export function MoneyInput({ id, label, value, onChange, error }: Props) {
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${inputClass} tabular`}
      />
      {error && (
        <p id={errorId} className={errorTextClass}>
          {error}
        </p>
      )}
    </div>
  )
}
