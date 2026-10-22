import { Navigate, Outlet } from 'react-router-dom'

import { useAuthStore } from '../store/auth'

export default function ProtectedLayout() {
  const access = useAuthStore((s) => s.access)
  if (!access) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}