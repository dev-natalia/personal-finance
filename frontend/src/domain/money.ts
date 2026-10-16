/**
 * Dinheiro como string canônica da API ("1234.56"). Mesmas regras do backend
 * (app/domain/money.py), feitas só com texto: o valor nunca vira número de ponto flutuante.
 */

export class InvalidMoney extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMoney'
  }
}

const ALLOWED = /^[0-9.,]+$/
const DIGITS = /^[0-9]+$/
const THOUSANDS = /^[0-9]{1,3}(?:\.[0-9]{3})+$/
const MAX_INTEGER_DIGITS = 12

function integerPart(text: string): string {
  if (DIGITS.test(text)) return text
  if (THOUSANDS.test(text)) return text.replaceAll('.', '')
  throw new InvalidMoney(`Parte inteira inválida: ${text}`)
}

function canonical(integer: string, fraction: string): string {
  const trimmed = integer.replace(/^0+(?=[0-9])/, '')
  if (trimmed.length > MAX_INTEGER_DIGITS) throw new InvalidMoney('Valor acima do máximo permitido.')
  return `${trimmed}.${fraction.padEnd(2, '0')}`
}

/**
 * Interpreta valores digitados em pt-BR: 42 · 42,50 · 42.50 · 1.234,56 · R$ 42.
 * Com vírgula, ela é o decimal e pontos são milhar. Sem vírgula, um ponto seguido de
 * 1 ou 2 dígitos é decimal; de 3 dígitos, é milhar. Mais de 2 casas é recusado.
 */
export function parseMoney(text: string): string {
  const cleaned = text.trim().replace(/^r\$\s*/i, '')
  if (!cleaned || !ALLOWED.test(cleaned)) throw new InvalidMoney(`Valor inválido: ${text}`)

  if (cleaned.includes(',')) {
    const [integer = '', decimals = '', ...rest] = cleaned.split(',')
    if (rest.length > 0 || !DIGITS.test(decimals)) throw new InvalidMoney(`Valor inválido: ${text}`)
    if (decimals.length > 2) throw new InvalidMoney('O valor tem mais de 2 casas decimais.')
    return canonical(integerPart(integer), decimals)
  }

  const parts = cleaned.split('.')
  if (parts.length === 2) {
    const [integer = '', fraction = ''] = parts
    if (!integer) throw new InvalidMoney(`Valor inválido: ${text}`)
    if (fraction.length === 1 || fraction.length === 2) return canonical(integer, fraction)
    if (fraction.length === 3 && integer.length <= 3) return canonical(integer + fraction, '')
    throw new InvalidMoney(`Valor inválido: ${text}`)
  }
  return canonical(integerPart(cleaned), '')
}

export function tryParseMoney(text: string): string | null {
  try {
    return parseMoney(text)
  } catch (error) {
    if (error instanceof InvalidMoney) return null
    throw error
  }
}

/** Como `tryParseMoney`, mas aceita um "-" inicial (saldo de abertura no cheque especial). */
export function tryParseSignedMoney(text: string): string | null {
  const trimmed = text.trim()
  const negative = trimmed.startsWith('-')
  const amount = tryParseMoney(negative ? trimmed.slice(1) : trimmed)
  if (amount === null) return null
  return negative && /[1-9]/.test(amount) ? `-${amount}` : amount
}

/** Verdadeiro se a string canônica tem algum dígito diferente de zero. */
export function isPositive(amount: string): boolean {
  return !amount.startsWith('-') && /[1-9]/.test(amount)
}

/** "-1234.5" → "−R$ 1.234,50": negativos com o sinal de menos tipográfico, não só com cor. */
export function formatBRL(amount: string): string {
  const negative = amount.startsWith('-')
  const [integer = '0', fraction = ''] = amount.replace(/^-/, '').split('.')
  const cents = fraction.padEnd(2, '0').slice(0, 2)
  const grouped = integer.replace(/\B(?=([0-9]{3})+(?![0-9]))/g, '.')
  const isZero = !/[1-9]/.test(integer + cents)
  return `${negative && !isZero ? '−' : ''}R$ ${grouped},${cents}`
}

/** "42.50" → "42,50", para mostrar num campo editável. */
export function toInputAmount(amount: string): string {
  return amount.replace('.', ',')
}
