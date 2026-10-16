import { render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { expect, test } from 'vitest'

import { App } from './App'
import { server } from './test/server'

test('signed-out visit shows the login page', async () => {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({ status: 401, code: 'unauthenticated', detail: 'x' }, { status: 401 }),
    ),
  )
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
})
