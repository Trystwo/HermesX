import { ReactNode, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useSocket } from '@/hooks/useSocket'
import { useAuthStore } from '@/stores/auth'

export function AppLayout({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const token = useAuthStore((s) => s.token)

  const handlersRef = useRef({
    onTicker: () => {
      queryClient.invalidateQueries({ queryKey: ['ticker'] })
    },
    onPosition: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
    },
    onOrder: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['positions'] })
    },
    onStrategy: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] })
    },
    onPnl: () => {
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
    },
    onAlert: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })

  useEffect(() => {
    handlersRef.current = {
      onTicker: () => queryClient.invalidateQueries({ queryKey: ['ticker'] }),
      onPosition: () => {
        queryClient.invalidateQueries({ queryKey: ['positions'] })
        queryClient.invalidateQueries({ queryKey: ['balance'] })
      },
      onOrder: () => {
        queryClient.invalidateQueries({ queryKey: ['orders'] })
        queryClient.invalidateQueries({ queryKey: ['positions'] })
      },
      onStrategy: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
      onPnl: () => {
        queryClient.invalidateQueries({ queryKey: ['stats'] })
        queryClient.invalidateQueries({ queryKey: ['balance'] })
      },
      onAlert: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    }
  }, [queryClient])

  useSocket([
    { event: 'market:ticker', handler: () => handlersRef.current.onTicker() },
    { event: 'position:update', handler: () => handlersRef.current.onPosition() },
    { event: 'order:fill', handler: () => handlersRef.current.onOrder() },
    { event: 'strategy:status', handler: () => handlersRef.current.onStrategy() },
    { event: 'pnl:snapshot', handler: () => handlersRef.current.onPnl() },
    { event: 'alert:risk', handler: () => handlersRef.current.onAlert() },
  ])

  if (!token) return null

  return (
    <div className="flex min-h-screen bg-bg-base">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
