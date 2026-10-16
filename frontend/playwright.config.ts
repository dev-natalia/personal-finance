import { defineConfig, devices } from '@playwright/test'

/**
 * Smoke ponta a ponta contra a imagem de produção, que já precisa estar no ar.
 * Rodar com `scripts/e2e.sh` (sobe a imagem, cria a usuária e passa as credenciais).
 */
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'celular',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
})
