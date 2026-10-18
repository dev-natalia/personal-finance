import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { expect, test } from 'vitest'

import type { MisreadPhraseOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { USER } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { MisreadPhrasesPage } from './MisreadPhrasesPage'

const PHRASES: MisreadPhraseOut[] = [
  {
    id: 'p2',
    text: 'energético nubank',
    reasons: ['PENDING_AMOUNT', 'CHANGED_DATE'],
    created_at: '2026-10-15T15:00:00Z',
    updated_at: '2026-10-15T15:05:00Z',
  },
  {
    id: 'p1',
    text: 'dia 3:',
    reasons: ['NOTHING_PARSED'],
    created_at: '2026-10-14T12:30:00Z',
    updated_at: '2026-10-14T12:30:00Z',
  },
]

function mockPhrases() {
  let phrases = [...PHRASES]
  const deleted: string[] = []
  server.use(
    http.get('/api/v1/auth/me', () => HttpResponse.json(USER)),
    http.get('/api/v1/misread-phrases', () => HttpResponse.json(phrases)),
    http.delete('/api/v1/misread-phrases/:id', ({ params }) => {
      deleted.push(String(params.id))
      phrases = phrases.filter((p) => p.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('/api/v1/misread-phrases', () => {
      deleted.push('all')
      phrases = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return deleted
}

test('misread phrases page lists and deletes', async () => {
  const deleted = mockPhrases()
  const { container } = renderWithProviders(<MisreadPhrasesPage />, { route: '/mais/frases' })
  const user = userEvent.setup()

  expect(await screen.findByRole('heading', { name: 'Frases não entendidas' })).toBeInTheDocument()
  const items = await screen.findAllByRole('listitem')
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining('energético nubank'),
    expect.stringContaining('dia 3:'),
  ])
  expect(within(items[0]!).getByText('15/10 às 12:05')).toBeInTheDocument()
  expect(within(items[0]!).getByText('Faltou o valor; data corrigida')).toBeInTheDocument()
  expect(within(items[1]!).getByText('Não entendeu nada')).toBeInTheDocument()
  await expectNoA11yViolations(container)

  await user.click(screen.getByRole('button', { name: 'Apagar "dia 3:"' }))
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
  expect(deleted).toEqual(['p1'])

  await user.click(screen.getByRole('button', { name: 'Apagar todas' }))
  const confirm = screen.getByRole('group', { name: 'Apagar todas as frases' })
  expect(deleted).toEqual(['p1'])
  await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(1)

  await user.click(screen.getByRole('button', { name: 'Apagar todas' }))
  await user.click(screen.getByRole('button', { name: 'Apagar todas as frases' }))
  expect(await screen.findByText(/Nenhuma frase por aqui/)).toBeInTheDocument()
  expect(deleted).toEqual(['p1', 'all'])
  expect(screen.queryByRole('button', { name: 'Apagar todas' })).not.toBeInTheDocument()
})
