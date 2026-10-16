/** Aviso de sem conexão: o texto digitado continua no campo até a conexão voltar. */
export function OfflineBanner() {
  return (
    <p role="status" className="my-2 border-l-4 border-stamp bg-slip px-3 py-2 text-sm">
      Sem conexão. O que você digitar fica guardado aqui até a conexão voltar.
    </p>
  )
}
