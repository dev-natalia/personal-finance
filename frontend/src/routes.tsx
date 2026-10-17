import { Navigate, Route, Routes } from 'react-router'

import { AccountsPage } from './features/accounts/AccountsPage'
import { LoginPage } from './features/auth/LoginPage'
import { RequireAuth } from './features/auth/RequireAuth'
import { CardPage } from './features/cards/CardPage'
import { useUnauthenticatedRedirect } from './features/auth/useUnauthenticatedRedirect'
import { CategoriesPage } from './features/categories/CategoriesPage'
import { FullFormPage } from './features/form/FullFormPage'
import { HomePage } from './features/home/HomePage'
import { AppShell } from './features/shell/AppShell'
import { MorePage } from './features/shell/MorePage'
import { TransactionsPage } from './features/transactions/TransactionsPage'

export function AppRoutes() {
  useUnauthenticatedRedirect()
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="lancamentos" element={<TransactionsPage />} />
        <Route path="lancamentos/novo" element={<FullFormPage />} />
        <Route path="contas" element={<AccountsPage />} />
        <Route path="cartoes/:id" element={<CardPage />} />
        <Route path="mais" element={<MorePage />} />
        <Route path="mais/categorias" element={<CategoriesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
