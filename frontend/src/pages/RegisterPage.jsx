import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Ticket, User } from 'lucide-react'

import { apiRegister } from '../api/auth'
import { parseApiError } from '../api/client'
import AuthLayout from '../components/AuthLayout'
import { Alert, FormField, PasswordField, SubmitButton } from '../components/Form'
import { useAuthStore } from '../store/auth'

export default function RegisterPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form, setForm] = useState({
    invite_code: '',
    username: '',
    email: '',
    password: '',
    password2: '',
  })
  const [errors, setErrors] = useState({ general: '', fields: {} })
  const [loading, setLoading] = useState(false)

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    const fields = {}
    if (!form.invite_code.trim()) fields.invite_code = 'کد دعوت را وارد کنید.'
    if (!form.username.trim()) fields.username = 'نام کاربری را وارد کنید.'
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) fields.email = 'ایمیل معتبر وارد کنید.'
    if (form.password.length < 8) fields.password = 'رمز عبور باید حداقل ۸ کاراکتر باشد.'
    if (form.password2 !== form.password) fields.password2 = 'تکرار رمز عبور مطابقت ندارد.'
    setErrors({ general: '', fields })
    if (Object.keys(fields).length) return

    setLoading(true)
    try {
      const { data } = await apiRegister({
        invite_code: form.invite_code.trim().toUpperCase(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        password2: form.password2,
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
    <AuthLayout
      title="ساخت حساب جدید"
      subtitle="ثبت‌نام فقط با کد دعوت معتبر ممکن است"
    >
      {errors.general && <Alert>{errors.general}</Alert>}
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          label="کد دعوت"
          icon={Ticket}
          name="invite_code"
          value={form.invite_code}
          onChange={onChange}
          error={errors.fields.invite_code}
          placeholder="مثلاً A7X2K9QM4TBP"
          autoComplete="off"
          dir="ltr"
          className="text-left tracking-widest"
        />
        <FormField
          label="نام کاربری"
          icon={User}
          name="username"
          value={form.username}
          onChange={onChange}
          error={errors.fields.username}
          placeholder="حروف انگلیسی، عدد و @ . + - _"
          autoComplete="username"
          dir="ltr"
          className="text-left"
        />
        <FormField
          label="ایمیل"
          icon={Mail}
          name="email"
          type="email"
          value={form.email}
          onChange={onChange}
          error={errors.fields.email}
          placeholder="you@example.com"
          autoComplete="email"
          dir="ltr"
          className="text-left"
        />
        <PasswordField
          label="رمز عبور"
          name="password"
          value={form.password}
          onChange={onChange}
          error={errors.fields.password}
          placeholder="حداقل ۸ کاراکتر"
          autoComplete="new-password"
        />
        <PasswordField
          label="تکرار رمز عبور"
          name="password2"
          value={form.password2}
          onChange={onChange}
          error={errors.fields.password2}
          placeholder="تکرار رمز عبور"
          autoComplete="new-password"
        />
        <SubmitButton loading={loading}>ساخت حساب و ورود</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        حساب دارید؟{' '}
        <Link to="/login" className="text-emerald-700 hover:underline">
          وارد شوید
        </Link>
      </p>
    </AuthLayout>
  )
}