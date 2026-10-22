import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, MessageCircle, Settings, ShieldCheck } from 'lucide-react'
import moment from 'moment-jalaali'

import { apiLogout, apiMe } from '../api/auth'
import { useAuthStore } from '../store/auth'

export default function HomePage() {
  const navigate = useNavigate()
  const { user, refresh, setUser, logout } = useAuthStore()
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    apiMe()
      .then(({ data }) => setUser(data))
      .catch(() => {})
  }, [setUser])

  const onLogout = async () => {
    setLoggingOut(true)
    try {
      await apiLogout(refresh)
    } catch {
      // حتی اگر سرور قبول نکرد، محلی هم خارج می‌شویم
    }
    logout()
    navigate('/login', { replace: true })
  }

  const joined = user?.date_joined ? moment(user.date_joined).format('jYYYY/jMM/jDD') : '—'

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <MessageCircle className="h-5 w-5" />
            </div>
            <span className="font-bold text-slate-800">پیام‌رسان راز</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/settings"
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
            >
              <Settings className="h-4 w-4" />
              تغییر رمز
            </Link>
            <button
              onClick={onLogout}
              disabled={loggingOut}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
            {user?.username?.[0]?.toUpperCase() || '؟'}
          </div>
          <div>
            <h1 className="font-bold text-slate-800">{user?.username}</h1>
            <p className="mt-0.5 text-sm text-slate-500" dir="ltr">
              {user?.email}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">عضویت: {joined}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-emerald-600" />
          <h2 className="mt-3 font-bold text-slate-800">فاز ۱ کامل شد — احراز هویت آماده است</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            صفحه اصلی فعلاً خالی است؛ چت خصوصی و گروهی در فازهای ۲ و ۴ همین‌جا قرار می‌گیرد.
          </p>
        </div>
      </main>
    </div>
  )
}