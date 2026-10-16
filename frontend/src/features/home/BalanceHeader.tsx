import { useBalances } from '../../api/queries'
import { formatBRL } from '../../domain/money'

/** O saldo é o maior texto da tela: é a primeira coisa que importa ao abrir o app. */
export function BalanceHeader() {
  const balances = useBalances()
  return (
    <header className="pt-6 pb-3">
      <p className="text-sm text-ink-soft">Saldo em contas</p>
      <p className="tabular text-[34px] leading-tight font-[650] tracking-tight">
        {balances.data ? formatBRL(balances.data.total) : '…'}
      </p>
    </header>
  )
}
