import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'

export const WS_URL = import.meta.env.VITE_WS_URL || (typeof window !== 'undefined' ? window.location.origin : '')

type EventHandler = (data: unknown) => void

interface Subscription {
  event: string
  handler: EventHandler
}

let socket: Socket | null = null
let refCount = 0

function getSocket(token: string | null): Socket | null {
  if (!socket) {
    socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      auth: token ? { token } : undefined,
    })
  }
  return socket
}

export function useSocket(subscriptions: Subscription[] = []) {
  const token = useAuthStore((s) => s.token)
  const subscriptionsRef = useRef(subscriptions)
  subscriptionsRef.current = subscriptions

  useEffect(() => {
    if (!token) return
    const s = getSocket(token)
    if (!s) return
    refCount += 1

    s.auth = { token }
    if (!s.connected) s.connect()

    const currentSubs = subscriptionsRef.current
    currentSubs.forEach(({ event, handler }) => {
      s.on(event, handler)
    })

    return () => {
      currentSubs.forEach(({ event, handler }) => {
        s.off(event, handler)
      })
      refCount -= 1
      if (refCount <= 0 && s.connected) {
        s.disconnect()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return socket
}

export function getSocketInstance(): Socket | null {
  return socket
}
