import { NavLink, Outlet } from 'react-router'

import { NavIcon, type NavIconName } from '../../ui/NavIcon'

interface Section {
  to: string
  label: string
  /** Nome na barra do celular, quando o completo não cabe embaixo do ícone. */
  short?: string
  icon: NavIconName
  end: boolean
}

const SECTIONS: Section[] = [
  { to: '/', label: 'Início', icon: 'home', end: true },
  { to: '/lancamentos', label: 'Lançamentos', short: 'Lançam.', icon: 'list', end: false },
  { to: '/analise', label: 'Análise', icon: 'chart', end: false },
  { to: '/contas', label: 'Contas', icon: 'wallet', end: false },
  { to: '/cartoes', label: 'Cartões', icon: 'card', end: false },
  { to: '/mais', label: 'Mais', icon: 'more', end: false },
]

/**
 * Navegação fixa embaixo no celular (ícone e nome pequeno, seis colunas iguais que cabem de
 * 320 px em diante, também com a letra do sistema aumentada) e lateral a partir de telas médias.
 */
export function AppShell() {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[13rem_1fr]">
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-slip pb-[env(safe-area-inset-bottom)] md:static md:border-t-0 md:border-r md:bg-transparent md:pt-6"
      >
        <ul className="flex md:flex-col md:gap-1 md:px-3">
          {SECTIONS.map((section) => (
            <li key={section.to} className="min-w-0 flex-1 md:flex-none">
              <NavLink
                to={section.to}
                end={section.end}
                // O nome completo, nas duas larguras (os textos visíveis trocam conforme a tela).
                aria-label={section.label}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[clamp(10px,3vw,12px)] leading-tight md:min-h-11 md:flex-row md:justify-start md:gap-2 md:rounded-lg md:px-3 md:text-base ${
                    isActive ? 'font-[650] text-pen' : 'text-ink-soft hover:text-ink'
                  }`
                }
              >
                <NavIcon name={section.icon} />
                <span data-mobile-label className="max-w-full truncate md:hidden">
                  {section.short ?? section.label}
                </span>
                <span aria-hidden="true" className="hidden md:inline">
                  {section.label}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="pb-24 md:pb-0">
        <Outlet />
      </main>
    </div>
  )
}
