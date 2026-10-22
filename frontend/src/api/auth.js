import client from './client'

export const apiRegister = (payload) => client.post('/auth/register/', payload)
export const apiLogin = (payload) => client.post('/auth/login/', payload)
export const apiLogout = (refresh) => client.post('/auth/logout/', { refresh })
export const apiMe = () => client.get('/auth/me/')
export const apiForgotPassword = (email) => client.post('/auth/forgot-password/', { email })
export const apiResetPassword = (payload) => client.post('/auth/reset-password/', payload)
export const apiChangePassword = (payload) => client.post('/auth/change-password/', payload)
export const apiChangePasswordConfirm = (payload) =>
  client.post('/auth/change-password/confirm/', payload)