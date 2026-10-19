import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'

import { ApiError, type FieldError } from '../../api/client'
import { api } from '../../api/endpoints'
import { queryKeys, useAccounts, useBalances, useEntryHints } from '../../api/queries'
import type { AccountOut } from '../../api/types'
import { firstDayOfMonth } from '../../domain/dates'
import { ACCOUNT_TYPE_LABELS } from '../../domain/labels'
import { formatBRL, tryParseSignedMoney } from '../../domain/money'
import { type Announce, useFocusOnReturn, useMessageFromNavigation, useStatus } from '../../ui/focus'
import { MoneyInput } from '../../ui/MoneyInput'
import { ArchivedList, ArchivedSection } from './ArchivedList'
import { Page } from '../../ui/Page'
import {
  errorTextClass,
  fieldLabelClass,
  inputClass,
  ledgerRowClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

type AccountType = AccountOut['type']
const ACCOUNT_TYPES = Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]
const INVALID_AMOUNT = 'Use um valor como 1.234,56.'
const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'

function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  return Object.fromEntries(error.fieldErrors.map((f: FieldError) => [f.field, f.message]))
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
}

/** Recarrega tudo que depende das contas: lista, saldos e atalhos do registro rápido. */
function useRefreshAccounts(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
      queryClient.invalidateQueries({ queryKey: queryKeys.balances }),
      queryClient.invalidateQueries({ queryKey: queryKeys.hints }),
    ])
  }
}

export function AccountsPage() {
  const accounts = useAccounts()
  const balances = useBalances()
  const { announce, status } = useStatus()
  useMessageFromNavigation(announce)
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.account_id, b.balance]))

  return (
    <Page title="Contas e cartões">
      {balances.data && (
        <p className="mb-2 flex items-baseline justify-between text-ink-soft">
          Total em contas
          <span className="tabular text-xl font-[650] text-ink">
            {formatBRL(balances.data.total)}
          </span>
        </p>
      )}
      {balances.data && /[1-9]/.test(balances.data.archived_total) && (
        // Fora do total, mas sem sumir: o dinheiro que ficou em contas arquivadas.
        <p className="mb-2 text-right text-sm text-ink-soft">
          {formatBRL(balances.data.archived_total)} em contas arquivadas
        </p>
      )}
      {status}
      <ul aria-label="Suas contas" className="mb-8">
        {(accounts.data ?? []).map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            balance={balanceOf.get(account.id) ?? null}
            onMessage={announce}
          />
        ))}
      </ul>
      <NewAccountForm onCreated={(name) => announce(`Conta ${name} criada.`)} />
      <ArchivedSection title="Contas arquivadas">
        <ArchivedAccounts balanceOf={balanceOf} onMessage={announce} />
      </ArchivedSection>
    </Page>
  )
}

function ArchivedAccounts({
  balanceOf,
  onMessage,
}: {
  balanceOf: Map<string, string>
  onMessage: Announce
}) {
  const all = useAccounts(true)
  const refresh = useRefreshAccounts()
  const items = all.data
    ?.filter((a) => a.archived_at !== null)
    .map((a) => {
      const balance = balanceOf.get(a.id)
      return { id: a.id, name: a.name, detail: balance ? formatBRL(balance) : undefined }
    })
  return (
    <ArchivedList
      label="Contas arquivadas"
      items={items}
      emptyText="Nenhuma conta arquivada."
      onUnarchive={async (item) => {
        await api.unarchiveAccount(item.id)
        onMessage(`Conta ${item.name} desarquivada.`, { focus: true })
        await refresh()
      }}
    />
  )
}

function AccountRow({
  account,
  balance,
  onMessage,
}: {
  account: AccountOut
  balance: string | null
  onMessage: Announce
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'archive'>('view')
  const [error, setError] = useState<string | null>(null)
  const refresh = useRefreshAccounts()
  const editRef = useRef<HTMLButtonElement>(null)
  useFocusOnReturn(mode, editRef)

  async function archive() {
    try {
      const result = await api.archiveAccount(account.id)
      const warning = (result.warnings ?? [])[0]?.detail
      // A conta some da lista: o foco vai para a mensagem.
      onMessage(warning ?? `Conta ${account.name} arquivada.`, { focus: true })
      await refresh()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  if (mode === 'edit') {
    return (
      <li className="border-b border-rule py-3">
        <EditAccountForm account={account} onDone={() => setMode('view')} />
      </li>
    )
  }

  const negative = balance?.startsWith('-') ?? false
  return (
    <li className={`${ledgerRowClass} flex-wrap`}>
      <div className="min-w-0">
        <p className="truncate">{account.name}</p>
        <p className="text-[13px] text-ink-soft">{ACCOUNT_TYPE_LABELS[account.type]}</p>
      </div>
      <span className={`tabular shrink-0 ${negative ? 'text-stamp' : ''}`}>
        {balance !== null ? formatBRL(balance) : '…'}
      </span>
      {mode === 'archive' ? (
        <div className="flex w-full flex-wrap items-center gap-2 pt-2">
          <p className="w-full text-sm">
            Arquivar {account.name}? Ela some da lista e não aceita novos lançamentos; o histórico
            continua.
          </p>
          <button type="button" onClick={archive} className={primaryButtonClass}>
            Arquivar conta
          </button>
          <button type="button" onClick={() => setMode('view')} className={secondaryButtonClass}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="flex w-full gap-1">
          <button
            ref={editRef}
            type="button"
            aria-label={`Editar ${account.name}`}
            onClick={() => setMode('edit')}
            className={textButton}
          >
            Editar
          </button>
          <button
            type="button"
            aria-label={`Arquivar ${account.name}`}
            onClick={() => setMode('archive')}
            className={textButton}
          >
            Arquivar
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={`w-full ${errorTextClass}`}>
          {error}
        </p>
      )}
    </li>
  )
}

function EditAccountForm({ account, onDone }: { account: AccountOut; onDone: () => void }) {
  const id = useId()
  const [name, setName] = useState(account.name)
  const [type, setType] = useState<AccountType>(account.type)
  const [error, setError] = useState<string | null>(null)
  const refresh = useRefreshAccounts()

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await api.updateAccount(account.id, { name: name.trim(), type })
      await refresh()
      onDone()
    } catch (err) {
      setError(fieldErrorsOf(err).name ?? messageOf(err))
    }
  }

  return (
    <form aria-label={`Editar ${account.name}`} onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor={`${id}-name`} className={fieldLabelClass}>
        Nome
      </label>
      <input
        id={`${id}-name`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${inputClass} -mt-2`}
      />
      <label className={fieldLabelClass}>
        Tipo
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className={inputClass}>
          {ACCOUNT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <button type="button" onClick={onDone} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function NewAccountForm({ onCreated }: { onCreated: (name: string) => void }) {
  const id = useId()
  const hints = useEntryHints()
  const refresh = useRefreshAccounts()
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('CHECKING')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const openingDate = date ?? (hints.data ? firstDayOfMonth(hints.data.today) : '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const openingBalance = tryParseSignedMoney(amount)
    const local: Record<string, string> = {}
    if (name.trim() === '') local.name = 'Informe um nome.'
    if (openingBalance === null) local.opening_balance = INVALID_AMOUNT
    if (!openingDate) local.opening_date = 'Informe a data de abertura.'
    setErrors(local)
    if (Object.keys(local).length > 0 || openingBalance === null) return

    try {
      const created = await api.createAccount({
        name: name.trim(),
        type,
        opening_balance: openingBalance,
        opening_date: openingDate,
      })
      setName('')
      setAmount('')
      setType('CHECKING')
      setDate(null)
      onCreated(created.name)
      await refresh()
    } catch (err) {
      setErrors(fieldErrorsOf(err))
      setFormError(messageOf(err))
    }
  }

  return (
    <form aria-label="Nova conta" onSubmit={submit} noValidate className="flex flex-col gap-3">
      <h2 className="text-lg font-[650]">Nova conta</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-name`} className={fieldLabelClass}>
          Nome
        </label>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${id}-name-error` : undefined}
          className={inputClass}
        />
        {errors.name && (
          <p id={`${id}-name-error`} className={errorTextClass}>
            {errors.name}
          </p>
        )}
      </div>
      <label className={fieldLabelClass}>
        Tipo
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className={inputClass}>
          {ACCOUNT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <MoneyInput
        id={`${id}-amount`}
        label="Saldo de abertura"
        value={amount}
        onChange={setAmount}
        error={errors.opening_balance}
      />
      <label className={fieldLabelClass}>
        Data de abertura
        <input
          type="date"
          value={openingDate}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
      </label>
      {formError && (
        <p role="alert" className={errorTextClass}>
          {formError}
        </p>
      )}
      <button type="submit" className={`${primaryButtonClass} self-start`}>
        Criar conta
      </button>
    </form>
  )
}
