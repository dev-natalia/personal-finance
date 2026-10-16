import { type ReactNode, useId, useState } from 'react'
import { useSearchParams } from 'react-router'

import { ApiError } from '../../api/client'
import { type TransactionQuery, api } from '../../api/endpoints'
import {
  useAccounts,
  useCategories,
  useEntryHints,
  useInvalidateLedger,
  useTransactions,
} from '../../api/queries'
import type { TransactionOut, TransactionWriteOut } from '../../api/types'
import { dayLabel } from '../../domain/dates'
import { TRANSACTION_TYPE_LABELS } from '../../domain/labels'
import { formatBRL } from '../../domain/money'
import { Field } from '../../ui/Field'
import { Page } from '../../ui/Page'
import {
  errorTextClass,
  inputClass,
  ledgerRowClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'
import { TransactionForm } from '../form/TransactionForm'
import { LedgerAmount, ledgerDetail } from '../home/Timeline'
import { RefundDialog } from './RefundDialog'

type Filter = 'date_from' | 'date_to' | 'account_id' | 'category_id' | 'type' | 'status'

const TYPES = Object.entries(TRANSACTION_TYPE_LABELS) as [TransactionOut['type'], string][]
const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'

interface Names {
  accounts: Map<string, string>
  categories: Map<string, string>
}

/** `/lancamentos`: livro-caixa com filtros na URL, edição, anulação e estorno. */
export function TransactionsPage() {
  const [search, setSearch] = useSearchParams()
  const hints = useEntryHints()
  const accounts = useAccounts(true)
  const categories = useCategories()
  const [message, setMessage] = useState<string | null>(null)

  const filter = (name: Filter) => search.get(name) ?? ''
  const params: Omit<TransactionQuery, 'cursor'> = {
    date_from: filter('date_from') || undefined,
    date_to: filter('date_to') || undefined,
    account_id: filter('account_id') || undefined,
    category_id: filter('category_id') || undefined,
    type: (filter('type') || undefined) as TransactionQuery['type'],
    status: (filter('status') || undefined) as TransactionQuery['status'],
  }
  const list = useTransactions(params)

  function setFilter(name: Filter, value: string) {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) next.set(name, value)
        else next.delete(name)
        return next
      },
      { replace: true },
    )
  }

  const names: Names = {
    accounts: new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
    categories: new Map((categories.data ?? []).map((c) => [c.id, c.name])),
  }
  const items = (list.data?.pages ?? []).flatMap((page) => page.items)
  const days = new Map<string, TransactionOut[]>()
  for (const tx of items) days.set(tx.occurred_on, [...(days.get(tx.occurred_on) ?? []), tx])
  const expenseCategories = (categories.data ?? []).filter((c) => c.kind === 'EXPENSE')
  const incomeCategories = (categories.data ?? []).filter((c) => c.kind === 'INCOME')

  return (
    <Page title="Lançamentos">
      <Filters filter={filter} setFilter={setFilter}>
        {{
          accounts: (accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.archived_at ? `${a.name} (arquivada)` : a.name}
            </option>
          )),
          categories: (
            <>
              <optgroup label="Despesas">
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Receitas">
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </>
          ),
        }}
      </Filters>

      {message && (
        <p role="status" className="mb-2 border-l-4 border-pen bg-slip px-3 py-2 text-sm">
          {message}
        </p>
      )}
      {list.isError && (
        <p role="alert" className={errorTextClass}>
          {list.error instanceof ApiError ? list.error.detail : 'Erro inesperado. Tente de novo.'}
        </p>
      )}
      {list.isSuccess && items.length === 0 && (
        <p className="py-6 text-ink-soft">Nenhum lançamento com esses filtros.</p>
      )}

      {hints.data &&
        [...days.entries()].map(([day, txs]) => (
          <section key={day} aria-label={dayLabel(day, hints.data.today)}>
            <h2 className="mt-4 mb-1 text-[13px] font-semibold text-ink-soft">
              {dayLabel(day, hints.data.today)}
            </h2>
            <ul>
              {txs.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} names={names} onMessage={setMessage} />
              ))}
            </ul>
          </section>
        ))}

      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className={`${secondaryButtonClass} mt-4`}
        >
          Carregar mais
        </button>
      )}
    </Page>
  )
}

function Filters({
  filter,
  setFilter,
  children,
}: {
  filter: (name: Filter) => string
  setFilter: (name: Filter, value: string) => void
  children: { accounts: ReactNode; categories: ReactNode }
}) {
  const id = useId()
  const select = (name: Filter, label: string, options: ReactNode, all = 'Todas') => (
    <Field id={`${id}-${name}`} label={label}>
      <select
        id={`${id}-${name}`}
        value={filter(name)}
        onChange={(e) => setFilter(name, e.target.value)}
        className={inputClass}
      >
        <option value="">{all}</option>
        {options}
      </select>
    </Field>
  )
  const date = (name: Filter, label: string) => (
    <Field id={`${id}-${name}`} label={label}>
      <input
        id={`${id}-${name}`}
        type="date"
        min="1900-01-01"
        max="2100-12-31"
        value={filter(name)}
        onChange={(e) => setFilter(name, e.target.value)}
        className={inputClass}
      />
    </Field>
  )

  return (
    <div role="group" aria-label="Filtros" className="mb-4 grid grid-cols-2 gap-3">
      {date('date_from', 'De')}
      {date('date_to', 'Até')}
      {select('account_id', 'Conta', children.accounts)}
      {select('category_id', 'Categoria', children.categories)}
      {select(
        'type',
        'Tipo',
        TYPES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        )),
        'Todos',
      )}
      <Field id={`${id}-status`} label="Situação">
        <select
          id={`${id}-status`}
          value={filter('status')}
          onChange={(e) => setFilter('status', e.target.value)}
          className={inputClass}
        >
          <option value="">Confirmados</option>
          <option value="VOIDED">Anulados</option>
          <option value="ALL">Todos</option>
        </select>
      </Field>
    </div>
  )
}

function TransactionRow({
  tx,
  names,
  onMessage,
}: {
  tx: TransactionOut
  names: Names
  onMessage: (message: string) => void
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'void' | 'refund'>('view')
  const [error, setError] = useState<string | null>(null)
  const invalidate = useInvalidateLedger()
  const voided = tx.status === 'VOIDED'

  function finish(text: string, result?: TransactionWriteOut) {
    const warnings = (result?.warnings ?? []).map((w) => w.detail)
    onMessage([text, ...warnings].join(' '))
    setMode('view')
  }

  async function voidIt() {
    setError(null)
    try {
      await api.voidTransaction(tx.id)
      await invalidate()
      finish('Lançamento anulado.')
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Erro inesperado. Tente de novo.')
    }
  }

  if (mode === 'edit') {
    return (
      <li className="border-b border-rule py-3">
        <TransactionForm
          initial={tx}
          onDone={(result) => finish('Lançamento atualizado.', result)}
          onCancel={() => setMode('view')}
        />
      </li>
    )
  }

  return (
    <li className={`${ledgerRowClass} flex-wrap`}>
      <div className="min-w-0">
        <p className={`truncate ${voided ? 'text-ink-soft line-through' : ''}`}>{tx.description}</p>
        <p className="text-[13px] text-ink-soft">
          {voided && <span className="mr-1 font-semibold text-stamp">Anulado</span>}
          {ledgerDetail(tx, names.accounts, names.categories)}
        </p>
      </div>
      <span className={voided ? 'line-through opacity-60' : ''}>
        <LedgerAmount tx={tx} />
      </span>

      {!voided && mode === 'view' && (
        <div className="-ml-2 flex w-full gap-1">
          <button
            type="button"
            aria-label={`Editar ${tx.description}`}
            onClick={() => setMode('edit')}
            className={textButton}
          >
            Editar
          </button>
          <button
            type="button"
            aria-label={`Anular ${tx.description}`}
            onClick={() => setMode('void')}
            className={textButton}
          >
            Anular
          </button>
          {tx.type === 'EXPENSE' && (
            <button
              type="button"
              aria-label={`Estornar ${tx.description}`}
              onClick={() => setMode('refund')}
              className={textButton}
            >
              Estornar
            </button>
          )}
        </div>
      )}

      {mode === 'void' && (
        <div
          role="group"
          aria-label={`Anular ${tx.description}`}
          className="flex w-full flex-wrap items-center gap-2 pt-2"
        >
          <p className="w-full text-sm">
            Anular {tx.description}? Ele deixa de contar nos saldos e fica no histórico como anulado.
          </p>
          <button type="button" onClick={voidIt} className={primaryButtonClass}>
            Anular lançamento
          </button>
          <button type="button" onClick={() => setMode('view')} className={secondaryButtonClass}>
            Cancelar
          </button>
        </div>
      )}

      {mode === 'refund' && (
        <RefundDialog
          expense={tx}
          onDone={(result) =>
            finish(`Estorno registrado: ${formatBRL(result.transaction.amount)}.`, result)
          }
          onCancel={() => setMode('view')}
        />
      )}

      {error && (
        <p role="alert" className={`w-full ${errorTextClass}`}>
          {error}
        </p>
      )}
    </li>
  )
}
