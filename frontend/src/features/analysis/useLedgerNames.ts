import { useAccounts, useAllCategories, useCards } from '../../api/queries'
import type { LedgerNames } from '../home/Timeline'

/** Nomes para o livro-caixa, inclusive de contas, cartões e categorias arquivados. */
export function useLedgerNames(): LedgerNames {
  const accounts = useAccounts(true)
  const cards = useCards(true)
  const categories = useAllCategories()
  return {
    accounts: new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
    cards: new Map((cards.data ?? []).map((c) => [c.id, c.name])),
    categories: new Map((categories.data ?? []).map((c) => [c.id, c.name])),
  }
}
