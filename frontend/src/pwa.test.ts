import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'vitest'

// jsdom não expõe import.meta.url como caminho de arquivo; os testes rodam a partir de frontend/.
const root = process.cwd()
const config = readFileSync(join(root, 'vite.config.ts'), 'utf-8')

test('service worker never serves /api from the app shell', () => {
  expect(config).toContain('navigateFallbackDenylist: [/^\\/api\\//]')
  expect(config).not.toMatch(/runtimeCaching/)
})

test('registration script is an external file allowed by the CSP', () => {
  expect(config).toContain("injectRegister: 'script'")
})

test('manifest makes the app installable', () => {
  expect(config).toContain("display: 'standalone'")
  expect(config).toContain("lang: 'pt-BR'")
  for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    expect(existsSync(join(root, 'public', 'icons', icon)), icon).toBe(true)
    expect(config).toContain(`icons/${icon}`)
  }
})

test('build never inlines assets as data: URIs blocked by the CSP', () => {
  // A CSP do backend é `default-src 'self'`: fontes ou imagens embutidas como data: seriam bloqueadas.
  expect(config).toContain('assetsInlineLimit: 0')
})

test('a new version takes over without waiting for every tab to close', () => {
  expect(config).toContain('skipWaiting: true')
  expect(config).toContain('clientsClaim: true')
  expect(config).toContain('cleanupOutdatedCaches: true')
})
