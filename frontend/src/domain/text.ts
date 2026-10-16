/**
 * Normaliza um nome do mesmo jeito que o backend (app/domain/merchants.py):
 * sem acentos, minúsculas, pontuação vira espaço e espaços compactados.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
