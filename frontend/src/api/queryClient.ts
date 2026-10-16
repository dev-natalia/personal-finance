import { QueryClient } from '@tanstack/react-query'

import { ApiError } from './client'

/** Erros 4xx (regra de negócio, sessão) não melhoram tentando de novo; falhas de rede e 5xx sim. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
          failureCount < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
}
