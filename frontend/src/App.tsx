import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'

import { createQueryClient } from './api/queryClient'
import { AppRoutes } from './routes'

const queryClient = createQueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
