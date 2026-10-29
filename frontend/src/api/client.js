import axios from 'axios'

import { useAuthStore } from '../store/auth'

// در حالت توسعه بک‌اند روی 8000 است؛ در فاز ۷ با هم‌دامنه شدن، به '/api' تغییر می‌کند
const client = axios.create({
  baseURL: `${window.location.protocol}//${window.location.hostname}:8000/api`,
  timeout: 15000,
})

// افزودن خودکار توکن به همه درخواست‌ها
client.interceptors.request.use((config) => {
  const access = useAuthStore.getState().access
  if (access) {
    config.headers.Authorization = `Bearer ${access}`
  }
  return config
})

let refreshing = null

// اگر توکن منقضی شد، یک‌بار رفرش و تکرار همان درخواست
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const { refresh, setTokens, logout } = useAuthStore.getState()

    if (
      error.response?.status === 401 &&
      refresh &&
      original &&
      !original._retry &&
      !original.url?.includes('/auth/login/') &&
      !original.url?.includes('/auth/refresh/')
    ) {
      original._retry = true
      try {
        // جلوگیری از رفرش موازی با چند درخواست همزمان
        refreshing = refreshing || client.post('/auth/refresh/', { refresh })
        const { data } = await refreshing
        refreshing = null
        setTokens(data.access, data.refresh)
        original.headers.Authorization = `Bearer ${data.access}`
        return client(original)
      } catch {
        refreshing = null
        logout()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// دامنهٔ بک‌اند به‌صورت مطلق — برای لینک‌هایی که خارج از axios هستند (مثل <img>)
export const backendOrigin = `${window.location.protocol}//${window.location.hostname}:8000`

// تبدیل مسیر نسبی API (مثل /api/auth/users/1/avatar/) به URL کامل
export function absUrl(path) {
  if (!path) return null
  return path.startsWith('http') ? path : backendOrigin + path
}

// تبدیل خطاهای DRF به پیام‌های فارسی قابل نمایش در فرم‌ها
export function parseApiError(error) {
  const data = error?.response?.data
  if (!data) {
    return {
      general: 'ارتباط با سرور برقرار نشد؛ اتصال خود را بررسی کنید.',
      fields: {},
    }
  }
  if (typeof data === 'string') {
    return { general: data, fields: {} }
  }
  const fields = {}
  let general = ''
  for (const [key, value] of Object.entries(data)) {
    const msg = Array.isArray(value) ? value.join(' ، ') : String(value)
    if (key === 'detail' || key === 'non_field_errors') {
      general = msg
    } else {
      fields[key] = msg
    }
  }
  return { general, fields }
}

export default client