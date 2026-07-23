import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Bot,
  Crosshair,
  History,
  BarChart3,
  Settings,
  ChevronLeft,
  X,
  Activity,
  FlaskConical,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAppStore } from '@/stores/app'

const navItems = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: '/strategies', label: '策略管理', icon: Bot },
  { to: '/backtest', label: '策略回测', icon: FlaskConical },
  { to: '/positions', label: '持仓监控', icon: Crosshair },
  { to: '/orders', label: '订单历史', icon: History },
  { to: '/stats', label: '统计分析', icon: BarChart3 },
  { to: '/settings', label: '设置', icon: Settings },
]

export function Sidebar() {
  const { sidebarCollapsed, mobileSidebarOpen, toggleSidebar, setMobileSidebarOpen } = useAppStore()

  return (
    <>
      {/* 移动端遮罩 */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed md:sticky top-0 left-0 z-40 h-screen bg-bg-surface border-r border-border flex flex-col transition-all duration-200',
          sidebarCollapsed ? 'w-16' : 'w-60',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center shrink-0">
              <Activity size={18} className="text-white" />
            </div>
            {!sidebarCollapsed && (
              <span className="font-bold text-base text-fg whitespace-nowrap">HermesX</span>
            )}
          </div>
          <button
            className="md:hidden text-fg-muted hover:text-fg"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 h-10 px-3 rounded-md text-sm transition-colors',
                    sidebarCollapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-brand/10 text-brand font-medium'
                      : 'text-fg-muted hover:text-fg hover:bg-bg-hover',
                  )
                }
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon size={18} className="shrink-0" />
                {!sidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        {/* 折叠按钮 */}
        <button
          className="hidden md:flex items-center justify-center h-10 border-t border-border text-fg-muted hover:text-fg transition-colors"
          onClick={toggleSidebar}
        >
          <ChevronLeft
            size={18}
            className={cn('transition-transform', sidebarCollapsed && 'rotate-180')}
          />
        </button>
      </aside>
    </>
  )
}
