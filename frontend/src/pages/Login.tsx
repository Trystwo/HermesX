import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, User, Lock, ArrowRight } from 'lucide-react'
import { authApi } from '@/api/auth'
import { useAuth } from '@/hooks/useAuth'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { toast } from '@/stores/toast'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ username?: string; password?: string; confirm?: string }>({})

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!username.trim()) errs.username = '请输入用户名'
    if (!password.trim()) errs.password = '请输入密码'
    if (mode === 'register' && password !== confirmPassword) {
      errs.confirm = '两次密码不一致'
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setLoading(true)
    try {
      const res =
        mode === 'login'
          ? await authApi.login(username, password)
          : await authApi.register(username, password)
      login(res.user, res.accessToken)
      toast.success(mode === 'login' ? '登录成功' : '注册成功，已自动登录')
      navigate('/')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base p-4">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-up/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-brand flex items-center justify-center shadow-lg shadow-brand/30 mb-3">
            <Activity size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-fg">HermesX</h1>
          <p className="text-xs text-fg-muted mt-1">加密货币合约对冲交易系统</p>
        </div>

        <div className="bg-bg-surface border border-border rounded-xl p-6 shadow-xl">
          {/* 模式切换 */}
          <div className="flex items-center gap-1 p-0.5 rounded-md bg-bg-elevated mb-5">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 h-8 rounded text-sm font-medium transition-colors ${
                mode === 'login' ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg'
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 h-8 rounded text-sm font-medium transition-colors ${
                mode === 'register' ? 'bg-brand text-white' : 'text-fg-muted hover:text-fg'
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <User
                size={16}
                className="absolute left-3 top-[34px] text-fg-subtle pointer-events-none"
              />
              <Input
                label="用户名"
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                error={errors.username}
                className="pl-9"
                autoComplete="username"
              />
            </div>

            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-[34px] text-fg-subtle pointer-events-none"
              />
              <Input
                label="密码"
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                error={errors.password}
                className="pl-9"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {mode === 'register' && (
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3 top-[34px] text-fg-subtle pointer-events-none"
                />
                <Input
                  label="确认密码"
                  type="password"
                  name="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                  error={errors.confirm}
                  className="pl-9"
                />
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              {mode === 'login' ? '登录' : '注册'}
              {!loading && <ArrowRight size={16} />}
            </Button>
          </form>

          <div className="mt-4 text-center text-xs text-fg-muted">
            {mode === 'login' ? (
              <>
                还没有账号？
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="text-brand hover:underline ml-1"
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账号？
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-brand hover:underline ml-1"
                >
                  去登录
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-[10px] text-fg-subtle mt-6">
          风险提示：合约交易存在高风险，请谨慎投资
        </p>
      </div>
    </div>
  )
}
