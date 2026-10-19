export type NavIconName = 'home' | 'list' | 'chart' | 'wallet' | 'card' | 'more'

/** Traços simples, na cor do texto ao redor. Decorativos: o nome do item é o rótulo. */
const PATHS: Record<NavIconName, string> = {
  // Casa
  home: 'M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6',
  // Linhas do livro-caixa
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  // Rosca
  chart: 'M12 3a9 9 0 1 0 9 9h-9V3ZM15 3.5A9 9 0 0 1 20.5 9H15V3.5Z',
  // Carteira
  wallet: 'M4 7h15a1 1 0 0 1 1 1v11H5a1 1 0 0 1-1-1V7Zm0 0 12-3v3M16 13h1.5',
  // Cartão
  card: 'M3 6h18v12H3V6Zm0 4h18M6.5 15h4',
  // Três pontos
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
