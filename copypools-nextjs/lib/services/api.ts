import axios, { AxiosError } from 'axios'
import { BACKEND_URL } from '@/lib/config/constants'
import { Position, Transaction, HealthStatus } from '@/lib/types'
import { parseError } from '@/lib/utils/errorHandler'

const api = axios.create({
  baseURL: BACKEND_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
})

// Add response interceptor for better error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Transform error to include parsed message
    if (error.response) {
      const parsedError = parseError(error)
      error.message = parsedError
    }
    return Promise.reject(error)
  }
)

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

  // Ponder-indexed data endpoints
  getPositionHistory: async (positionId: string): Promise<any[]> => {
    const { data } = await api.get(`/positions/${positionId}/history`)
    return data
  },

  getPositionCompounds: async (positionId: string): Promise<any[]> => {
    const { data } = await api.get(`/positions/${positionId}/compounds`)
    return data
  },

  getPositionTimeline: async (positionId: string): Promise<any[]> => {
    const { data } = await api.get(`/positions/${positionId}/timeline`)
    return data
  },

  getPositionCloseEvent: async (positionId: string): Promise<any | null> => {
    const { data } = await api.get(`/positions/${positionId}/close-event`)
    return data
  },

  syncPosition: async (positionId: string): Promise<any> => {
    const { data } = await api.post(`/positions/${positionId}/sync`)
    return data
  },

  // Create/Sync position endpoint
  createOrSyncPosition: async (positionId: string): Promise<any> => {
    const { data } = await api.post('/positions', { positionId })
    return data
  },
}
