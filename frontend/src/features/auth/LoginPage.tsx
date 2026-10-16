import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { queryKeys } from '../../api/queries'
import { errorTextClass, fieldLabelClass, inputClass, primaryButtonClass } from '../../ui/styles'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await api.login(email, password)
      queryClient.setQueryData(queryKeys.me, user)
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Erro inesperado. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-3xl font-[650]">Entrar</h1>
        <p className="mt-1 text-ink-soft">Seu caderno de gastos.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <label className={fieldLabelClass}>
          E-mail
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={fieldLabelClass}>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        {error && (
          <p role="alert" className={errorTextClass}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
