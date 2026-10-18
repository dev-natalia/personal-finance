import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'

import { api } from '../../api/endpoints'
import { useBackupStatus } from '../../api/queries'
import { dayAndTime } from '../../domain/dates'
import { Page } from '../../ui/Page'
import { ledgerRowClass, secondaryButtonClass } from '../../ui/styles'
import { useTimeZone } from './useTimeZone'

const LINKS = [
  { to: '/mais/categorias', label: 'Categorias' },
  { to: '/mais/frases', label: 'Frases não entendidas' },
]

export function MorePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const backup = useBackupStatus()
  const timeZone = useTimeZone()

  async function logout() {
    try {
      await api.logout()
    } finally {
      queryClient.clear()
      navigate('/login', { replace: true })
    }
  }

  const last = backup.data?.last_success_at

  return (
    <Page title="Mais">
      <ul className="mb-6">
        {LINKS.map((link) => (
          <li key={link.to} className={ledgerRowClass}>
            <Link to={link.to} className="flex min-h-11 w-full items-center text-pen">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      {backup.data && (
        <p className={`mb-6 text-sm ${backup.data.stale ? 'text-stamp' : 'text-ink-soft'}`}>
          {last ? `Último backup: ${dayAndTime(last, timeZone)}` : 'Nenhum backup ainda'}
        </p>
      )}
      <button type="button" onClick={logout} className={secondaryButtonClass}>
        Sair
      </button>
    </Page>
  )
}
