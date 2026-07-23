import { apiClient } from './client'
import type { Stats } from '@/types'

export interface StatsParams {
  range?: 'DAY' | 'WEEK' | 'MONTH'
  strategyId?: string | number
}

const RANGE_TO_PERIOD: Record<NonNullable<StatsParams['range']>, 'day' | 'week' | 'month'> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
}

export const statsApi = {
  getStats: (params?: StatsParams) =>
    apiClient
      .get<Stats>('/api/trades/stats', {
        params: {
          period: params?.range ? RANGE_TO_PERIOD[params.range] : 'week',
          strategyId: params?.strategyId,
        },
      })
      .then((r) => r.data),
}
