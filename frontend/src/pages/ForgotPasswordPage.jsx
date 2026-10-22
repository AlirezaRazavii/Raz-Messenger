import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'

import { apiForgotPassword } from '../api/auth'
import { parseApiError } from '../api/client'
import AuthLayout from '../components/AuthLayout'
import { Alert, FormField, SubmitButton } from '../components/Form'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState({ general: '', fields: {} })
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    const v = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(v)) {
      setErrors({ general: '', fields: { email: 'ایمیل معتبر وارد کنید.' } })
      return
    }
    setErrors({ general: '', fields: {} })
    setLoading(true)
    try {
      await apiForgotPassword(v)
      setSent(true)
    } catch (err) {
      setErrors(parseApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="فراموشی رمز عبور" subtitle="کد بازیابی به ایمیل شما ارسال می‌شود">
      {errors.general && <Alert>{errors.general}</Alert>}
      {sent ? (
        <>
          <Alert tone="success">
            اگر این ایمیل در سیستم ثبت شده باشد، کد بازیابی برای آن ارسال شد. کد تا ۱۰ دقیقه
            معتبر است.
          </Alert>
          <SubmitButton type="button" onClick={() => navigate('/reset-password', { state: { email: email.trim() } })}>
            ادامه
          </SubmitButton>
        </>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <FormField
            label="ایمیل حساب شما"
            icon={Mail}
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.fields.email}
            placeholder="you@example.com"
            autoComplete="email"
            dir="ltr"
            className="text-left"
          />
          <SubmitButton loading={loading}>ارسال کد بازیابی</SubmitButton>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-slate-500">
        <Link to="/login" className="text-emerald-700 hover:underline">
          بازگشت به ورود
        </Link>
      </p>
    </AuthLayout>
  )
}