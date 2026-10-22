import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { apiChangePassword, apiChangePasswordConfirm } from '../api/auth'
import { parseApiError } from '../api/client'
import AuthLayout from '../components/AuthLayout'
import { Alert, PasswordField, SubmitButton } from '../components/Form'
import { useAuthStore } from '../store/auth'

export default function SettingsPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    current_password: '',
    code: '',
    new_password: '',
    new_password2: '',
  })
  const [errors, setErrors] = useState({ general: '', fields: {} })
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  // گام ۱: تأیید رمز فعلی و ارسال کد به ایمیل
  const onSubmitStep1 = async (e) => {
    e.preventDefault()
    if (!form.current_password) {
      setErrors({ general: '', fields: { current_password: 'رمز عبور فعلی را وارد کنید.' } })
      return
    }
    setErrors({ general: '', fields: {} })
    setLoading(true)
    try {
      await apiChangePassword({ current_password: form.current_password })
      setStep(2)
    } catch (err) {
      setErrors(parseApiError(err))
    } finally {
      setLoading(false)
    }
  }

  // گام ۲: کد ایمیل‌شده + رمز جدید
  const onSubmitStep2 = async (e) => {
    e.preventDefault()
    const fields = {}
    if (!/^\d{6}$/.test(form.code.trim())) fields.code = 'کد ۶ رقمی ارسال‌شده به ایمیل را وارد کنید.'
    if (form.new_password.length < 8) fields.new_password = 'رمز عبور باید حداقل ۸ کاراکتر باشد.'
    if (form.new_password2 !== form.new_password) fields.new_password2 = 'تکرار رمز عبور مطابقت ندارد.'
    setErrors({ general: '', fields })
    if (Object.keys(fields).length) return

    setLoading(true)
    try {
      const { data } = await apiChangePasswordConfirm({
        code: form.code.trim(),
        new_password: form.new_password,
        new_password2: form.new_password2,
      })
      setAuth(data.access, data.refresh, data.user)
      setDone(true)
    } catch (err) {
      setErrors(parseApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="تغییر رمز عبور" subtitle="برای امنیت بیشتر، تغییر رمز با کد ایمیلی تأیید می‌شود">
      {errors.general && <Alert>{errors.general}</Alert>}

      {done ? (
        <>
          <Alert tone="success">رمز عبور با موفقیت تغییر کرد و شما با رمز جدید وارد هستید.</Alert>
          <SubmitButton type="button" onClick={() => navigate('/', { replace: true })}>
            بازگشت به صفحه اصلی
          </SubmitButton>
        </>
      ) : step === 1 ? (
        <form onSubmit={onSubmitStep1} className="space-y-4">
          <PasswordField
            label="رمز عبور فعلی"
            name="current_password"
            value={form.current_password}
            onChange={onChange}
            error={errors.fields.current_password}
            placeholder="رمز فعلی خود را وارد کنید"
            autoComplete="current-password"
          />
          <SubmitButton loading={loading}>ارسال کد تأیید به ایمیل</SubmitButton>
        </form>
      ) : (
        <>
          <Alert tone="success">کد تأیید به ایمیل شما ارسال شد (تا ۱۰ دقیقه معتبر است).</Alert>
          <form onSubmit={onSubmitStep2} className="space-y-4">
            <PasswordField
              label="کد تأیید"
              name="code"
              value={form.code}
              onChange={onChange}
              error={errors.fields.code}
              placeholder="------"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
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
            <SubmitButton loading={loading}>تغییر رمز عبور</SubmitButton>
          </form>
        </>
      )}
    </AuthLayout>
  )
}