import { apiClient } from './client'
import type { Kline, LeverageBracket, SymbolInfo, CycleInterval } from '@/types'

export const marketApi = {
  getPrice: (symbol: string) =>
    apiClient.get<{ symbol: string; price: number }>(`/api/market/${symbol}/price`).then((r) => r.data),

  getKlines: (symbol: string, interval: CycleInterval | '1m', limit = 100) =>
    apiClient
      .get<Kline[]>(`/api/market/${symbol}/klines`, { params: { interval, limit } })
      .then((r) => r.data),

  getLeverageBrackets: (symbol: string) =>
    apiClient
      .get<LeverageBracket[]>(`/api/market/${symbol}/leverage-brackets`)
      .then((r) => r.data),

  getSymbols: () =>
    apiClient.get<SymbolInfo[]>('/api/market/symbols').then((r) => r.data),
}
