import client from './client'

export const apiRegister = (payload) => client.post('/auth/register/', payload)
export const apiLogin = (payload) => client.post('/auth/login/', payload)
export const apiLogout = (refresh) => client.post('/auth/logout/', { refresh })
export const apiMe = () => client.get('/auth/me/')
export const apiForgotPassword = (email) => client.post('/auth/forgot-password/', { email })
export const apiResetPassword = (payload) => client.post('/auth/reset-password/', payload)
export const apiChangePassword = (payload) => client.post('/auth/change-password/', payload)
// دامنهٔ بک‌اند به‌صورت مطلق — برای لینک‌هایی که خارج از axios هستند (مثل <img>)
export const bexport const apiChangePasswordConfirm = (payload) =>
  client.post('/auth/change-password/confirm/', payload)

// --- بسته پروفایل ---
export const apiUpdateProfile = (payload) => client.patch('/auth/me/', payload)

export const apiUploadAvatar = (file) => {
  const body = new FormData()
  body.append('avatar', file)
  return client.post('/auth/me/avatar/', body) // خودِ axios مرز multipart را می‌سازد
}

export const apiDeleteAvatar = () => client.delete('/auth/me/avatar/')ackendOrigin = `${window.location.protocol}//${window.location.hostname}:8000`

// تبدیل مسیر نسبی API (مثل /api/auth/users/1/avatar/) به URL کامل
export function absUrl(path) {
  if (!path) return null
  return path.startsWith('http') ? path : backendOrigin + path
}

// تبدیل خطاهای DRF به پیام‌های فارسی قابل نمایش در فرم‌ها
export function parseApiError(error) {