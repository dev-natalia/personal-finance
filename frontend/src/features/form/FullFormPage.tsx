import { useNavigate } from 'react-router'

import { useCategories, useEntryHints } from '../../api/queries'
import type { TransactionWriteOut } from '../../api/types'
import { Page } from '../../ui/Page'
import { type SavedEntry, describeSaved } from '../entry/describe'
import { TransactionForm } from './TransactionForm'

/** `/lancamentos/novo`: o formulário completo; ao salvar, volta ao início com a frase de confirmação. */
export function FullFormPage() {
  const navigate = useNavigate()
  const hints = useEntryHints()
  const categories = useCategories()

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
      <TransactionForm onDone={done} />
    </Page>
  )
}
