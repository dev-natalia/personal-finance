import { usePurchasePreview } from '../../api/queries'
import type { PreviewIn } from '../../api/types'
import { monthName } from '../../domain/dates'
import { formatBRL } from '../../domain/money'
import { linkClass } from '../../ui/styles'

/** Valor com espaço que não quebra: "R$" nunca fica numa linha e o número na outra. */
function money(amount: string): string {
  return formatBRL(amount).replace(' ', '\u00a0')
}

interface Props {
  /** O que pedir à prévia; nulo enquanto não é compra no cartão com valor válido. */
  input: { cardId: string; body: PreviewIn } | null
}

/**
 * Como a fatura e o limite ficam com a compra. Os números vêm do backend (a prévia não grava
 * nada); se a prévia falhar, nenhum número é inventado aqui.
 */
export function CardImpact({ input }: Props) {
  const preview = usePurchasePreview(input)
  if (input === null) return null
  if (preview.isError) {
    return (
      <p className="mt-3 text-sm text-ink-soft">Não foi possível calcular o impacto na fatura.</p>
    )
  }
  if (!preview.data) return <p className="mt-3 text-sm text-ink-soft">Calculando…</p>

  const { invoice, following, limit_before, limit_after } = preview.data
  const overLimit = limit_after.startsWith('-')
  return (
    <div className="mt-3 flex flex-col gap-1 text-sm">
      <p className="tabular">
        Fatura de {monthName(invoice.reference_month)}: {money(invoice.before)} →{' '}
        {money(invoice.after)}
      </p>
      <p className="tabular">
        Limite disponível: {money(limit_before)} → {money(limit_after)}
      </p>
      <p className="text-ink-soft">Limite não é dinheiro.</p>
      {overLimit && (
        <p className="font-semibold text-stamp">
          Esta compra passa do limite em {money(limit_after.slice(1))}.
        </p>
      )}
      {following.length > 0 && (
        <details>
          <summary className={`${linkClass} inline-flex min-h-11 cursor-pointer items-center`}>
            Ver como ficam as próximas faturas
          </summary>
          <ul className="tabular">
            {following.map((impact) => (
              <li key={impact.reference_month}>
                {monthName(impact.reference_month)}: {money(impact.before)} →{' '}
                {money(impact.after)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
