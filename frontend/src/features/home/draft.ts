/** Texto não enviado do campo da tela inicial. É a única coisa guardada no navegador. */
export const DRAFT_KEY = 'pf:draft'

export function loadDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(text: string): void {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text)
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Navegação privada ou armazenamento bloqueado: o rascunho só não sobrevive.
  }
}
