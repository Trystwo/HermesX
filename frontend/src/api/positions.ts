import { apiClient } from './client'
import type { Position, PositionStatus } from '@/types'

export interface PositionFilter {
  status?: PositionStatus
  strategyId?: string
  side?: 'LONG' | 'SHORT'
}

export const positionsApi = {
  list: (filter?: PositionFilter) =>
    apiClient.get<Position[]>('/api/positions', { params: filter }).then((r) => r.data),

  close: (id: number) =>
    apiClient.post<{ success: boolean }>(`/api/positions/${id}/close`).then((r) => r.data),

  closeAll: () =>
    apiClient.post<{ success: boolean; closed: number }>('/api/positions/close-all').then((r) => r.data),
}
