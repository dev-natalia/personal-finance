import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useCardInvoices, useCardsSummary, useInvalidateLedger } from '../../api/queries'
import type { CardOut, CardSummaryOut, InvoiceSummaryOut } from '../../api/types'
import { addDays, monthName, shortDate } from '../../domain/dates'
import { INVOICE_STATE_LABELS } from '../../domain/labels'
import { formatBRL, formatBRLNoBreak, isPositive, tryParseMoney } from '../../domain/money'
import { type Announce, useStatus } from '../../ui/focus'
import { Field } from '../../ui/Field'
import { MoneyInput } from '../../ui/MoneyInput'
import { Page } from '../../ui/Page'
import {
  errorTextClass,
  inputClass,
  ledgerRowClass,
  linkClass,
  primaryButtonClass,
  secondaryButtonClass,
  slipClass,
} from '../../ui/styles'
import { ChargeForm } from './ChargeForm'
import { InvoiceDetails } from './InvoiceDetails'
import { InvoicePaymentForm } from './InvoicePaymentForm'
import { DaySelect } from './NewCardForm'

const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'
const summaryClass = 'flex min-h-11 cursor-pointer items-center py-2 font-[650] text-pen'

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
}

/** "Fatura de outubro, fechada". */
function invoiceTitle(invoice: InvoiceSummaryOut): string {
  return `Fatura de ${monthName(invoice.reference_month)}, ${INVOICE_STATE_LABELS[invoice.state]}`
}

/** "2380.00" → "2.380,00": o valor como se digita no campo. */
function inputAmount(amount: string): string {
  return formatBRL(amount).replace('R$ ', '')
}

/** Tela de um cartão: fatura aberta e limite no topo, conferência da fechada, histórico. */
export function CardPage() {
  const { id = '' } = useParams()
  const summary = useCardsSummary()
  const { announce, status } = useStatus()
  const current = summary.data?.find((s) => s.card.id === id)

  if (summary.isPending) {
    return (
      <Page title="Cartão">
        <p className="text-ink-soft">Carregando…</p>
      </Page>
    )
  }
  if (!current) {
    return (
      <Page title="Cartão">
        <p className="mb-3">Cartão não encontrado. Ele pode ter sido arquivado.</p>
        <Link to="/contas" className={linkClass}>
          Ver contas e cartões
        </Link>
      </Page>
    )
  }

  const { card, open_invoice: open, payable, future, limit } = current
  return (
    <Page title={card.name}>
      {status}
      <OpenInvoice open={open} limit={limit} />
      {payable && <PayButton card={card} invoice={payable} onMessage={announce} />}
      {payable && <PayableInvoice card={card} invoice={payable} onMessage={announce} />}

      <div className="mt-6 border-t border-rule">
        <Collapsible title="Faturas futuras">
          {future.length === 0 ? (
            <p className="pb-3 text-sm text-ink-soft">Nenhuma parcela em faturas futuras.</p>
          ) : (
            <ul aria-label="Faturas futuras" className="pb-3">
              {future.map((invoice) => (
                <li key={invoice.reference_month} className="tabular py-1">
                  {monthName(invoice.reference_month)}: {formatBRLNoBreak(invoice.total)}
                </li>
              ))}
            </ul>
          )}
        </Collapsible>
        <Collapsible title="Compras desta fatura" lazy>
          {open.id === null ? (
            <p className="pb-3 text-sm text-ink-soft">Nenhuma compra nesta fatura ainda.</p>
          ) : (
            <InvoiceDetails invoiceId={open.id} onMessage={announce} />
          )}
        </Collapsible>
        <Collapsible title="Faturas anteriores" lazy>
          <PreviousInvoices cardId={card.id} onMessage={announce} />
        </Collapsible>
      </div>

      <CardFooter card={card} onMessage={announce} />
    </Page>
  )
}

function OpenInvoice({
  open,
  limit,
}: {
  open: InvoiceSummaryOut
  limit: CardSummaryOut['limit']
}) {
  return (
    <section aria-label="Fatura aberta e limite" className={slipClass}>
      <p className="text-ink-soft">{invoiceTitle(open)}</p>
      <p className="tabular text-3xl font-[650]">{formatBRL(open.total)}</p>
      <p className="mb-4 text-sm text-ink-soft">
        Fecha em {shortDate(open.closing_date)}, vence em {shortDate(open.due_date)}
      </p>
      <meter
        aria-label="Limite usado"
        aria-valuenow={Number(limit.used)}
        min={0}
        max={Number(limit.limit)}
        value={Number(limit.used)}
        className="h-3 w-full"
      />
      <p className="tabular mt-1 text-sm">
        Limite usado {formatBRLNoBreak(limit.used)}, disponível {formatBRLNoBreak(limit.available)}
      </p>
    </section>
  )
}

/** "Pagar fatura de outubro": abre o formulário na própria página. */
function PayButton({
  card,
  invoice,
  onMessage,
}: {
  card: CardOut
  invoice: InvoiceSummaryOut
  onMessage: Announce
}) {
  const [paying, setPaying] = useState(false)
  const label = `Pagar fatura de ${monthName(invoice.reference_month)}`
  if (!paying) {
    return (
      <button type="button" onClick={() => setPaying(true)} className={`${primaryButtonClass} mt-4`}>
        {label}
      </button>
    )
  }
  return (
    <InvoicePaymentForm
      invoice={invoice}
      cardName={card.name}
      onCancel={() => setPaying(false)}
      onDone={(message) => {
        setPaying(false)
        onMessage(message, { focus: true })
      }}
    />
  )
}

/** Fatura fechada ainda a pagar: o total calculado aqui contra o que o banco mostra. */
function PayableInvoice({
  card,
  invoice,
  onMessage,
}: {
  card: CardOut
  invoice: InvoiceSummaryOut
  onMessage: Announce
}) {
  const headingId = useId()
  const [charging, setCharging] = useState(false)
  // Compra esquecida entra na véspera do fechamento; antes do início do cartão o backend
  // recusa (a fatura fechada do cadastro é só o total informado).
  const purchaseDate = addDays(invoice.closing_date, -1)
  const canRegister = purchaseDate >= card.opening_date
  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} className="mb-1 text-lg font-[650]">
        {invoiceTitle(invoice)}
      </h2>
      <p className="text-sm text-ink-soft">Vence em {shortDate(invoice.due_date)}</p>
      <p className="tabular mt-2">Calculado aqui {formatBRLNoBreak(invoice.total)}</p>
      {invoice.id !== null && (
        <ReportedTotal key={invoice.id} invoiceId={invoice.id} card={card} invoice={invoice} />
      )}
      <Difference amount={invoice.difference} />
      {!canRegister && (
        <p className="mt-2 text-sm text-ink-soft">
          Esta fatura veio do total informado ao cadastrar o cartão; compras antes de{' '}
          {shortDate(card.opening_date)} não entram no app.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {canRegister && (
          <Link
            to={`/lancamentos/novo?card=${card.id}&date=${purchaseDate}`}
            className={`${textButton} inline-flex items-center`}
          >
            Registrar compra
          </Link>
        )}
        {!charging && (
          <button type="button" onClick={() => setCharging(true)} className={textButton}>
            Registrar encargo
          </button>
        )}
      </div>
      {charging && (
        <ChargeForm
          cardId={card.id}
          onCancel={() => setCharging(false)}
          onDone={(message) => {
            setCharging(false)
            onMessage(message)
          }}
        />
      )}
    </section>
  )
}

/** "Total no Nubank": salva ao sair do campo; vazio apaga o valor informado. */
function ReportedTotal({
  invoiceId,
  card,
  invoice,
}: {
  invoiceId: string
  card: CardOut
  invoice: InvoiceSummaryOut
}) {
  const id = useId()
  const invalidate = useInvalidateLedger()
  const saved = invoice.reported_total
  const [value, setValue] = useState(saved ? inputAmount(saved) : '')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const trimmed = value.trim()
    const reported = trimmed === '' ? null : tryParseMoney(trimmed)
    if (trimmed !== '' && reported === null) {
      setError('Use um valor como 1.234,56.')
      return
    }
    setError(null)
    if (reported === saved) return
    try {
      await api.updateInvoice(invoiceId, { reported_total: reported })
      await invalidate()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <div className="mt-2 max-w-xs" onBlur={save}>
      <MoneyInput
        id={id}
        label={`Total no ${card.name}`}
        value={value}
        onChange={setValue}
        error={error}
      />
    </div>
  )
}

/** A frase da conferência: positiva quando o banco cobra mais do que foi registrado aqui. */
function Difference({ amount }: { amount: string | null }) {
  if (amount === null) return null
  const absolute = formatBRLNoBreak(amount.replace(/^-/, ''))
  let text = 'Confere com o total do banco.'
  if (isPositive(amount)) text = `Faltam ${absolute}: alguma compra pode não ter sido registrada.`
  else if (amount.startsWith('-')) text = `Sobram ${absolute}: confira se alguma compra foi registrada em dobro.`
  return <p className="mt-2 border-l-4 border-pen bg-slip px-3 py-2 text-sm">{text}</p>
}

/** Seção recolhível; com `lazy`, o conteúdo só é montado (e buscado) ao abrir. */
function Collapsible({
  title,
  lazy = false,
  children,
}: {
  title: string
  lazy?: boolean
  children: ReactNode
}) {
  const [opened, setOpened] = useState(false)
  return (
    <details
      className="border-b border-rule"
      onToggle={(e) => setOpened(opened || e.currentTarget.open)}
    >
      <summary className={summaryClass}>{title}</summary>
      {(!lazy || opened) && children}
    </details>
  )
}

/** Faturas anteriores, das mais novas às mais antigas, em páginas. */
function PreviousInvoices({ cardId, onMessage }: { cardId: string; onMessage: Announce }) {
  const first = useCardInvoices(cardId)
  const [older, setOlder] = useState<InvoiceSummaryOut[]>([])
  const [nextBefore, setNextBefore] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  if (first.isPending) return <p className="pb-3 text-sm text-ink-soft">Carregando…</p>
  if (first.isError) return <p className={errorTextClass}>{messageOf(first.error)}</p>

  const invoices = [...first.data.previous, ...older]
  const cursor = nextBefore === undefined ? first.data.next_before : nextBefore

  async function loadMore() {
    if (!cursor) return
    try {
      const page = await api.cardInvoices(cardId, cursor)
      setOlder((current) => [...current, ...page.previous])
      setNextBefore(page.next_before)
    } catch (err) {
      setError(messageOf(err))
    }
  }

  if (invoices.length === 0) {
    return <p className="pb-3 text-sm text-ink-soft">Nenhuma fatura anterior.</p>
  }
  return (
    <div className="pb-3">
      <ul aria-label="Faturas anteriores">
        {invoices.map((invoice) => (
          <li key={invoice.reference_month} className="border-b border-rule last:border-b-0">
            <PreviousInvoice invoice={invoice} onMessage={onMessage} />
          </li>
        ))}
      </ul>
      {cursor && (
        <button type="button" onClick={loadMore} className={`${secondaryButtonClass} mt-3`}>
          Mostrar faturas mais antigas
        </button>
      )}
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
    </div>
  )
}

function PreviousInvoice({
  invoice,
  onMessage,
}: {
  invoice: InvoiceSummaryOut
  onMessage: Announce
}) {
  const [opened, setOpened] = useState(false)
  return (
    <details onToggle={(e) => setOpened(opened || e.currentTarget.open)}>
      <summary className={`${ledgerRowClass} cursor-pointer border-b-0`}>
        <span>{invoiceTitle(invoice)}</span>
        <span className="tabular">{formatBRL(invoice.total)}</span>
      </summary>
      {opened && invoice.id !== null && (
        <div className="mb-3 border-l-2 border-rule pl-3">
          <InvoiceDetails invoiceId={invoice.id} onMessage={onMessage} />
        </div>
      )}
    </details>
  )
}

function CardFooter({ card, onMessage }: { card: CardOut; onMessage: Announce }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'archive'>('view')
  const [error, setError] = useState<string | null>(null)
  const invalidate = useInvalidateLedger()
  const navigate = useNavigate()

  async function archive() {
    try {
      const result = await api.archiveCard(card.id)
      const message = result.warnings[0]?.detail ?? `Cartão ${card.name} arquivado.`
      await navigate('/contas', { state: { message } })
      await invalidate()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <footer className="mt-10 border-t border-rule pt-4">
      {mode === 'edit' && (
        <EditCardForm
          card={card}
          onDone={(message) => {
            setMode('view')
            if (message) onMessage(message)
          }}
        />
      )}
      {mode === 'archive' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="w-full text-sm">
            Arquivar {card.name}? Ele some das listas e não aceita novas compras; as faturas
            continuam no histórico.
          </p>
          <button type="button" onClick={archive} className={primaryButtonClass}>
            Arquivar {card.name}
          </button>
          <button type="button" onClick={() => setMode('view')} className={secondaryButtonClass}>
            Cancelar
          </button>
        </div>
      )}
      {mode === 'view' && (
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setMode('edit')} className={textButton}>
            Editar cartão
          </button>
          <button type="button" onClick={() => setMode('archive')} className={textButton}>
            Arquivar cartão
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={errorTextClass}>
          {error}
        </p>
      )}
    </footer>
  )
}

/** Envia só o que mudou: mudar os dias recalcula as faturas abertas no servidor. */
function EditCardForm({
  card,
  onDone,
}: {
  card: CardOut
  onDone: (message: string | null) => void
}) {
  const id = useId()
  const invalidate = useInvalidateLedger()
  const [name, setName] = useState(card.name)
  const [limit, setLimit] = useState(inputAmount(card.credit_limit))
  const [closingDay, setClosingDay] = useState(String(card.closing_day))
  const [dueDay, setDueDay] = useState(String(card.due_day))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const creditLimit = tryParseMoney(limit)
    const local: Record<string, string> = {}
    if (name.trim() === '') local.name = 'Informe um nome.'
    if (creditLimit === null || !isPositive(creditLimit)) {
      local.credit_limit = 'Informe um limite maior que zero.'
    }
    setErrors(local)
    if (Object.keys(local).length > 0 || creditLimit === null) return

    const patch = {
      ...(name.trim() !== card.name ? { name: name.trim() } : {}),
      ...(creditLimit !== card.credit_limit ? { credit_limit: creditLimit } : {}),
      ...(Number(closingDay) !== card.closing_day ? { closing_day: Number(closingDay) } : {}),
      ...(Number(dueDay) !== card.due_day ? { due_day: Number(dueDay) } : {}),
    }
    if (Object.keys(patch).length === 0) {
      onDone(null)
      return
    }
    try {
      await api.updateCard(card.id, patch)
      await invalidate()
      onDone('Cartão atualizado.')
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])))
      }
      setFormError(messageOf(err))
    }
  }

  return (
    <form aria-label="Editar cartão" onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field id={`${id}-name`} label="Nome do cartão" error={errors.name}>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>
      <MoneyInput
        id={`${id}-limit`}
        label="Limite"
        value={limit}
        onChange={setLimit}
        error={errors.credit_limit}
      />
      <div className="grid grid-cols-2 gap-3">
        <DaySelect
          id={`${id}-closing`}
          label="Fecha no dia"
          value={closingDay}
          onChange={setClosingDay}
          error={errors.closing_day}
        />
        <DaySelect
          id={`${id}-due`}
          label="Vence no dia"
          value={dueDay}
          onChange={setDueDay}
          error={errors.due_day}
        />
      </div>
      {formError && (
        <p role="alert" className={errorTextClass}>
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <button type="button" onClick={() => onDone(null)} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
