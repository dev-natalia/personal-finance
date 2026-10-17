/** Cliente HTTP da API: mesma origem, cabeçalho anti-CSRF e erros no formato Problem Details. */

export interface FieldError {
  field: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string
  readonly fieldErrors: FieldError[]
  readonly requestId: string | null

  constructor(
    status: number,
    code: string,
    detail: string,
    fieldErrors: FieldError[] = [],
    requestId: string | null = null,
  ) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.fieldErrors = fieldErrors
    this.requestId = requestId
  }
}

/** Disparado em `window` sempre que a API responde 401 (sessão ausente ou expirada). */
export const UNAUTHENTICATED_EVENT = 'pf:unauthenticated'

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  // O navegador manda `Origin` sozinho; `X-Requested-With` completa a proteção contra CSRF.
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'fetch',
    ...options.headers,
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(new URL(path, window.location.origin), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(
      0,
      'network_error',
      'Sem conexão com o servidor. Verifique a internet e tente de novo.',
    )
  }

  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT))
  if (!response.ok) throw await toApiError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

interface ProblemBody {
  code?: string
  detail?: string
  errors?: FieldError[]
  request_id?: string
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ProblemBody
    return new ApiError(
      response.status,
      body.code ?? 'http_error',
      body.detail ?? 'Erro inesperado. Tente de novo.',
      body.errors ?? [],
      body.request_id ?? null,
    )
  } catch {
    return new ApiError(response.status, 'http_error', 'Erro inesperado. Tente de novo.')
  }
}

/** Chave contra clique duplo: uma por lançamento, reaproveitada em "Tentar de novo". */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
