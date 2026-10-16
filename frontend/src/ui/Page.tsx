import type { ReactNode } from 'react'

/** Coluna de conteúdo de uma tela, com o título (h1) e largura de leitura confortável. */
export function Page({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-[650]">{title}</h1>
      {children}
    </div>
  )
}
