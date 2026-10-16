import { NavLink, Outlet } from 'react-router'

const SECTIONS = [
  { to: '/', label: 'Início', end: true },
  { to: '/lancamentos', label: 'Lançamentos', end: false },
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
        <ul className="flex justify-around md:flex-col md:gap-1 md:px-3">
          {SECTIONS.map((section) => (
            <li key={section.to}>
              <NavLink
                to={section.to}
                end={section.end}
                className={({ isActive }) =>
                  `flex min-h-11 items-center px-3 text-sm md:rounded-lg md:text-base ${
                    isActive ? 'font-[650] text-pen' : 'text-ink-soft hover:text-ink'
                  }`
                }
              >
                {section.label}
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
