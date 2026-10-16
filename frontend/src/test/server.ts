import { setupServer } from 'msw/node'

/** Servidor MSW compartilhado; cada teste registra seus handlers com `server.use(...)`. */
export const server = setupServer()
