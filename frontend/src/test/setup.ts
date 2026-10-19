import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'

// Com a suíte inteira em paralelo, o primeiro teste de um arquivo pesado pode passar de 1 s
// esperando a tela (o padrão do Testing Library) e falhar sem erro de verdade.
configure({ asyncUtilTimeout: 3000 })

// Toda chamada à API nos testes precisa de um handler explícito.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  sessionStorage.clear()
})
afterAll(() => server.close())
