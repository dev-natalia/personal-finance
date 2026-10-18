import { useMe } from '../../api/queries'

/** Fuso da usuária (do perfil); o padrão do app enquanto o perfil carrega. */
export function useTimeZone(): string {
  return useMe().data?.timezone ?? 'America/Sao_Paulo'
}
