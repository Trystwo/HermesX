import axios, { AxiosError } from 'axios'
import { getAuthToken, useAuthStore } from '@/stores/auth'

export const API_URL = import.meta.env.VITE_API_URL || ''

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string | string[] }>) => {
    if (error.response?.status === 401) {
      // 完整清理，避免 zustand 仍认为已登录却无 token
      useAuthStore.getState().logout()
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
    }
    const raw = error.response?.data?.message
    const message =
      (Array.isArray(raw) ? raw.join(', ') : raw) ||
      error.message ||
      '请求失败，请稍后重试'
    return Promise.reject(new Error(message))
  },
)

export type ApiResponse<T> = Promise<T>
