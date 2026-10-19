import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'

import { ApiError, type FieldError } from '../../api/client'
import { api } from '../../api/endpoints'
import { queryKeys, useAccounts, useBalances, useEntryHints } from '../../api/queries'
import type { AccountOut } from '../../api/types'
import { firstDayOfMonth } from '../../domain/dates'
import { ACCOUNT_TYPE_LABELS } from '../../domain/labels'
import { formatBRL, tryParseSignedMoney } from '../../domain/money'
import { type Announce, useInPlace, useMessageFromNavigation, useStatus } from '../../ui/focus'
import { Sheet } from '../../ui/Sheet'
import { MoneyInput } from '../../ui/MoneyInput'
import { ArchivedList, ArchivedSection } from './ArchivedList'
import { Page } from '../../ui/Page'
import {
  errorTextClass,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

type AccountType = AccountOut['type']
const ACCOUNT_TYPES = Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]
const INVALID_AMOUNT = 'Use um valor como 1.234,56.'

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
  const adding = useInPlace()
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.account_id, b.balance]))

  return (
    <Page title="Contas">
      <div className="-mt-2 mb-4 flex justify-end">
        <button
          ref={adding.buttonRef}
          type="button"
          onClick={adding.show}
          className={`${primaryButtonClass} px-4 text-sm`}
        >
          + Adicionar conta
        </button>
      </div>
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
      <ul
        aria-label="Suas contas"
        className="mb-6 overflow-hidden rounded-xl border border-rule bg-slip shadow-[0_2px_8px_rgba(27,35,64,0.06)]"
      >
        {(accounts.data ?? []).map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            balance={balanceOf.get(account.id) ?? null}
            onMessage={announce}
          />
        ))}
      </ul>
      {adding.open && (
        <Sheet title="Nova conta" onClose={() => adding.close()}>
          <NewAccountForm
            onCreated={(name) => {
              adding.close()
              announce(`Conta ${name} criada.`)
            }}
            onCancel={() => adding.close()}
          />
        </Sheet>
      )}
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
  const options = useInPlace()
  const [mode, setMode] = useState<'menu' | 'edit' | 'archive'>('menu')
  const [error, setError] = useState<string | null>(null)
  const refresh = useRefreshAccounts()

  function open() {
    setMode('menu')
    setError(null)
    options.show()
  }

  async function archive() {
    try {
      const result = await api.archiveAccount(account.id)
      const warning = (result.warnings ?? [])[0]?.detail
      // A conta some da lista: o foco vai para a mensagem.
      options.close({ keepFocus: true })
      onMessage(warning ?? `Conta ${account.name} arquivada.`, { focus: true })
      await refresh()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  const negative = balance?.startsWith('-') ?? false
  return (
    <li className="border-b border-rule last:border-b-0">
      <button
        ref={options.buttonRef}
        type="button"
        aria-label={`Opções de ${account.name}`}
        onClick={open}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper/60"
      >
        <span className="min-w-0">
          <span className="block truncate">{account.name}</span>
          <span className="block text-[13px] text-ink-soft">{ACCOUNT_TYPE_LABELS[account.type]}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={`tabular ${negative ? 'text-stamp' : ''}`}>
            {balance !== null ? formatBRL(balance) : '…'}
          </span>
          <span aria-hidden="true" className="text-ink-soft">
            ›
          </span>
        </span>
      </button>
      {options.open && (
        <Sheet title={account.name} onClose={() => options.close()} focusKey={mode}>
          {mode === 'menu' && (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => setMode('edit')} className={secondaryButtonClass}>
                Editar
              </button>
              <button type="button" onClick={() => setMode('archive')} className={secondaryButtonClass}>
                Arquivar
              </button>
            </div>
          )}
          {mode === 'edit' && <EditAccountForm account={account} onDone={() => options.close()} />}
          {mode === 'archive' && (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                Arquivar {account.name}? Ela some da lista e não aceita novos lançamentos; o
                histórico continua.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={archive} className={primaryButtonClass}>
                  Arquivar conta
                </button>
                <button type="button" onClick={() => options.close()} className={secondaryButtonClass}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className={`mt-3 ${errorTextClass}`}>
              {error}
            </p>
          )}
        </Sheet>
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

function NewAccountForm({
  onCreated,
  onCancel,
}: {
  onCreated: (name: string) => void
  onCancel: () => void
}) {
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
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass}>
          Criar conta
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
