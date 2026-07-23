import { apiClient } from './client'
import type {
  ApiConfig,
  CreateApiConfigInput,
  Environment,
  TestConnectionResult,
} from '@/types'

export interface RiskParams {
  maxPositions: number
  maxSingleNotional: number
  maxTotalLossPct: number
  maxConsecutiveLosses: number
  circuitBreakerTriggered: boolean
  circuitBreakerReason: string
  consecutiveLosses: number
}

export const configApi = {
  getApiConfigs: () =>
    apiClient.get<ApiConfig[]>('/api/config/exchange').then((r) => r.data),

  createApiConfig: (input: CreateApiConfigInput) =>
    apiClient.post<ApiConfig>('/api/config/exchange', input).then((r) => r.data),

  deleteApiConfig: (id: string | number) =>
    apiClient.delete(`/api/config/exchange/${id}`).then((r) => r.data),

  testConnection: (environment: Environment) =>
    apiClient
      .get<TestConnectionResult>('/api/config/exchange/test', { params: { environment } })
      .then((r) => r.data),

  getRiskParams: () =>
    apiClient.get<RiskParams>('/api/config/risk').then((r) => r.data),

  updateRiskParams: (params: Partial<RiskParams>) =>
    apiClient.put<RiskParams>('/api/config/risk', params).then((r) => r.data),

  emergencyStop: () =>
    apiClient
      .post<{ success: boolean; message: string }>('/api/system/emergency-stop')
      .then((r) => r.data),

  resetCircuitBreaker: () =>
    apiClient
      .post<RiskParams>('/api/config/risk/reset-circuit-breaker')
      .then((r) => r.data),
}
