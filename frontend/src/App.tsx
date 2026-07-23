import { Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute, PublicOnlyRoute } from '@/components/layout/ProtectedRoute'
import { ToastContainer } from '@/components/ui/Toast'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Strategies } from '@/pages/Strategies'
import { Positions } from '@/pages/Positions'
import { Orders } from '@/pages/Orders'
import { Stats } from '@/pages/Stats'
import { Settings } from '@/pages/Settings'
import { Backtest } from '@/pages/Backtest'

export default function App() {
  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <Login />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/strategies" element={<Strategies />} />
                  <Route path="/backtest" element={<Backtest />} />
                  <Route path="/positions" element={<Positions />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/stats" element={<Stats />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
      <ToastContainer />
    </>
  )
}
