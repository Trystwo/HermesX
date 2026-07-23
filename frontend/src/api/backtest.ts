/**
 * 回测 API 客户端
 * 注意：回测请求可能较慢（拉 K 线 + 网格），单独加长超时
 */

import { apiClient } from './client'
import type {
  BacktestJob,
  BacktestMeta,
  CreateBacktestInput,
} from '@/types'

export const backtestApi = {
  meta: () => apiClient.get<BacktestMeta>('/api/backtests/meta').then((r) => r.data),

  list: (limit = 50) =>
    apiClient.get<BacktestJob[]>('/api/backtests', { params: { limit } }).then((r) => r.data),

  get: (id: string) => apiClient.get<BacktestJob>(`/api/backtests/${id}`).then((r) => r.data),

  create: (input: CreateBacktestInput) =>
    apiClient
      .post<BacktestJob>('/api/backtests', input, { timeout: 120_000 })
      .then((r) => r.data),

  remove: (id: string) => apiClient.delete(`/api/backtests/${id}`).then((r) => r.data),
}
