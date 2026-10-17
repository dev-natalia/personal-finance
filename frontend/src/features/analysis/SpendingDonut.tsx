import type { CategoryTotalOut } from '../../api/types'
import { formatBRL } from '../../domain/money'

/**
 * Cores categóricas em ordem fixa (paleta validada: separação para daltonismo e visão normal).
 * Três delas têm pouco contraste com o papel branco, por isso a legenda sempre traz nome e valor
 * em texto. "Outras" é cinza neutro, fora da ordem.
 */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']
const OTHERS = '#a8ada6'
const RADIUS = 48
const WIDTH = 20
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP = 2 // espaço de papel entre fatias

const colorOf = (item: CategoryTotalOut, index: number) =>
  item.category_id === null ? OTHERS : (SERIES[index] ?? OTHERS)

interface Props {
  items: CategoryTotalOut[]
  selected: string | null
  onSelect: (categoryId: string | null) => void
}

/** "Em que você gastou": rosca por categoria. A legenda é a versão em texto e o filtro. */
export function SpendingDonut({ items, selected, onSelect }: Props) {
  // Number() só para a geometria das fatias; nenhum valor exibido sai daqui.
  const values = items.map((item) => Math.max(Number(item.amount), 0))
  const whole = values.reduce((sum, value) => sum + value, 0)
  let offset = 0
  const slices = items.map((item, index) => {
    const length = whole > 0 ? ((values[index] ?? 0) / whole) * CIRCUMFERENCE : 0
    const slice = { item, index, length, offset }
    offset += length
    return slice
  })

  return (
    <section aria-labelledby="donut-title" className="mt-6">
      <h2 id="donut-title" className="mb-2 text-lg font-[650]">
        Em que você gastou
      </h2>
      <div className="flex flex-col items-center gap-4 min-[480px]:flex-row min-[480px]:items-start">
        <svg viewBox="0 0 120 120" className="size-40 shrink-0 -rotate-90" aria-hidden="true">
          {slices.map(({ item, index, length, offset: start }) => (
            <circle
              key={item.category_id ?? 'others'}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={colorOf(item, index)}
              strokeWidth={WIDTH}
              strokeDasharray={`${Math.max(length - GAP, 0)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-start}
              opacity={selected && selected !== item.category_id ? 0.3 : 1}
              className={item.category_id ? 'cursor-pointer' : undefined}
              onClick={() =>
                item.category_id &&
                onSelect(selected === item.category_id ? null : item.category_id)
              }
            />
          ))}
        </svg>
        <div className="w-full">
          <ul aria-label="Em que você gastou" className="flex flex-col">
            {items.map((item, index) => {
              const swatch = (
                <span
                  aria-hidden="true"
                  className="inline-block size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: colorOf(item, index) }}
                />
              )
              return (
                <li key={item.category_id ?? 'others'} className="flex items-center justify-between gap-3">
                  {item.category_id ? (
                    <button
                      type="button"
                      aria-label={`Filtrar por ${item.name}`}
                      aria-pressed={selected === item.category_id}
                      onClick={() => onSelect(selected === item.category_id ? null : item.category_id)}
                      className="flex min-h-11 items-center gap-2 text-left underline-offset-2 hover:underline aria-pressed:font-[650]"
                    >
                      {swatch}
                      {item.name}
                    </button>
                  ) : (
                    <span className="flex min-h-11 items-center gap-2 text-ink-soft">
                      {swatch}
                      {item.name}
                    </span>
                  )}
                  <span className="tabular shrink-0">{formatBRL(item.amount)}</span>
                </li>
              )
            })}
          </ul>
          {selected && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="mt-1 min-h-11 text-sm text-pen underline-offset-2 hover:underline"
            >
              Limpar filtro
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
