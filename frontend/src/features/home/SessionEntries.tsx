import { errorTextClass } from '../../ui/styles'
import type { SavedEntry } from '../entry/describe'

/**
 * O que foi registrado nesta visita à tela inicial (some ao sair dela). A região fica sempre
 * na página: leitores de tela ignoram uma que nasce já com texto.
 */
export function SessionEntries({ entries }: { entries: SavedEntry[] }) {
  return (
    <div aria-live="polite" data-testid="session-entries">
      {entries.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry, index) => (
            <li key={index} className="border-l-[3px] border-pen bg-slip px-3 py-2 text-sm">
              <p>{entry.line}</p>
              {entry.warnings.map((warning) => (
                <p key={warning} className={errorTextClass}>
                  {warning}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
