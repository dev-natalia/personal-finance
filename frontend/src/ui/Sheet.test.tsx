import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { expectNoA11yViolations } from '../test/axe'
import { useInPlace } from './focus'
import { Sheet } from './Sheet'

/** Como as telas usam: um botão abre, o `useInPlace` devolve o foco ao fechar. */
function Harness() {
  const sheet = useInPlace()
  return (
    <main>
      <button ref={sheet.buttonRef} type="button" onClick={sheet.show}>
        Abrir
      </button>
      <a href="#atras">Link atrás</a>
      {sheet.open && (
        <Sheet title="Nova conta" onClose={() => sheet.close()}>
          <label>
            Nome
            <input />
          </label>
          <button type="button">Criar conta</button>
        </Sheet>
      )}
    </main>
  )
}

test('sheet keeps focus inside and gives it back', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Abrir' }))
  const dialog = screen.getByRole('dialog', { name: 'Nova conta' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByLabelText('Nome')).toHaveFocus()

  // Tab no último volta ao primeiro; Shift+Tab no primeiro vai ao último.
  await user.tab()
  expect(screen.getByRole('button', { name: 'Criar conta' })).toHaveFocus()
  await user.tab()
  expect(screen.getByLabelText('Nome')).toHaveFocus()
  await user.tab({ shift: true })
  expect(screen.getByRole('button', { name: 'Criar conta' })).toHaveFocus()

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus()
})

test('clicking the backdrop closes the sheet', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Abrir' }))
  await user.click(screen.getByTestId('sheet-backdrop'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('sheet has no accessibility violations', async () => {
  const user = userEvent.setup()
  const { container } = render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Abrir' }))
  await expectNoA11yViolations(container)
})
