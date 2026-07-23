import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Menu, LogOut, User, OctagonAlert } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { useAuth } from '@/hooks/useAuth'
import { accountApi } from '@/api/account'
import { strategiesApi } from '@/api/strategies'
import { configApi } from '@/api/config'
import { ConfirmModal } from '@/components/ui/Modal'
import { EnvironmentBadge } from '@/components/trading/EnvironmentBadge'
import { toast } from '@/stores/toast'
import { formatCurrency } from '@/utils/format'
import { STATUS_LABEL } from '@/utils/constants'

export function TopBar() {
  const { selectedStrategyId, setMobileSidebarOpen } = useAppStore()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [emergencyLoading, setEmergencyLoading] = useState(false)

  const { data: strategies } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const selectedStrategy = strategies?.find(
    (s) => String(s.id) === selectedStrategyId,
  )

  const { data: balance } = useQuery({
    queryKey: ['balance', selectedStrategyId],
    queryFn: () => accountApi.getBalance({ strategyId: selectedStrategyId! }),
    enabled: !!selectedStrategyId,
    refetchInterval: 10000,
  })

  const handleEmergencyStop = async () => {
    setEmergencyLoading(true)
    try {
      await configApi.emergencyStop()
      toast.success('紧急停止已触发，所有策略已暂停')
      setEmergencyOpen(false)
      navigate('/')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEmergencyLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <>
      <header className="h-14 bg-bg-surface border-b border-border flex items-center justify-between px-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            className="md:hidden text-fg-muted hover:text-fg"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>

          {selectedStrategy ? (
            <div className="flex items-center gap-2 px-2.5 h-9 rounded-md bg-bg-elevated border border-border">
              <span className="text-sm text-fg font-medium max-w-[10rem] truncate">
                {selectedStrategy.name}
              </span>
              <EnvironmentBadge environment={selectedStrategy.environment} size="sm" />
              <span className="text-xs text-fg-muted hidden sm:inline">
                {STATUS_LABEL[selectedStrategy.status] ?? selectedStrategy.status}
              </span>
            </div>
          ) : (
            <span className="text-xs text-fg-subtle">未选择策略</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {selectedStrategyId && balance && (
            <div className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-md bg-bg-elevated border border-border">
              <span className="text-xs text-fg-muted">余额</span>
              <span className="text-sm font-mono font-medium text-fg">
                {formatCurrency(balance.totalBalance)}
              </span>
            </div>
          )}

          <button
            onClick={() => setEmergencyOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-up/40 bg-up/10 text-up text-xs font-medium hover:bg-up/20 transition-colors"
          >
            <OctagonAlert size={14} />
            <span className="hidden sm:inline">紧急停止</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-bg-hover transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-brand/20 text-brand flex items-center justify-center text-xs font-medium">
                {user?.username?.[0]?.toUpperCase() ?? 'U'}
              </div>
              <span className="text-sm text-fg hidden sm:inline">{user?.username}</span>
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-40 w-44 bg-bg-surface border border-border rounded-md shadow-xl py-1">
                  <div className="px-3 py-2 border-b border-border">
                    <div className="text-sm text-fg font-medium">{user?.username}</div>
                    <div className="text-xs text-fg-subtle flex items-center gap-1 mt-0.5">
                      <User size={10} />
                      已登录
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg-muted hover:text-up hover:bg-bg-hover transition-colors"
                  >
                    <LogOut size={14} />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <ConfirmModal
        open={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        onConfirm={handleEmergencyStop}
        title="紧急停止"
        danger
        loading={emergencyLoading}
        confirmText="确认紧急停止"
        content={
          <div className="space-y-2">
            <p className="text-up font-medium">此操作将立即停止所有运行中的策略，并尝试平掉所有持仓。</p>
            <p>确定要执行紧急停止吗？</p>
          </div>
        }
      />
    </>
  )
}
