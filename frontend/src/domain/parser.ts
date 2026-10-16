/**
 * Interpretador simples (sem IA) de frases curtas como "42 mercado pix itaú".
 * Reconhece o que der e marca como pendente o que faltar; o cartão de confirmação completa.
 */

import { matchDate } from './dates'
import { isPositive, tryParseMoney } from './money'
import { normalize } from './text'

export type PaymentMethod = 'PIX' | 'DEBIT' | 'CASH' | 'BOLETO' | 'OTHER' | 'CREDIT'
export type EntryType = 'EXPENSE' | 'INCOME'
export type PendingField = 'amount' | 'description' | 'account' | 'paymentMethod'

export interface EntryAccount {
  id: string
  name: string
  type: 'CHECKING' | 'SAVINGS' | 'CASH'
}

export interface ParseContext {
  today: string
  accounts: EntryAccount[]
}

export interface ParsedItem {
  raw: string
  type: EntryType
  amount: string | null
  description: string | null
  occurredOn: string
  accountId: string | null
  paymentMethod: PaymentMethod | null
  pending: PendingField[]
}

const METHOD_WORDS: Record<string, PaymentMethod> = {
  pix: 'PIX',
  debito: 'DEBIT',
  dinheiro: 'CASH',
  especie: 'CASH',
  boleto: 'BOLETO',
}
const INCOME_VERBS = new Set(['recebi', 'ganhei'])
const EXPENSE_VERBS = new Set(['gastei', 'paguei', 'comprei'])
const FILLERS = new Set([
  'no', 'na', 'nos', 'nas', 'em', 'com', 'via', 'pelo', 'pela',
  'de', 'do', 'da', 'pra', 'para', 'o', 'a', 'um', 'uma', 'e',
])

interface Token {
  original: string
  word: string
  used: boolean
}

export function parseEntry(text: string, ctx: ParseContext): ParsedItem[] {
  const header = dateHeader(text, ctx.today)
  return (header ? header.rest : text)
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parseItem(part, ctx, header?.date ?? ctx.today))
}

/** "dia 3: 35 ifood; 18 uber": uma data antes dos dois-pontos vale para o lote inteiro. */
function dateHeader(text: string, today: string): { date: string; rest: string } | null {
  const match = /^\s*([^;\n:]+):/.exec(text)
  if (!match) return null
  const words = match[1]!.trim().split(/\s+/).map(normalize)
  const date = matchDate(words, 0, today)
  if (!date || date.consumed !== words.length) return null
  return { date: date.date, rest: text.slice(match[0].length) }
}

/** O cabeçalho de data do lote como foi digitado ("dia 3:"), ou `null` se não houver. */
export function batchHeader(text: string, today: string): string | null {
  const header = dateHeader(text, today)
  return header ? text.slice(0, text.length - header.rest.length).trim() : null
}

function parseItem(raw: string, ctx: ParseContext, defaultDate: string): ParsedItem {
  const tokens: Token[] = raw
    .split(/\s+/)
    .map((original) => ({ original, word: normalize(original), used: false }))

  const type = takeType(tokens)
  const occurredOn = takeDate(tokens, ctx.today) ?? defaultDate
  const amount = takeAmount(tokens)
  let accountId = takeAccount(tokens, ctx.accounts)
  let paymentMethod = type === 'EXPENSE' ? takeMethod(tokens) : null

  // Carteira: pagar "em dinheiro" implica a conta de dinheiro, e vice-versa.
  if (type === 'EXPENSE') {
    const cashAccounts = ctx.accounts.filter((a) => a.type === 'CASH')
    if (paymentMethod === 'CASH' && accountId === null && cashAccounts.length === 1) {
      accountId = cashAccounts[0]!.id
    }
    const account = ctx.accounts.find((a) => a.id === accountId)
    if (account?.type === 'CASH' && paymentMethod === null) paymentMethod = 'CASH'
  }

  const description = takeDescription(tokens)
  const pending: PendingField[] = []
  if (amount === null) pending.push('amount')
  if (description === null) pending.push('description')
  if (accountId === null) pending.push('account')
  if (type === 'EXPENSE' && paymentMethod === null) pending.push('paymentMethod')

  return { raw, type, amount, description, occurredOn, accountId, paymentMethod, pending }
}

function takeType(tokens: Token[]): EntryType {
  const first = tokens[0]
  if (!first) return 'EXPENSE'
  if (first.original.startsWith('+')) {
    first.original = first.original.slice(1)
    first.word = normalize(first.original)
    if (!first.original) first.used = true
    return 'INCOME'
  }
  if (INCOME_VERBS.has(first.word)) {
    first.used = true
    return 'INCOME'
  }
  if (EXPENSE_VERBS.has(first.word)) first.used = true
  return 'EXPENSE'
}

function takeDate(tokens: Token[], today: string): string | null {
  const words = tokens.map((t) => (t.used ? '' : t.word))
  for (let index = 0; index < tokens.length; index++) {
    const match = matchDate(words, index, today)
    if (match) {
      for (let k = 0; k < match.consumed; k++) tokens[index + k]!.used = true
      return match.date
    }
  }
  return null
}

function takeAmount(tokens: Token[]): string | null {
  for (const token of tokens) {
    if (!token.used && token.original.toLowerCase() === 'r$') token.used = true
  }
  const candidates = tokens
    .filter((t) => !t.used)
    .map((token) => ({ token, amount: tryParseMoney(token.original) }))
    .filter((c): c is { token: Token; amount: string } => c.amount !== null)
  // Zero ou vários números: o valor fica pendente e os números continuam na descrição.
  if (candidates.length !== 1) return null
  const [only] = candidates
  if (!only || !isPositive(only.amount)) return null
  only.token.used = true
  return only.amount
}

function takeAccount(tokens: Token[], accounts: EntryAccount[]): string | null {
  const byLongestName = [...accounts].sort(
    (a, b) => normalize(b.name).split(' ').length - normalize(a.name).split(' ').length,
  )
  const reserved = new Set<number>()
  const matches: { accountId: string; indices: number[] }[] = []

  for (const account of byLongestName) {
    const nameWords = normalize(account.name).split(' ')
    for (let start = 0; start + nameWords.length <= tokens.length; start++) {
      const indices = nameWords.map((_, k) => start + k)
      const fits = indices.every((i, k) => {
        const token = tokens[i]!
        return !token.used && !reserved.has(i) && token.word === nameWords[k]
      })
      if (fits) {
        indices.forEach((i) => reserved.add(i))
        matches.push({ accountId: account.id, indices })
      }
    }
  }

  const distinct = new Set(matches.map((m) => m.accountId))
  if (distinct.size !== 1) return null
  for (const match of matches) match.indices.forEach((i) => (tokens[i]!.used = true))
  return matches[0]!.accountId
}

function takeMethod(tokens: Token[]): PaymentMethod | null {
  const found = tokens.filter((t) => !t.used && METHOD_WORDS[t.word] !== undefined)
  const distinct = new Set(found.map((t) => METHOD_WORDS[t.word]))
  if (distinct.size !== 1) return null
  found.forEach((t) => (t.used = true))
  return METHOD_WORDS[found[0]!.word]!
}

function takeDescription(tokens: Token[]): string | null {
  const rest = tokens.filter((t) => !t.used && t.original.length > 0)
  while (rest.length > 0 && FILLERS.has(rest[0]!.word)) rest.shift()
  while (rest.length > 0 && FILLERS.has(rest[rest.length - 1]!.word)) rest.pop()
  const description = rest.map((t) => t.original).join(' ').trim()
  return description.length > 0 ? description : null
}
