import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  InvalidMoney,
  addMoney,
  formatBRL,
  formatBRLNoBreak,
  isPositive,
  multiplyMoney,
  parseMoney,
  subtractMoney,
  toInputAmount,
  tryParseMoney,
  tryParseSignedMoney,
} from './money'

describe('parseMoney', () => {
  test.each([
    ['42', '42.00'],
    ['42,5', '42.50'],
    ['42,50', '42.50'],
    ['42.50', '42.50'],
    ['42.5', '42.50'],
    ['1.234', '1234.00'],
    ['1.234,56', '1234.56'],
    ['12.345.678,90', '12345678.90'],
    ['R$ 42', '42.00'],
    ['r$42,10', '42.10'],
    ['  7 ', '7.00'],
    ['0,01', '0.01'],
    ['1234', '1234.00'],
    ['1234,5', '1234.50'],
    ['007', '7.00'],
    ['999.999.999.999,99', '999999999999.99'],
  ])('accepts %j as %j', (text, expected) => {
    expect(parseMoney(text)).toBe(expected)
  })

  test.each([
    '',
    'abc',
    '42,505',
    '42.505.1',
    '1.2345',
    '1234.567',
    ',50',
    '42,',
    '42.',
    '1,2,3',
    '-5',
    '12.34,56',
    '1.23.456',
    '999.999.999.999,991',
    '1.000.000.000.000,00',
    '٤٢',
  ])('rejects %j', (text) => {
    expect(() => parseMoney(text)).toThrow(InvalidMoney)
  })
})

test('tryParseMoney returns null instead of throwing', () => {
  expect(tryParseMoney('abc')).toBeNull()
  expect(tryParseMoney('42,5')).toBe('42.50')
})

test('isPositive', () => {
  expect(isPositive('0.00')).toBe(false)
  expect(isPositive('0.01')).toBe(true)
})

test.each([
  ['0', 'R$ 0,00'],
  ['42.5', 'R$ 42,50'],
  ['1234.56', 'R$ 1.234,56'],
  ['1000000', 'R$ 1.000.000,00'],
  ['-32.00', '−R$ 32,00'],
  ['-0.00', 'R$ 0,00'],
])('formatBRL(%j) is %j', (amount, expected) => {
  expect(formatBRL(amount)).toBe(expected)
})

test('toInputAmount uses the Brazilian decimal comma', () => {
  expect(toInputAmount('42.50')).toBe('42,50')
})

test('money module never converts money to number', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/domain/money.ts'), 'utf-8')
  expect(source).not.toMatch(/parseFloat|Number\(|toFixed/)
})

test('tryParseSignedMoney accepts a leading minus', () => {
  expect(tryParseSignedMoney('-250')).toBe('-250.00')
  expect(tryParseSignedMoney(' -1.234,5')).toBe('-1234.50')
  expect(tryParseSignedMoney('1.000,50')).toBe('1000.50')
  expect(tryParseSignedMoney('-0')).toBe('0.00')
  expect(tryParseSignedMoney('--5')).toBeNull()
  expect(tryParseSignedMoney('abc')).toBeNull()
})

test('formatBRLNoBreak keeps the currency with the number', () => {
  expect(formatBRLNoBreak('2300')).toBe('R$\u00a02.300,00')
})

test('addMoney and subtractMoney work on canonical strings', () => {
  expect(addMoney('1000.00', '1300.50')).toBe('2300.50')
  expect(addMoney('0.10', '0.20')).toBe('0.30')
  expect(addMoney('999999999999.99', '0.01')).toBe('1000000000000.00')
  expect(subtractMoney('2300.00', '1000.00')).toBe('1300.00')
  expect(subtractMoney('1000.00', '2300.00')).toBe('-1300.00')
  expect(subtractMoney('-5.00', '0.05')).toBe('-5.05')
  expect(subtractMoney('5.00', '5.00')).toBe('0.00')
})

test('multiplyMoney multiplies by a whole count', () => {
  expect(multiplyMoney('245.50', 6)).toBe('1473.00')
  expect(multiplyMoney('0.33', 3)).toBe('0.99')
})
