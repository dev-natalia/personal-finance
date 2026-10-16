import { expect, test } from 'vitest'

import { normalize } from './text'

test.each([
  ['DROGASIL', 'drogasil'],
  ['Pão-de-Açúcar!', 'pao de acucar'],
  ['  Uber   Eats ', 'uber eats'],
  ['Itaú', 'itau'],
  ['!!!', ''],
])('normalize(%j) is %j', (raw, expected) => {
  expect(normalize(raw)).toBe(expected)
})
