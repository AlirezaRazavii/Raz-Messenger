import { Navigate, Outlet } from 'react-router-dom'

import { useAuthStore } from '../store/auth'
import CallModal from './chat/CallModal'

export default function ProtectedLayout() {
  const access = useAuthStore((s) => s.access)
  if (!access) {
    return <Navigate to="/login" replace />
  }
  return (
    <>
      <Outlet />
      {/* فاز ۵ — مودال تماس سراسری است: حتی وقتی هیچ چتی باز نیست، زنگ دیده می‌شود */}
      <CallModal />
    </>
  )
}