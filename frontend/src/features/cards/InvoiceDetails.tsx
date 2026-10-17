import { type FormEvent, useId, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useInvalidateLedger, useInvoice } from '../../api/queries'
import type { InvoiceItemOut, InvoiceSummaryOut, TransactionOut } from '../../api/types'
import { monthName, shortDate } from '../../domain/dates'
import { formatBRL } from '../../domain/money'
import type { Announce } from '../../ui/focus'
import { Field } from '../../ui/Field'
import {
  errorTextClass,
  inputClass,
  ledgerRowClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
}

/** Livro-caixa de uma fatura: itens (com "1 de 6"), pagamentos e as datas editáveis. */
export function InvoiceDetails({
  invoiceId,
  onMessage,
}: {
  invoiceId: string
  onMessage: Announce
}) {
  const detail = useInvoice(invoiceId)
  if (detail.isPending) return <p className="py-2 text-sm text-ink-soft">Carregando…</p>
  if (detail.isError) return <p className={errorTextClass}>{messageOf(detail.error)}</p>

  const { invoice, items, payments } = detail.data
  const month = monthName(invoice.reference_month)
  return (
    <div className="pb-2">
      {items.length === 0 ? (
        <p className="py-2 text-sm text-ink-soft">Nenhum item nesta fatura.</p>
      ) : (
        <ul aria-label={`Itens da fatura de ${month}`}>
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      {payments.length > 0 && (
        <>
          <h4 className="mt-4 text-sm font-semibold">Pagamentos</h4>
          <ul aria-label={`Pagamentos da fatura de ${month}`}>
            {paymentGroups(payments).map((group) => (
              <PaymentGroupRow key={group.id} group={group} onMessage={onMessage} />
            ))}
          </ul>
        </>
      )}
      <InvoiceDates invoice={invoice} />
    </div>
  )
}

function ItemRow({ item }: { item: InvoiceItemOut }) {
  const cancelled = item.status === 'CANCELLED'
  const details = [
    item.occurred_on ? shortDate(item.occurred_on) : null,
    item.installment_number && item.installment_count
      ? `${item.installment_number} de ${item.installment_count}`
      : null,
    cancelled ? 'estornada' : null,
  ].filter((part): part is string => part !== null)
  const amount = item.direction === 'CREDIT' ? `-${item.amount}` : item.amount
  return (
    <li className={ledgerRowClass}>
      <div className="min-w-0">
        <p className={`truncate ${cancelled ? 'text-ink-soft line-through' : ''}`}>
          {item.description}
        </p>
        {details.length > 0 && (
          <p className="text-[13px] text-ink-soft">
            {details.map((part) => (
              <span key={part} className="mr-3 inline-block">
                {part}
              </span>
            ))}
          </p>
        )}
      </div>
      <span className={`tabular shrink-0 ${cancelled ? 'text-ink-soft line-through' : ''}`}>
        {formatBRL(amount)}
      </span>
    </li>
  )
}

interface PaymentGroup {
  id: string
  voidable: boolean
  payments: TransactionOut[]
}

/** Um pagamento pode sair de várias contas: as partes dividem o mesmo `payment_group_id`. */
function paymentGroups(payments: TransactionOut[]): PaymentGroup[] {
  const groups = new Map<string, PaymentGroup>()
  for (const payment of payments) {
    const id = payment.payment_group_id ?? payment.id
    const group = groups.get(id) ?? { id, voidable: payment.payment_group_id !== null, payments: [] }
    group.payments.push(payment)
    groups.set(id, group)
  }
  return [...groups.values()]
}

function PaymentGroupRow({ group, onMessage }: { group: PaymentGroup; onMessage: Announce }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invalidate = useInvalidateLedger()
  const amounts = group.payments.map((p) => formatBRL(p.amount)).join(' + ')

  async function voidGroup() {
    try {
      await api.voidPaymentGroup(group.id)
      onMessage('Pagamento anulado. O valor voltou para a conta.', { focus: true })
      await invalidate()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <li className="border-b border-rule py-3">
      {group.payments.map((payment) => (
        <p key={payment.id} className="flex justify-between gap-3">
          <span className="min-w-0 truncate">
            {shortDate(payment.occurred_on)} {payment.description}
          </span>
          <span className="tabular shrink-0">{formatBRL(payment.amount)}</span>
        </p>
      ))}
      {group.voidable &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <p className="w-full text-sm">
              Anular este pagamento? O valor volta para a conta e a fatura fica em aberto de novo.
            </p>
            <button type="button" onClick={voidGroup} className={primaryButtonClass}>
              Anular pagamento de {amounts}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={secondaryButtonClass}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={textButton}>
            Anular pagamento
          </button>
        ))}
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
    </li>
  )
}

/** "Editar datas": quando o banco muda o fechamento ou o vencimento de uma fatura. */
function InvoiceDates({ invoice }: { invoice: InvoiceSummaryOut }) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [closing, setClosing] = useState(invoice.closing_date)
  const [due, setDue] = useState(invoice.due_date)
  const [error, setError] = useState<string | null>(null)
  const invalidate = useInvalidateLedger()

  if (!editing || invoice.id === null) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
        Fechamento {shortDate(invoice.closing_date)}, vencimento {shortDate(invoice.due_date)}
        {invoice.id !== null && (
          <button type="button" onClick={() => setEditing(true)} className={textButton}>
            Editar datas
          </button>
        )}
      </p>
    )
  }

  const invoiceId = invoice.id
  async function submit(event: FormEvent) {
    event.preventDefault()
    const patch = {
      ...(closing !== invoice.closing_date ? { closing_date: closing } : {}),
      ...(due !== invoice.due_date ? { due_date: due } : {}),
    }
    try {
      if (Object.keys(patch).length > 0) {
        await api.updateInvoice(invoiceId, patch)
        await invalidate()
      }
      setEditing(false)
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <form
      aria-label={`Datas da fatura de ${monthName(invoice.reference_month)}`}
      onSubmit={submit}
      className="mt-3 flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-closing`} label="Fechamento">
          <input
            id={`${id}-closing`}
            type="date"
            value={closing}
            onChange={(e) => setClosing(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-due`} label="Vencimento">
          <input
            id={`${id}-due`}
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass}>
          Salvar datas
        </button>
        <button type="button" onClick={() => setEditing(false)} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
