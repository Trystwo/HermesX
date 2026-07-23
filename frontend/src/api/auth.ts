import { apiClient } from './client'
import type { AuthResponse } from '@/types'

export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post<AuthResponse>('/api/auth/login', { username, password }).then((r) => r.data),

  register: (username: string, password: string) =>
    apiClient.post<AuthResponse>('/api/auth/register', { username, password }).then((r) => r.data),
}
