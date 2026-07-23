import { apiClient } from './client'
import type { Strategy, CreateStrategyInput, UpdateStrategyInput, StrategyStatus } from '@/types'

export const strategiesApi = {
  list: () => apiClient.get<Strategy[]>('/api/strategies').then((r) => r.data),

  create: (input: CreateStrategyInput) =>
    apiClient.post<Strategy>('/api/strategies', input).then((r) => r.data),

  update: (id: string | number, input: UpdateStrategyInput) =>
    apiClient.put<Strategy>(`/api/strategies/${id}`, input).then((r) => r.data),

  updateStatus: (
    id: string | number,
    status: StrategyStatus,
    opts?: { confirmLive?: boolean },
  ) =>
    apiClient
      .patch<Strategy>(`/api/strategies/${id}/status`, {
        status,
        ...(opts?.confirmLive ? { confirmLive: true } : {}),
      })
      .then((r) => r.data),

  remove: (id: string | number) => apiClient.delete(`/api/strategies/${id}`).then((r) => r.data),
}
