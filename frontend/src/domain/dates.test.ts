import { describe, expect, test } from 'vitest'

import { addDays, dayAndTime, dayLabel, firstDayOfMonth, matchDate, shortDate, weekdayIndex } from './dates'

const TODAY = '2026-10-15'

describe('matchDate', () => {
  test.each([
    [['hoje'], '2026-10-15'],
    [['ontem'], '2026-10-14'],
    [['anteontem'], '2026-10-13'],
  ])('%j is a relative day', (words, expected) => {
    expect(matchDate(words, 0, TODAY)).toEqual({ date: expected, consumed: 1 })
  })

  test('"dia N" in the current month consumes two words', () => {
    expect(matchDate(['dia', '3'], 0, TODAY)).toEqual({ date: '2026-10-03', consumed: 2 })
  })

  test('day of month in the future or missing falls back to previous month', () => {
    expect(matchDate(['dia', '20'], 0, TODAY)).toEqual({ date: '2026-09-20', consumed: 2 })
    expect(matchDate(['dia', '31'], 0, '2026-11-15')).toEqual({
      date: '2026-10-31',
      consumed: 2,
    })
    expect(matchDate(['dia', '15'], 0, '2026-01-10')).toEqual({
      date: '2025-12-15',
      consumed: 2,
    })
  })

  test('D/M uses the current year, or the previous one when in the future', () => {
    expect(matchDate(['3/10'], 0, TODAY)).toEqual({ date: '2026-10-03', consumed: 1 })
    expect(matchDate(['20/12'], 0, TODAY)).toEqual({ date: '2025-12-20', consumed: 1 })
  })

  test('invalid or unrelated words do not match', () => {
    expect(matchDate(['31/02'], 0, TODAY)).toBeNull()
    expect(matchDate(['dia'], 0, TODAY)).toBeNull()
    expect(matchDate(['dia', '40'], 0, TODAY)).toBeNull()
    expect(matchDate(['mercado'], 0, TODAY)).toBeNull()
    expect(matchDate([], 0, TODAY)).toBeNull()
  })

  test('reads from the given index', () => {
    expect(matchDate(['42', 'mercado', 'ontem'], 2, TODAY)).toEqual({
      date: '2026-10-14',
      consumed: 1,
    })
  })
})

test('addDays crosses months and leap years', () => {
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
})

test('firstDayOfMonth', () => {
  expect(firstDayOfMonth(TODAY)).toBe('2026-10-01')
})

test.each([
  ['2026-10-15', 'Hoje'],
  ['2026-10-14', 'Ontem'],
  ['2026-10-03', '03/10'],
  ['2025-12-20', '20/12/2025'],
])('dayLabel(%j) is %j', (iso, expected) => {
  expect(dayLabel(iso, TODAY)).toBe(expected)
})

test('shortDate shows day and month', () => {
  expect(shortDate('2026-11-03')).toBe('03/11')
})

test('weekdayIndex counts from monday', () => {
  expect(weekdayIndex('2026-10-12')).toBe(0) // segunda
  expect(weekdayIndex('2026-10-01')).toBe(3) // quinta
  expect(weekdayIndex('2026-10-18')).toBe(6) // domingo
})

test('dayAndTime shows the instant in the given time zone', () => {
  expect(dayAndTime('2026-10-15T06:00:00Z', 'America/Sao_Paulo')).toBe('15/10 às 03:00')
  expect(dayAndTime('2026-10-15T02:30:00Z', 'America/Sao_Paulo')).toBe('14/10 às 23:30')
})
