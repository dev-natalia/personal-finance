import { NavLink, Outlet } from 'react-router'

const SECTIONS = [
  { to: '/', label: 'Início', end: true },
  // O nome mais longo: no limite, é o único que encolhe (com reticências).
  { to: '/lancamentos', label: 'Lançamentos', end: false, shrinks: true },
  { to: '/analise', label: 'Análise', end: false },
  { to: '/contas', label: 'Contas', end: false },
  { to: '/mais', label: 'Mais', end: false },
]

/** Navegação fixa embaixo no celular e lateral a partir de telas médias. */
export function AppShell() {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[13rem_1fr]">
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-slip pb-[env(safe-area-inset-bottom)] md:static md:border-t-0 md:border-r md:bg-transparent md:pt-6"
      >
        {/* No celular os cinco cabem até em 320 px ou com a letra do sistema aumentada:
            espaço lateral fixo e pequeno, letra que acompanha a largura e, no limite,
            "Lançamentos" encolhe com reticências em vez de o último sair da tela. */}
        <ul className="flex justify-between px-1 md:flex-col md:justify-start md:gap-1 md:px-3">
          {SECTIONS.map((section) => (
            <li key={section.to} className={section.shrinks ? 'min-w-0' : 'shrink-0'}>
              <NavLink
                to={section.to}
                end={section.end}
                className={({ isActive }) =>
                  `flex min-h-11 items-center px-[6px] text-[clamp(11px,3.7vw,14px)] md:rounded-lg md:px-3 md:text-base ${
                    isActive ? 'font-[650] text-pen' : 'text-ink-soft hover:text-ink'
                  }`
                }
              >
                <span className="truncate">{section.label}</span>
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
