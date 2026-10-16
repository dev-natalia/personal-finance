import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { UNAUTHENTICATED_EVENT } from '../../api/client'
import { queryKeys } from '../../api/queries'

/**
 * Quando qualquer chamada recebe 401, recarrega a sessão; o RequireAuth então leva ao login.
 * Só age se havia usuária em cache: senão, o próprio 401 do recarregamento entraria em laço.
 */
export function useUnauthenticatedRedirect(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    function onUnauthenticated() {
      if (queryClient.getQueryData(queryKeys.me)) {
        void queryClient.resetQueries({ queryKey: queryKeys.me })
      }
    }
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated)
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated)
  }, [queryClient])
}
