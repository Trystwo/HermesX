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

export type OrphanKind = 'exchange_orphan' | 'db_orphan'

export interface OrphanOrderInfo {
  kind: OrphanKind
  algoId: string
  orderType: string
  side: string
  positionSide?: string | null
  triggerPrice: number | null
  quantity: number
  createTime: string | null
  symbol: string
  strategyId: string
  strategyName: string
  positionId: string | null
  positionStatus: string | null
  dbOrderId: string | null
  apiConfigId?: string | null
}

export interface OrphanCheckResult {
  orphans: OrphanOrderInfo[]
  exchangeOpen: number
  pendingDb: number
}

export interface OrphanCleanupResult {
  attempted: number
  succeeded: number
  results: Array<{
    algoId: string
    kind: OrphanKind
    success: boolean
    error?: string
  }>
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

  checkOrphanOrders: (strategyId?: string) =>
    apiClient
      .post<OrphanCheckResult>(
        '/api/positions/orphan-orders/check',
        strategyId ? { strategyId } : {},
      )
      .then((r) => r.data),

  cleanupOrphanOrders: (strategyId?: string, algoIds?: string[]) =>
    apiClient
      .post<OrphanCleanupResult>('/api/positions/orphan-orders/cleanup', {
        ...(strategyId ? { strategyId } : {}),
        ...(algoIds?.length ? { algoIds } : {}),
      })
      .then((r) => r.data),
}
