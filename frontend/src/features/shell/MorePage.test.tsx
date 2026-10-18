import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { expect, test } from 'vitest'

import { expectNoA11yViolations } from '../../test/axe'
import { USER } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { MorePage } from './MorePage'

function mockMore(backup: { last_success_at: string | null; stale: boolean }) {
  server.use(
    http.get('/api/v1/auth/me', () => HttpResponse.json(USER)),
    http.get('/api/v1/backup-status', () => HttpResponse.json(backup)),
  )
}

test('more page shows last backup', async () => {
  mockMore({ last_success_at: '2026-10-15T06:00:00Z', stale: false })
  const { container } = renderWithProviders(<MorePage />, { route: '/mais' })
  // 06:00 UTC = 03:00 em São Paulo, o fuso da usuária.
  expect(await screen.findByText('Último backup: 15/10 às 03:00')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Frases não entendidas' })).toHaveAttribute(
    'href',
    '/mais/frases',
  )
  await expectNoA11yViolations(container)
})

test('more page says when there was no backup yet', async () => {
  mockMore({ last_success_at: null, stale: true })
  renderWithProviders(<MorePage />, { route: '/mais' })
  expect(await screen.findByText('Nenhum backup ainda')).toBeInTheDocument()
})
