import { MessageCircle } from 'lucide-react'

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-gradient-to-bl from-slate-100 via-emerald-50 to-slate-200 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-200">
            <MessageCircle className="h-7 w-7" />
          </div>
          <h1 className="mt-3 text-xl font-bold text-slate-800">پیام‌رسان RAZ</h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          {subtitle && <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p>}
          <div className="mt-6 space-y-4">{children}</div>
        </div>
      </div>
    </div>
  )
}