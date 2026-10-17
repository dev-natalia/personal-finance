import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useInvalidateLedger, useInvoice } from '../../api/queries'
import type { InvoiceItemOut, InvoiceSummaryOut, TransactionOut } from '../../api/types'
import { monthName, shortDate } from '../../domain/dates'
import { formatBRL } from '../../domain/money'
import { type Announce, useFocusOnMount, useInPlace } from '../../ui/focus'
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

  const { invoice, items, adjustments, payments } = detail.data
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
      {adjustments.length > 0 && (
        // Crédito herdado e o que saiu sem pagamento (levado adiante ou parcelado): sem estas
        // linhas, uma fatura "paga" com pagamento menor que o total não fecha na conta.
        <ul aria-label={`Ajustes da fatura de ${month}`}>
          {adjustments.map((adjustment) => (
            <li key={adjustment.description} className={ledgerRowClass}>
              <span className="min-w-0">{adjustment.description}</span>
              <span className="tabular shrink-0">{formatBRL(`-${adjustment.amount}`)}</span>
            </li>
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
  const confirming = useInPlace()
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
        (confirming.open ? (
          <VoidConfirmation
            amounts={amounts}
            onConfirm={voidGroup}
            onCancel={() => confirming.close()}
          />
        ) : (
          <button
            ref={confirming.buttonRef}
            type="button"
            onClick={confirming.show}
            className={textButton}
          >
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

function VoidConfirmation({
  amounts,
  onConfirm,
  onCancel,
}: {
  amounts: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const questionRef = useFocusOnMount<HTMLParagraphElement>()
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <p ref={questionRef} tabIndex={-1} className="w-full text-sm">
        Anular este pagamento? O valor volta para a conta e a fatura fica em aberto de novo.
      </p>
      <button type="button" onClick={onConfirm} className={primaryButtonClass}>
        Anular pagamento de {amounts}
      </button>
      <button type="button" onClick={onCancel} className={secondaryButtonClass}>
        Cancelar
      </button>
    </div>
  )
}

/** "Editar datas": quando o banco muda o fechamento ou o vencimento de uma fatura. */
function InvoiceDates({ invoice }: { invoice: InvoiceSummaryOut }) {
  const id = useId()
  const editing = useInPlace()
  const closingRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing.open) closingRef.current?.focus()
  }, [editing.open])
  const [closing, setClosing] = useState(invoice.closing_date)
  const [due, setDue] = useState(invoice.due_date)
  const [error, setError] = useState<string | null>(null)
  const invalidate = useInvalidateLedger()

  if (!editing.open || invoice.id === null) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
        Fechamento {shortDate(invoice.closing_date)}, vencimento {shortDate(invoice.due_date)}
        {invoice.id !== null && (
          <button
            ref={editing.buttonRef}
            type="button"
            onClick={editing.show}
            className={textButton}
          >
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
      editing.close()
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
            ref={closingRef}
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
        <button type="button" onClick={() => editing.close()} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
