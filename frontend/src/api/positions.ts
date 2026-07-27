import { apiClient } from './client'
import type { Position, PositionStatus } from '@/types'

export interface PositionFilter {
  status?: PositionStatus
  strategyId?: string
  side?: 'LONG' | 'SHORT'
}

export interface PlaceTpSlMissingResult {
  attempted: number
  succeeded: number
  results: Array<{ id: string; success: boolean; error?: string }>
}

export const positionsApi = {
  list: (filter?: PositionFilter) =>
    apiClient.get<Position[]>('/api/positions', { params: filter }).then((r) => r.data),

  close: (id: string) =>
    apiClient.post<Position>(`/api/positions/${id}/close`).then((r) => r.data),

  closeAll: (strategyId?: string) =>
    apiClient
      .post<{ closed: number }>('/api/positions/close-all', strategyId ? { strategyId } : {})
      .then((r) => r.data),

  placeTpSl: (id: string) =>
    apiClient.post<Position>(`/api/positions/${id}/place-tpsl`).then((r) => r.data),

  placeTpSlMissing: (strategyId?: string) =>
    apiClient
      .post<PlaceTpSlMissingResult>(
        '/api/positions/place-tpsl-missing',
        strategyId ? { strategyId } : {},
      )
      .then((r) => r.data),
}
