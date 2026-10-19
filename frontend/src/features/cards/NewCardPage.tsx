import { Link, useNavigate } from 'react-router'

import { Page } from '../../ui/Page'
import { linkClass } from '../../ui/styles'
import { NewCardForm } from './NewCardForm'

/** `/cartoes/novo`: o cadastro em dois passos é longo, por isso tem página própria. */
export function NewCardPage() {
  const navigate = useNavigate()
  return (
    <Page title="Novo cartão">
      <Link to="/cartoes" className={`${linkClass} -mt-2 mb-4 inline-block text-sm`}>
        ‹ Cartões
      </Link>
      <NewCardForm
        onCreated={(name) => navigate('/cartoes', { state: { message: `Cartão ${name} criado.` } })}
        onCancel={() => navigate('/cartoes')}
      />
    </Page>
  )
}
