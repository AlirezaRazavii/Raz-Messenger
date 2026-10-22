import { useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'

export function Alert({ tone = 'error', children }) {
  const styles =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-700'
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm leading-6 ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

export function FormField({ label, icon: Icon, error, ...props }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        )}
        <input
          {...props}
          className={`w-full rounded-xl border bg-white py-2.5 pl-4 pr-10 text-slate-800 placeholder:text-slate-400 outline-none transition focus:ring-2 ${
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
              : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-100'
          }`}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function PasswordField({ label, error, icon: Icon = KeyRound, ...props }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          type={show ? 'text' : 'password'}
          {...props}
          className={`w-full rounded-xl border bg-white py-2.5 pl-10 pr-10 text-slate-800 placeholder:text-slate-400 outline-none transition focus:ring-2 ${
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
              : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-100'
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
          aria-label={show ? 'پنهان کردن رمز' : 'نمایش رمز'}
        >
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function SubmitButton({ loading, type = 'submit', children, ...props }) {
  return (
    <button
      type={type}
      disabled={loading}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}