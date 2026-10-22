import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'

import { apiResetPassword } from '../api/auth'
import { parseApiError } from '../api/client'
import AuthLayout from '../components/AuthLayout'
import { Alert, FormField, PasswordField, SubmitButton } from '../components/Form'
import { useAuthStore } from '../store/auth'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form, setForm] = useState({
    email: location.state?.email || '',
    code: '',
    new_password: '',
    new_password2: '',
  })
  const [errors, setErrors] = useState({ general: '', fields: {} })
  const [loading, setLoading] = useState(false)

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    const fields = {}
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) fields.email = 'ایمیل معتبر وارد کنید.'
    if (!/^\d{6}$/.test(form.code.trim())) fields.code = 'کد ۶ رقمی ارسال‌شده به ایمیل را وارد کنید.'
    if (form.new_password.length < 8) fields.new_password = 'رمز عبور باید حداقل ۸ کاراکتر باشد.'
    if (form.new_password2 !== form.new_password) fields.new_password2 = 'تکرار رمز عبور مطابقت ندارد.'
    setErrors({ general: '', fields })
    if (Object.keys(fields).length) return

    setLoading(true)
    try {
      const { data } = await apiResetPassword({
        email: form.email.trim(),
        code: form.code.trim(),
        new_password: form.new_password,
        new_password2: form.new_password2,
      })
      setAuth(data.access, data.refresh, data.user)
      navigate('/', { replace: true })
    } catch (err) {
      setErrors(parseApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="تعیین رمز عبور جدید" subtitle="کد ارسال‌شده به ایمیل خود را وارد کنید">
      {errors.general && <Alert>{errors.general}</Alert>}
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="ایمیل"
          icon={Mail}
          name="email"
          type="email"
          value={form.email}
          onChange={onChange}
          error={errors.fields.email}
          placeholder="you@example.com"
          dir="ltr"
          className="text-left"
        />
        <FormField
          label="کد تأیید"
          name="code"
          value={form.code}
          onChange={onChange}
          error={errors.fields.code}
          placeholder="------"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          dir="ltr"
          className="text-center text-lg tracking-[0.5em]"
        />
        <PasswordField
          label="رمز عبور جدید"
          name="new_password"
          value={form.new_password}
          onChange={onChange}
          error={errors.fields.new_password}
          placeholder="حداقل ۸ کاراکتر"
          autoComplete="new-password"
        />
        <PasswordField
          label="تکرار رمز عبور جدید"
          name="new_password2"
          value={form.new_password2}
          onChange={onChange}
          error={errors.fields.new_password2}
          placeholder="تکرار رمز عبور جدید"
          autoComplete="new-password"
        />
        <SubmitButton loading={loading}>تغییر رمز و ورود</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        <Link to="/login" className="text-emerald-700 hover:underline">
          بازگشت به ورود
        </Link>
      </p>
    </AuthLayout>
  )
}