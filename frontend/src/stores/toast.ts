import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warn' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration: number
}

interface ToastState {
  toasts: ToastItem[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (type, message, duration = 3500) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message, duration }] }))
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id)
      }, duration)
    }
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (msg: string, duration?: number) => useToastStore.getState().addToast('success', msg, duration),
  error: (msg: string, duration?: number) => useToastStore.getState().addToast('error', msg, duration),
  warn: (msg: string, duration?: number) => useToastStore.getState().addToast('warn', msg, duration),
  info: (msg: string, duration?: number) => useToastStore.getState().addToast('info', msg, duration),
}
