import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, User } from 'lucide-react'

import { apiLogin } from '../api/auth'
import { parseApiError } from '../api/client'
import AuthLayout from '../components/AuthLayout'
import { Alert, FormField, PasswordField, SubmitButton } from '../components/Form'
import { useAuthStore } from '../store/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form, setForm] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState({ general: '', fields: {} })
  const [loading, setLoading] = useState(false)

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    const fields = {}
    if (!form.username.trim()) fields.username = 'نام کاربری را وارد کنید.'
    if (!form.password) fields.password = 'رمز عبور را وارد کنید.'
    setErrors({ general: '', fields })
    if (Object.keys(fields).length) return

    setLoading(true)
    try {
      const { data } = await apiLogin({
        username: form.username.trim(),
        password: form.password,
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
    <AuthLayout title="ورود" subtitle="برای ادامه وارد حساب خود شوید">
      {errors.general && <Alert>{errors.general}</Alert>}
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="نام کاربری"
          icon={User}
          name="username"
          value={form.username}
          onChange={onChange}
          error={errors.fields.username}
          placeholder="مثلاً Ali"
          autoComplete="username"
        />
        <PasswordField
          label="رمز عبور"
          name="password"
          value={form.password}
          onChange={onChange}
          error={errors.fields.password}
          placeholder="••••••••"
          autoComplete="current-password"
        />
        <SubmitButton loading={loading}>ورود</SubmitButton>
      </form>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link to="/forgot-password" className="text-emerald-700 hover:underline">
          رمز عبور را فراموش کردم
        </Link>
        <Link to="/register" className="text-emerald-700 hover:underline">
          ساخت حساب با کد دعوت
        </Link>
      </div>
    </AuthLayout>
  )
}