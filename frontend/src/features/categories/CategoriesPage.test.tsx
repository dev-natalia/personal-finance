import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { expect, test } from 'vitest'

import type { CategoryOut } from '../../api/types'
import { expectNoA11yViolations } from '../../test/axe'
import { CATEGORIES } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { CategoriesPage } from './CategoriesPage'

interface Captured {
  created: unknown[]
  updated: { id: string; body: unknown }[]
  archived: string[]
}

function mockCategories(): Captured {
  const captured: Captured = { created: [], updated: [], archived: [] }
  const byId = (id: string) => CATEGORIES.find((c) => c.id === id)!
  server.use(
    http.get('/api/v1/categories', () => HttpResponse.json(CATEGORIES)),
    http.post('/api/v1/categories', async ({ request }) => {
      const body = (await request.json()) as CategoryOut
      captured.created.push(body)
      if (body.name === 'Mercado') {
        return HttpResponse.json(
          { status: 409, code: 'name_already_exists', detail: 'Já existe uma categoria com esse nome.' },
          { status: 409 },
        )
      }
      return HttpResponse.json(
        { ...body, id: 'cat-new', is_system: false, archived_at: null },
        { status: 201 },
      )
    }),
    http.patch('/api/v1/categories/:id', async ({ params, request }) => {
      const body = (await request.json()) as Partial<CategoryOut>
      captured.updated.push({ id: String(params.id), body })
      return HttpResponse.json({ ...byId(String(params.id)), ...body })
    }),
    http.post('/api/v1/categories/:id/archive', ({ params }) => {
      captured.archived.push(String(params.id))
      return HttpResponse.json({ ...byId(String(params.id)), archived_at: '2026-10-15T15:00:00Z' })
    }),
  )
  return captured
}

function renderPage() {
  const view = renderWithProviders(<CategoriesPage />, { route: '/mais/categorias' })
  return { ...view, user: userEvent.setup() }
}

test('groups categories by kind', async () => {
  mockCategories()
  renderPage()
  const expenses = await screen.findByRole('region', { name: 'Despesas' })
  const incomes = screen.getByRole('region', { name: 'Receitas' })
  expect(await within(expenses).findByText('Mercado')).toBeInTheDocument()
  expect(within(expenses).queryByText('Salário')).not.toBeInTheDocument()
  expect(within(incomes).getByText('Salário')).toBeInTheDocument()
  expect(within(incomes).queryByText('Mercado')).not.toBeInTheDocument()
})

test('system categories cannot be renamed or archived', async () => {
  mockCategories()
  renderPage()
  const expenses = await screen.findByRole('region', { name: 'Despesas' })
  const system = (await within(expenses).findByText('A classificar')).closest('li')!
  expect(within(system).getByText('Do sistema')).toBeInTheDocument()
  expect(within(system).queryByRole('button')).not.toBeInTheDocument()
  expect(within(expenses).getByRole('button', { name: 'Renomear Mercado' })).toBeInTheDocument()
})

test('toggling essential sends is_essential', async () => {
  const captured = mockCategories()
  const { user } = renderPage()
  const saude = await screen.findByRole('checkbox', { name: 'Essencial (Saúde)' })
  expect(saude).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'Essencial (Mercado)' }))
  await waitFor(() =>
    expect(captured.updated).toEqual([{ id: 'cat-mercado', body: { is_essential: true } }]),
  )
})

test('renaming sends the new name', async () => {
  const captured = mockCategories()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Renomear Mercado' }))
  const form = screen.getByRole('form', { name: 'Renomear Mercado' })
  const name = within(form).getByLabelText('Nome')
  await user.clear(name)
  await user.type(name, 'Supermercado')
  await user.click(within(form).getByRole('button', { name: 'Salvar' }))
  await waitFor(() =>
    expect(captured.updated).toEqual([{ id: 'cat-mercado', body: { name: 'Supermercado' } }]),
  )
})

test('archiving asks for confirmation', async () => {
  const captured = mockCategories()
  const { user } = renderPage()
  await user.click(await screen.findByRole('button', { name: 'Arquivar Transporte' }))
  expect(captured.archived).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Arquivar categoria' }))
  await waitFor(() => expect(captured.archived).toEqual(['cat-transporte']))
  expect(await screen.findByRole('status')).toHaveTextContent('Categoria Transporte arquivada.')
})

test('creates an income category', async () => {
  const captured = mockCategories()
  const { user } = renderPage()
  const form = await screen.findByRole('form', { name: 'Nova categoria' })
  await user.type(within(form).getByLabelText('Nome'), 'Freelas')
  await user.selectOptions(within(form).getByLabelText('Tipo'), 'Receita')
  expect(within(form).queryByLabelText('Essencial')).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Criar categoria' }))
  await waitFor(() =>
    expect(captured.created).toEqual([{ name: 'Freelas', kind: 'INCOME', is_essential: false }]),
  )
  expect(await screen.findByRole('status')).toHaveTextContent('Categoria Freelas criada.')
})

test('creating a duplicate shows the server message', async () => {
  mockCategories()
  const { user } = renderPage()
  const form = await screen.findByRole('form', { name: 'Nova categoria' })
  await user.type(within(form).getByLabelText('Nome'), 'Mercado')
  await user.click(within(form).getByLabelText('Essencial'))
  await user.click(within(form).getByRole('button', { name: 'Criar categoria' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent(
    'Já existe uma categoria com esse nome.',
  )
})

test('categories page has no accessibility violations', async () => {
  mockCategories()
  const { container } = renderPage()
  await screen.findByText('Mercado')
  await expectNoA11yViolations(container)
})

test('keyboard focus is kept or returned after each action', async () => {
  mockCategories()
  const { user } = renderPage()
  const essential = await screen.findByRole('checkbox', { name: 'Essencial (Mercado)' })
  await user.click(essential)
  await waitFor(() => expect(essential).toBeChecked())
  expect(essential).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Renomear Mercado' }))
  const form = screen.getByRole('form', { name: 'Renomear Mercado' })
  await user.click(within(form).getByRole('button', { name: 'Cancelar' }))
  expect(screen.getByRole('button', { name: 'Renomear Mercado' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Arquivar Transporte' }))
  await user.click(screen.getByRole('button', { name: 'Arquivar categoria' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
})
