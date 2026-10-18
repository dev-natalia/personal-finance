import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { queryKeys, useMisreadPhrases } from '../../api/queries'
import type { MisreadPhraseOut, MisreadReason } from '../../api/types'
import { dayAndTime } from '../../domain/dates'
import { Page } from '../../ui/Page'
import {
  errorTextClass,
  ledgerRowClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'
import { useTimeZone } from './useTimeZone'

const REASON_LABELS: Record<MisreadReason, string> = {
  NOTHING_PARSED: 'não entendeu nada',
  PENDING_AMOUNT: 'faltou o valor',
  PENDING_DESCRIPTION: 'faltou a descrição',
  PENDING_ACCOUNT: 'faltou a conta ou o cartão',
  PENDING_PAYMENT_METHOD: 'faltou o meio de pagamento',
  CHANGED_TYPE: 'tipo corrigido',
  CHANGED_AMOUNT: 'valor corrigido',
  CHANGED_DESCRIPTION: 'descrição corrigida',
  CHANGED_DATE: 'data corrigida',
  CHANGED_SOURCE: 'conta ou cartão corrigido',
  CHANGED_PAYMENT_METHOD: 'meio de pagamento corrigido',
  CHANGED_INSTALLMENTS: 'parcelas corrigidas',
  UNCHECKED_ITEM: 'item desmarcado',
}

function reasonsText(reasons: MisreadReason[]): string {
  const text = reasons.map((reason) => REASON_LABELS[reason]).join('; ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const textButton = 'min-h-11 px-2 text-sm text-pen underline underline-offset-2'

/** Frases que o app não entendeu de primeira: base para decidir se a IA faz falta. */
export function MisreadPhrasesPage() {
  const phrases = useMisreadPhrases()
  const queryClient = useQueryClient()
  const timeZone = useTimeZone()
  const [confirmAll, setConfirmAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
      setConfirmAll(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : 'Erro inesperado. Tente de novo.')
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.misreadPhrases })
    }
  }

  const items = phrases.data ?? []

  return (
    <Page title="Frases não entendidas">
      <p className="mb-4 text-sm text-ink-soft">
        Frases do registro rápido que ficaram pela metade ou que você precisou corrigir.
      </p>
      {phrases.isError && <p className={errorTextClass}>Não foi possível carregar as frases.</p>}
      {phrases.data && items.length === 0 && (
        <p className="text-ink-soft">
          Nenhuma frase por aqui. Quando o app não entender algo que você digitou, a frase aparece
          nesta lista.
        </p>
      )}
      {items.length > 0 && (
        <>
          <ul className="mb-6">
            {items.map((phrase) => (
              <PhraseRow
                key={phrase.id}
                phrase={phrase}
                timeZone={timeZone}
                onDelete={() => remove(() => api.deleteMisreadPhrase(phrase.id))}
              />
            ))}
          </ul>
          {confirmAll ? (
            <div
              role="group"
              aria-label="Apagar todas as frases"
              className="flex flex-wrap items-center gap-2"
            >
              <p className="w-full text-sm">
                Apagar {items.length === 1 ? 'a frase' : `as ${items.length} frases`}? Não dá para
                desfazer.
              </p>
              <button
                type="button"
                onClick={() => remove(api.deleteAllMisreadPhrases)}
                className={primaryButtonClass}
              >
                Apagar todas as frases
              </button>
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className={secondaryButtonClass}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAll(true)}
              className={secondaryButtonClass}
            >
              Apagar todas
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={`mt-3 ${errorTextClass}`}>
          {error}
        </p>
      )}
    </Page>
  )
}

function PhraseRow({
  phrase,
  timeZone,
  onDelete,
}: {
  phrase: MisreadPhraseOut
  timeZone: string
  onDelete: () => void
}) {
  return (
    <li className={ledgerRowClass}>
      <div className="min-w-0 flex-1">
        <p className="break-words">{phrase.text}</p>
        <p className="text-sm text-ink-soft">{reasonsText(phrase.reasons)}</p>
        <p className="text-sm text-ink-soft">{dayAndTime(phrase.updated_at, timeZone)}</p>
      </div>
      <button
        type="button"
        aria-label={`Apagar "${phrase.text}"`}
        onClick={onDelete}
        className={textButton}
      >
        Apagar
      </button>
    </li>
  )
}
