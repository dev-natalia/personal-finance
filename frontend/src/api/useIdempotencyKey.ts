import { useRef } from 'react'

import { newIdempotencyKey } from './client'

/**
 * Chave contra lançamento duplicado em formulários: enviar de novo os mesmos dados (clique
 * duplo, nova tentativa após falha) reaproveita a chave; mudar algum campo gera uma nova,
 * como no cartão de confirmação.
 */
export function useIdempotencyKey(): (body: unknown) => string {
  const last = useRef<{ key: string; body: string } | null>(null)
  return (body) => {
    const serialized = JSON.stringify(body)
    if (last.current?.body !== serialized) {
      last.current = { key: newIdempotencyKey(), body: serialized }
    }
    return last.current.key
  }
}
