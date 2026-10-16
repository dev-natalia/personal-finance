import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { expect, test } from 'vitest'

import { AppRoutes } from '../../routes'
import { expectNoA11yViolations } from '../../test/axe'
import { USER } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'

// Uma resposta nova a cada chamada: o corpo de uma Response só pode ser lido uma vez.
const unauthenticated = () =>
  HttpResponse.json(
    { status: 401, code: 'unauthenticated', detail: 'Sessão inválida ou expirada.' },
    { status: 401 },
  )

/** Começa deslogada; após um login bem-sucedido, /auth/me passa a responder a usuária. */
function signedOutUntilLogin() {
  let signedIn = false
  server.use(
    http.get('/api/v1/auth/me', () => (signedIn ? HttpResponse.json(USER) : unauthenticated())),
    http.post('/api/v1/auth/login', async ({ request }) => {
      const body = (await request.json()) as { password: string }
      if (body.password !== 'senha-certa-123') {
        return HttpResponse.json(
          { status: 401, code: 'invalid_credentials', detail: 'E-mail ou senha incorretos.' },
          { status: 401 },
        )
      }
      signedIn = true
      return HttpResponse.json(USER)
    }),
    http.post('/api/v1/auth/logout', () => {
      signedIn = false
      return new HttpResponse(null, { status: 204 })
    }),
  )
}

async function fillLogin(password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('E-mail'), 'ana@example.com')
  await user.type(screen.getByLabelText('Senha'), password)
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
}

test('unauthenticated visit shows the login page', async () => {
  signedOutUntilLogin()
  renderWithProviders(<AppRoutes />, { route: '/' })
  expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
})

test('login page has no accessibility violations', async () => {
  signedOutUntilLogin()
  const { container } = renderWithProviders(<AppRoutes />, { route: '/login' })
  await screen.findByRole('heading', { name: 'Entrar' })
  await expectNoA11yViolations(container)
})

test('successful login goes to the requested page', async () => {
  signedOutUntilLogin()
  renderWithProviders(<AppRoutes />, { route: '/contas' })
  await fillLogin('senha-certa-123')
  expect(await screen.findByRole('heading', { name: 'Contas' })).toBeInTheDocument()
})

test('wrong password shows the server message', async () => {
  signedOutUntilLogin()
  renderWithProviders(<AppRoutes />, { route: '/login' })
  await fillLogin('senha-errada-000')
  expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
})

test('navigation exposes the main sections', async () => {
  server.use(http.get('/api/v1/auth/me', () => HttpResponse.json(USER)))
  renderWithProviders(<AppRoutes />, { route: '/' })
  const nav = await screen.findByRole('navigation', { name: 'Principal' })
  for (const name of ['Início', 'Lançamentos', 'Contas', 'Mais']) {
    expect(nav).toContainElement(screen.getByRole('link', { name }))
  }
})

test('logout returns to login', async () => {
  signedOutUntilLogin()
  renderWithProviders(<AppRoutes />, { route: '/mais' })
  await fillLogin('senha-certa-123')
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Sair' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument())
})

test('server failure offers a retry instead of the login page', async () => {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({ status: 500, code: 'internal_error', detail: 'x' }, { status: 500 }),
    ),
  )
  renderWithProviders(<AppRoutes />, { route: '/' })
  expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
})
