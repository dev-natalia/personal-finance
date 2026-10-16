import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'

import { createQueryClient } from '../api/queryClient'

/**
 * Renderiza com cache de consultas novo, com a mesma configuração do app (só sem novas
 * tentativas, para os testes não esperarem), e roteador em memória.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = createQueryClient()
  const defaults = queryClient.getDefaultOptions()
  queryClient.setDefaultOptions({
    queries: { ...defaults.queries, retry: false },
    mutations: { ...defaults.mutations, retry: false },
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
}
