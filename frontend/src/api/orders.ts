import { apiClient } from './client'
import type { Order, OrderStatus } from '@/types'

export interface OrderFilter {
  status?: OrderStatus
  strategyId?: string
  symbol?: string
  page?: number
  pageSize?: number
}

export interface OrderListResponse {
  items: Order[]
  total: number
  page: number
  pageSize: number
}

export const ordersApi = {
  list: (filter?: OrderFilter) =>
    apiClient.get<OrderListResponse>('/api/orders', { params: filter }).then((r) => r.data),
}
