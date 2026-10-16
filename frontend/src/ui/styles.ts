/**
 * Classes compartilhadas (direção visual "comprovante"). Alvos de toque com pelo menos 44px
 * (`min-h-11`); cores só dos tokens de `index.css`.
 */

export const inputClass =
  'min-h-11 w-full rounded-lg border-[1.5px] border-ink-soft/40 bg-slip px-3 py-2 text-ink ' +
  'placeholder:text-ink-soft/70 aria-invalid:border-stamp'

export const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-pen px-5 font-semibold ' +
  'text-white hover:bg-pen/90 disabled:cursor-not-allowed disabled:opacity-60'

export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg border-[1.5px] ' +
  'border-ink-soft/50 px-4 text-ink hover:bg-ink/5'

export const chipClass =
  'inline-flex min-h-11 items-center rounded-full border-[1.5px] border-pen bg-slip px-4 ' +
  'text-pen aria-pressed:bg-pen aria-pressed:text-white'

export const ledgerRowClass = 'flex items-start justify-between gap-3 border-b border-rule py-3'

export const slipClass = 'slip relative bg-slip px-4 pt-5 pb-6'

export const linkClass = 'text-pen underline underline-offset-2 hover:no-underline'

export const fieldLabelClass = 'flex flex-col gap-1 text-sm text-ink-soft'

export const errorTextClass = 'text-sm text-stamp'
