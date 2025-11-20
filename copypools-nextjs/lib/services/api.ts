import axios from 'axios'
import { BACKEND_URL } from '@/lib/config/constants'
import { Position, Transaction, HealthStatus } from '@/lib/types'

const api = axios.create({
  baseURL: BACKEND_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const apiService = {
  // Health check
  getHealthStatus: async (): Promise<HealthStatus> => {
    const { data } = await api.get('/positions/health/status')
    return data
  },

  // Position endpoints
  getAllPositions: async (owner?: string): Promise<Position[]> => {
    const { data } = await api.get('/positions', {
      params: owner ? { owner } : {},
    })
    return data
  },

  getPosition: async (positionId: string): Promise<Position> => {
    const { data } = await api.get(`/positions/${positionId}`)
    return data
  },

  getPositionDetails: async (positionId: string): Promise<any> => {
    const { data } = await api.get(`/positions/${positionId}/details`)
    return data
  },

  getPositionTransactions: async (positionId: string): Promise<Transaction[]> => {
    const { data } = await api.get(`/positions/${positionId}/transactions`)
    return data
  },

  // Position operations
  moveRange: async (
    positionId: string,
    tickLower: number,
    tickUpper: number,
    doSwap: boolean = false
  ): Promise<any> => {
    const { data } = await api.post(`/positions/${positionId}/move-range`, {
      tickLower,
      tickUpper,
      doSwap,
    })
    return data
  },

  compound: async (positionId: string, doSwap: boolean = false): Promise<any> => {
    const { data } = await api.post(`/positions/${positionId}/compound`, {
      doSwap,
    })
    return data
  },

  closePosition: async (positionId: string, liquidity: string): Promise<any> => {
    const { data } = await api.post(`/positions/${positionId}/close`, {
      liquidity,
    })
    return data
  },
}
