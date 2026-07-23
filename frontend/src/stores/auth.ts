import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

const TOKEN_KEY = 'hermesx_token'
const USER_KEY = 'hermesx_user'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (user: User, token: string) => void
  logout: () => void
}

function syncTokenToStorage(token: string | null, user: User | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } else {
    localStorage.removeItem(USER_KEY)
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      login: (user, token) => {
        syncTokenToStorage(token, user)
        set({ user, token, isAuthenticated: true })
      },
      logout: () => {
        syncTokenToStorage(null, null)
        set({ user: null, token: null, isAuthenticated: false })
      },
    }),
    {
      name: 'hermesx-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // 刷新后把 persist 里的 token 同步回 hermesx_token，供 axios 拦截器使用
        if (state?.token && state.isAuthenticated) {
          syncTokenToStorage(state.token, state.user)
        } else {
          syncTokenToStorage(null, null)
          if (state) {
            state.user = null
            state.token = null
            state.isAuthenticated = false
          }
        }
      },
    },
  ),
)

/** 供非 React 代码（axios）读取当前 token */
export function getAuthToken(): string | null {
  return useAuthStore.getState().token || localStorage.getItem(TOKEN_KEY)
}
