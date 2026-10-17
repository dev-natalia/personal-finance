import { useNavigate, useSearchParams } from 'react-router'

import { useCategories, useEntryHints } from '../../api/queries'
import type { TransactionWriteOut } from '../../api/types'
import { Page } from '../../ui/Page'
import { type SavedEntry, describeSaved } from '../entry/describe'
import { type FormDefaults, TransactionForm } from './TransactionForm'

/** `/lancamentos/novo`: o formulário completo; ao salvar, volta ao início com a frase de confirmação. */
export function FullFormPage() {
  const navigate = useNavigate()
  const hints = useEntryHints()
  const categories = useCategories()
  const [search] = useSearchParams()
  const date = search.get('date') ?? ''
  const defaults: FormDefaults = {
    ...(search.get('card') ? { cardId: search.get('card') ?? '' } : {}),
    ...(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) ? { date } : {}),
  }

  function done(result: TransactionWriteOut) {
    const saved: SavedEntry = {
      line: describeSaved(result.transaction, {
        accounts: new Map((hints.data?.accounts ?? []).map((a) => [a.id, a.name])),
        categories: new Map((categories.data ?? []).map((c) => [c.id, c.name])),
        cards: new Map((hints.data?.cards ?? []).map((c) => [c.id, c.name])),
      }),
      warnings: (result.warnings ?? []).map((w) => w.detail),
    }
    navigate('/', { replace: true, state: { saved } })
  }

  return (
    <Page title="Novo lançamento">
      <TransactionForm defaults={defaults} onDone={done} />
    </Page>
  )
}
