import axe from 'axe-core'
import { expect } from 'vitest'

/**
 * Falha o teste se o axe encontrar violações de acessibilidade.
 * `color-contrast` fica de fora (o jsdom não calcula cores) e `region` também
 * (o container do teste não é a página inteira).
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
}
