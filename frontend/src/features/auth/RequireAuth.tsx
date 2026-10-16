import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { ApiError } from '../../api/client'
import { useMe } from '../../api/queries'
import { secondaryButtonClass } from '../../ui/styles'

/** Só mostra o conteúdo com sessão válida; sem sessão, vai ao login lembrando de onde veio. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) {
    return (
      <p role="status" className="p-6 text-ink-soft">
        Carregando…
      </p>
    )
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />
    }
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p>Não foi possível carregar seus dados. Verifique a conexão e tente de novo.</p>
        <button type="button" onClick={() => me.refetch()} className={secondaryButtonClass}>
          Tentar de novo
        </button>
      </div>
    )
  }
  return children
}
