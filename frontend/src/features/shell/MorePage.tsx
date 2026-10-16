import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'

import { api } from '../../api/endpoints'
import { Page } from '../../ui/Page'
import { ledgerRowClass, secondaryButtonClass } from '../../ui/styles'

export function MorePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function logout() {
    try {
      await api.logout()
    } finally {
      queryClient.clear()
      navigate('/login', { replace: true })
    }
  }

  return (
    <Page title="Mais">
      <ul className="mb-6">
        <li className={ledgerRowClass}>
          <Link to="/mais/categorias" className="flex min-h-11 w-full items-center text-pen">
            Categorias
          </Link>
        </li>
      </ul>
      <button type="button" onClick={logout} className={secondaryButtonClass}>
        Sair
      </button>
    </Page>
  )
}
