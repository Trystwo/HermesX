import { apiClient } from './client'
import type { Balance, Environment } from '@/types'

export const accountApi = {
  getBalance: (params: { strategyId?: string; environment?: Environment }) =>
    apiClient
      .get<Balance>('/api/account/balance', {
        params: {
          strategyId: params.strategyId,
          environment: params.environment,
        },
      })
      .then((r) => r.data),
}
