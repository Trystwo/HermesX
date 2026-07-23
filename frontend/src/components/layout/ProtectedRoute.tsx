import { ReactNode, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/auth'
import { Spinner } from '@/components/ui/Spinner'

function useAuthHydrated() {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated())

  useEffect(() => {
    if (hydrated) return
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true))
    // 若已经完成（竞态），再读一次
    if (useAuthStore.persist.hasHydrated()) setHydrated(true)
    return unsub
  }, [hydrated])

  return hydrated
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const hydrated = useAuthHydrated()
  const { isAuthenticated, token } = useAuth()
  const location = useLocation()

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-base">
        <Spinner />
      </div>
    )
  }

  if (!isAuthenticated || !token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const hydrated = useAuthHydrated()
  const { isAuthenticated, token } = useAuth()

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-base">
        <Spinner />
      </div>
    )
  }

  if (isAuthenticated && token) return <Navigate to="/" replace />
  return <>{children}</>
}
