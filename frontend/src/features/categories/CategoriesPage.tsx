import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useRef, useState } from 'react'

import { ApiError } from '../../api/client'
import { api } from '../../api/endpoints'
import { useCategories } from '../../api/queries'
import type { CategoryKind, CategoryOut } from '../../api/types'
import { Field, invalid } from '../../ui/Field'
import { type Announce, useFocusOnReturn, useStatus } from '../../ui/focus'
import { Page } from '../../ui/Page'
import {
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../ui/styles'

const KINDS: [CategoryKind, string][] = [
  ['EXPENSE', 'Despesas'],
  ['INCOME', 'Receitas'],
]
const textButton = 'min-h-11 px-2 text-sm text-pen underline-offset-2 hover:underline'
const rowClass = 'flex flex-wrap items-center justify-between gap-x-3 border-b border-rule py-1'

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.detail : 'Erro inesperado. Tente de novo.'
}

/** Recarrega as categorias de todas as consultas (lista completa e por tipo). */
function useRefreshCategories(): () => Promise<void> {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['categories'] })
}

/** `/mais/categorias`: despesas e receitas; as do sistema só podem ser vistas. */
export function CategoriesPage() {
  const categories = useCategories()
  const { announce, status } = useStatus()

  return (
    <Page title="Categorias">
      {status}
      {KINDS.map(([kind, title]) => (
        <KindSection
          key={kind}
          title={title}
          categories={(categories.data ?? []).filter((c) => c.kind === kind)}
          onMessage={announce}
        />
      ))}
      <NewCategoryForm onCreated={(name) => announce(`Categoria ${name} criada.`)} />
    </Page>
  )
}

function KindSection({
  title,
  categories,
  onMessage,
}: {
  title: string
  categories: CategoryOut[]
  onMessage: Announce
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="mb-1 text-lg font-[650]">
        {title}
      </h2>
      <ul>
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} onMessage={onMessage} />
        ))}
      </ul>
    </section>
  )
}

function CategoryRow({
  category,
  onMessage,
}: {
  category: CategoryOut
  onMessage: Announce
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'archive'>('view')
  const [essential, setEssential] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useRefreshCategories()
  const editable = !category.is_system
  const renameRef = useRef<HTMLButtonElement>(null)
  useFocusOnReturn(mode, renameRef)

  async function toggleEssential(checked: boolean) {
    // Sem `disabled` durante o envio: desabilitar a caixa focada jogaria o foco no <body>.
    if (essential !== null) return
    setError(null)
    setEssential(checked)
    try {
      await api.updateCategory(category.id, { is_essential: checked })
      await refresh()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setEssential(null)
    }
  }

  async function archive() {
    setError(null)
    try {
      await api.archiveCategory(category.id)
      // A categoria some da lista: o foco vai para a mensagem.
      onMessage(`Categoria ${category.name} arquivada.`, { focus: true })
      await refresh()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  if (mode === 'rename') {
    return (
      <li className="border-b border-rule py-3">
        <RenameForm category={category} onDone={() => setMode('view')} />
      </li>
    )
  }

  return (
    <li className={rowClass}>
      <p className="min-h-11 min-w-0 flex-1 truncate leading-[2.75rem]">{category.name}</p>
      {category.is_system ? (
        <span className="rounded-full border border-rule px-2 py-0.5 text-[13px] text-ink-soft">
          Do sistema
        </span>
      ) : (
        category.kind === 'EXPENSE' && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              aria-label={`Essencial (${category.name})`}
              checked={essential ?? category.is_essential}
              aria-busy={essential !== null}
              onChange={(e) => toggleEssential(e.target.checked)}
              className="size-5 accent-pen"
            />
            Essencial
          </label>
        )
      )}
      {editable && mode === 'view' && (
        <div className="-mt-2 -ml-2 flex w-full gap-1">
          <button
            ref={renameRef}
            type="button"
            aria-label={`Renomear ${category.name}`}
            onClick={() => setMode('rename')}
            className={textButton}
          >
            Renomear
          </button>
          <button
            type="button"
            aria-label={`Arquivar ${category.name}`}
            onClick={() => setMode('archive')}
            className={textButton}
          >
            Arquivar
          </button>
        </div>
      )}
      {mode === 'archive' && (
        <div
          role="group"
          aria-label={`Arquivar ${category.name}`}
          className="flex w-full flex-wrap items-center gap-2 pt-2"
        >
          <p className="w-full text-sm">
            Arquivar {category.name}? Ela deixa de aparecer nos novos lançamentos; o histórico
            continua.
          </p>
          <button type="button" onClick={archive} className={primaryButtonClass}>
            Arquivar categoria
          </button>
          <button type="button" onClick={() => setMode('view')} className={secondaryButtonClass}>
            Cancelar
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={`w-full ${errorTextClass}`}>
          {error}
        </p>
      )}
    </li>
  )
}

function RenameForm({ category, onDone }: { category: CategoryOut; onDone: () => void }) {
  const id = useId()
  const [name, setName] = useState(category.name)
  const [error, setError] = useState<string | null>(null)
  const refresh = useRefreshCategories()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setError('Informe um nome.')
      return
    }
    try {
      await api.updateCategory(category.id, { name: name.trim() })
      await refresh()
      onDone()
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <form
      aria-label={`Renomear ${category.name}`}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3"
    >
      <Field id={`${id}-name`} label="Nome" error={error ?? undefined}>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...invalid(`${id}-name`, error ?? undefined)}
          className={inputClass}
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass}>
          Salvar
        </button>
        <button type="button" onClick={onDone} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function NewCategoryForm({ onCreated }: { onCreated: (name: string) => void }) {
  const id = useId()
  const refresh = useRefreshCategories()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('EXPENSE')
  const [essential, setEssential] = useState(false)
  const [nameError, setNameError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setNameError(name.trim() === '' ? 'Informe um nome.' : undefined)
    if (name.trim() === '') return
    try {
      const created = await api.createCategory({
        name: name.trim(),
        kind,
        is_essential: kind === 'EXPENSE' && essential,
      })
      setName('')
      setEssential(false)
      onCreated(created.name)
      await refresh()
    } catch (err) {
      setFormError(messageOf(err))
    }
  }

  return (
    <form aria-label="Nova categoria" onSubmit={submit} noValidate className="flex flex-col gap-3">
      <h2 className="text-lg font-[650]">Nova categoria</h2>
      <Field id={`${id}-name`} label="Nome" error={nameError}>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...invalid(`${id}-name`, nameError)}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-kind`} label="Tipo">
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as CategoryKind)}
          className={inputClass}
        >
          <option value="EXPENSE">Despesa</option>
          <option value="INCOME">Receita</option>
        </select>
      </Field>
      {kind === 'EXPENSE' && (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={essential}
            onChange={(e) => setEssential(e.target.checked)}
            className="size-5 accent-pen"
          />
          Essencial
        </label>
      )}
      {formError && (
        <p role="alert" className={errorTextClass}>
          {formError}
        </p>
      )}
      <button type="submit" className={`${primaryButtonClass} self-start`}>
        Criar categoria
      </button>
    </form>
  )
}
